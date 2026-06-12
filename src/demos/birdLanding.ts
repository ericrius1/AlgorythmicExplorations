// The four figures of Feather & Bone part 5: an approach to a single perch
// with the glide slope and phases exposed, the flare seen in slow motion as a
// lift spike at the stall's edge, the syrinx singing in two independent
// voices with the beak driven by its own output, and the whole act — circle,
// land on a real Ground-Truth tree, sing, take off again — on a loop.

import * as THREE from "three/webgpu";
import { Shell, type Demo } from "../lib/demoShell";
import { createStage3D } from "../lib/stage3d";
import { buildBirdMesh, addFace } from "../lib/bird/build";
import { createSkinnedWren, attachRider, type BirdRig } from "../lib/bird/rig";
import { applyWingTip, unfoldTarget, setTail, WINGS, FLAP_DEFAULTS } from "../lib/bird/wing";
import { flightQuaternion, FLIGHT_DEFAULTS, type FlightState } from "../lib/bird/flight";
import { LandingController, inboundState, type PerchTarget, type LandingPhase } from "../lib/bird/landing";
import { Syrinx, generatePhrase } from "../lib/bird/syrinx";
import { waveform, audioOn, soundHint } from "../lib/audio";
import { growTree, buildTreeGeometry, findPerches, TREE_DEFAULTS, type Perch } from "../lib/terrain/trees";

// ---- a wren that can fly, glide, flare, perch, and sing ------------------------------

export interface Wren {
  group: THREE.Group;
  rig: BirdRig;
  bodyRest: THREE.Vector3;
  // pose the wings: f = wingbeat phase, spread = 0 folded .. 1 full span,
  // flapAmt = how much of a beat to overlay, beak = 0 shut .. 1 open
  pose(opts: { phase: number; spread: number; flap: number; tailFan: number; beak: number; theta?: number }): void;
}

export function makeWren(): Wren {
  const built = buildBirdMesh({ res: 56, skin: true });
  const { mesh, rig } = createSkinnedWren(built.geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
  const group = new THREE.Group();
  group.add(mesh);
  const face = new THREE.Group();
  addFace(face);
  attachRider(rig, "head", face);
  const bodyRest = rig.bone("body").position.clone();

  const tL = new THREE.Vector3();
  const tR = new THREE.Vector3();
  const flapL = new THREE.Vector3();
  const flapR = new THREE.Vector3();

  const pose: Wren["pose"] = ({ phase, spread, flap, tailFan, beak, theta = 0 }) => {
    // base wing target: the unfold position at this spread
    unfoldTarget(WINGS.L, spread, tL);
    unfoldTarget(WINGS.R, spread, tR);
    if (flap > 0) {
      // overlay a beat by nudging the tip vertically with the wing phase
      const v = Math.cos(phase * Math.PI * 2) * 0.13 * flap;
      flapL.copy(tL); flapL.y += v;
      flapR.copy(tR); flapR.y += v;
      applyWingTip(rig, WINGS.L, flapL, { twist: 0.3 * flap * Math.sin(phase * Math.PI * 2) });
      applyWingTip(rig, WINGS.R, flapR, { twist: 0.3 * flap * Math.sin(phase * Math.PI * 2) });
    } else {
      applyWingTip(rig, WINGS.L, tL, { twist: 0.1 * spread });
      applyWingTip(rig, WINGS.R, tR, { twist: 0.1 * spread });
    }
    setTail(rig, tailFan, -8 + 6 * Math.cos(theta), 0);
    rig.bone("beak").rotation.set(beak * 0.5, 0, 0);
  };

  return { group, rig, bodyRest, pose };
}

// orient the group: in flight, by the velocity frame; perched, upright and
// facing along the branch, blended by `settle` (0 flying .. 1 perched)
const qFlight = new THREE.Quaternion();
const qPerch = new THREE.Quaternion();
const mPerch = new THREE.Matrix4();
const perchX = new THREE.Vector3();
const perchZ = new THREE.Vector3();
const perchY = new THREE.Vector3(0, 1, 0);
export function orientWren(group: THREE.Group, state: FlightState, perch: PerchTarget, settle: number): void {
  flightQuaternion(state, qFlight);
  // perched frame: up is world up, forward faces across the branch (the
  // tangent rotated a quarter turn) — a wren perches at right angles to the
  // twig, not along it
  perchZ.copy(perch.tangent).setY(0);
  if (perchZ.lengthSq() < 1e-5) perchZ.set(0, 0, 1);
  perchZ.applyAxisAngle(perchY, Math.PI / 2).normalize();
  perchX.crossVectors(perchY, perchZ).normalize();
  mPerch.makeBasis(perchX, perchY, perchZ);
  qPerch.setFromRotationMatrix(mPerch);
  group.quaternion.copy(qFlight).slerp(qPerch, settle);
}

// ---- the approach -------------------------------------------------------------------

const BRANCH_PERCH: PerchTarget = {
  position: new THREE.Vector3(0, 1.4, 0),
  tangent: new THREE.Vector3(1, 0.05, 0.2).normalize(),
};

export async function mountApproach(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, {
    skyTop: [0.05, 0.07, 0.12], skyBottom: [0.1, 0.12, 0.16],
    target: [0, 1.3, 0], distance: 7, azimuth: 0.8, elevation: 0.18, far: 200,
  });

  // a bare branch stub to land on
  const branch = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 2.2, 7),
    new THREE.MeshStandardMaterial({ color: 0x5a4a35, roughness: 1 }),
  );
  branch.rotation.z = Math.PI / 2 - 0.1;
  branch.rotation.y = -0.2;
  branch.position.set(0, 1.4, 0);
  stage.scene.add(branch);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.4, 6), branch.material as THREE.Material);
  post.position.set(0.9, 0.7, 0.3);
  stage.scene.add(post);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(8, 40), new THREE.MeshStandardMaterial({ color: 0x2a3326, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  stage.scene.add(ground);

  const wren = makeWren();
  stage.scene.add(wren.group);

  const p = { ...FLIGHT_DEFAULTS };
  const start = new THREE.Vector3(-6, 3.2, 4.5);
  let ctrl = new LandingController(inboundState(start, BRANCH_PERCH.position, p), BRANCH_PERCH, p);

  // the glide-slope guide line from a sensible entry gate to the perch
  const slopeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-4, 2.6, 3), BRANCH_PERCH.position.clone()]);
  const slope = new THREE.Line(slopeGeo, new THREE.LineDashedMaterial({ color: 0x6ad08a, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity: 0.5 }));
  slope.computeLineDistances();
  stage.scene.add(slope);

  const trailPts: THREE.Vector3[] = [];
  const trailGeo = new THREE.BufferGeometry();
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffc163 }));
  trail.frustumCulled = false;
  stage.scene.add(trail);

  const reset = (): void => {
    ctrl = new LandingController(inboundState(start, BRANCH_PERCH.position, p), BRANCH_PERCH, p);
    trailPts.length = 0;
  };
  shell.button("launch approach", reset);

  const phaseLabel: Record<LandingPhase, string> = {
    cruise: "cruise — lining up",
    approach: "approach — riding the glide slope down",
    flare: "flare — trading speed for one last cushion of lift",
    perched: "perched — toes on the branch, speed zero",
  };
  shell.setInfo(() => `${phaseLabel[ctrl.phase]} · ${ctrl.speed.toFixed(1)} m/s · ${ctrl.distance.toFixed(1)} to perch`);

  let phase = 0;
  let last = performance.now() / 1000;

  return {
    frame() {
      const t = performance.now() / 1000;
      const dt = Math.min(t - last, 0.05);
      last = t;
      ctrl.step(dt);
      const s = ctrl.state;

      wren.group.position.copy(s.pos);
      orientWren(wren.group, s, BRANCH_PERCH, ctrl.phase === "perched" ? ctrl.perchProgress : 0);

      // wing behaviour follows the phase
      const flapping = ctrl.phase === "cruise" ? 1 : ctrl.phase === "approach" ? 0.3 : 0;
      const spread = ctrl.phase === "perched" ? Math.max(0, 1 - ctrl.perchProgress) * 0.2 : ctrl.phase === "flare" ? 1 : 0.85;
      const tailFan = ctrl.phase === "flare" ? 1 : ctrl.phase === "perched" ? 0.2 : 0.5;
      phase = (phase + dt * FLAP_DEFAULTS.rate * (0.3 + flapping)) % 1;
      wren.pose({ phase, spread, flap: flapping, tailFan, beak: 0, theta: phase * Math.PI * 2 });

      if (ctrl.phase !== "perched") {
        trailPts.push(s.pos.clone());
        if (trailPts.length > 500) trailPts.shift();
        trailGeo.setFromPoints(trailPts);
      }
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- the flare, in slow motion ------------------------------------------------------

export async function mountFlare(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.7);
  const ctx = shell.canvas.getContext("2d")!;

  // replay one flare repeatedly and plot speed, lift, and altitude through it
  const p = { ...FLIGHT_DEFAULTS };
  const perch: PerchTarget = { position: new THREE.Vector3(0, 1.5, 0), tangent: new THREE.Vector3(1, 0, 0) };
  let ctrl = new LandingController(inboundState(new THREE.Vector3(-7, 3, 0), perch.position, p), perch, p);
  const samples: { d: number; speed: number; vy: number; phase: LandingPhase }[] = [];
  let slow = 0.25;

  shell.slider({ label: "time ×", min: 0.05, max: 1, step: 0.05, value: slow, onInput: (v) => (slow = v) });
  shell.button("replay", () => { ctrl = new LandingController(inboundState(new THREE.Vector3(-7, 3, 0), perch.position, p), perch, p); samples.length = 0; });

  let last = performance.now() / 1000;
  shell.setInfo(() => `${ctrl.phase} · the dip in speed at the flare IS the landing`);

  return {
    frame() {
      const t = performance.now() / 1000;
      const dt = Math.min(t - last, 0.05) * slow;
      last = t;
      if (ctrl.phase !== "perched") {
        ctrl.step(dt);
        samples.push({ d: ctrl.distance, speed: ctrl.speed, vy: ctrl.state.vel.y, phase: ctrl.phase });
        if (samples.length > 900) samples.shift();
      }

      const W = shell.canvas.width, H = shell.canvas.height;
      ctx.fillStyle = "#0a0b10";
      ctx.fillRect(0, 0, W, H);
      if (samples.length > 1) {
        const maxSpeed = 9;
        const plot = (key: "speed" | "vy", color: string, mid: number, scale: number): void => {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let i = 0; i < samples.length; i++) {
            const x = (i / (samples.length - 1)) * W;
            const y = H * (mid - (samples[i][key] / scale) * 0.4);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.stroke();
        };
        // shade the flare region
        const flareStart = samples.findIndex((s) => s.phase === "flare");
        if (flareStart >= 0) {
          ctx.fillStyle = "rgba(229,119,119,0.12)";
          ctx.fillRect((flareStart / (samples.length - 1)) * W, 0, W, H);
        }
        plot("speed", "#7fb4ff", 0.55, maxSpeed); // speed bleeding away
        plot("vy", "#6ad08a", 0.78, 6); // vertical speed: the cushion
        ctx.fillStyle = "#9aa4b2";
        ctx.font = "13px system-ui";
        ctx.fillText("speed", 12, 24);
        ctx.fillStyle = "#6ad08a";
        ctx.fillText("climb / sink rate", 12, H * 0.78 - 8);
        ctx.fillStyle = "rgba(229,119,119,0.8)";
        if (flareStart >= 0) ctx.fillText("flare", (flareStart / (samples.length - 1)) * W + 8, 24);
      }
      shell.tick();
    },
  };
}

// ---- the song -----------------------------------------------------------------------

export async function mountSong(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.55);
  const stage = await createStage3D(shell.canvas, {
    skyTop: [0.05, 0.07, 0.12], skyBottom: [0.1, 0.12, 0.16],
    target: [0, 1.45, 0], distance: 1.4, azimuth: 0.5, elevation: 0.05,
  });
  const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.6, 7), new THREE.MeshStandardMaterial({ color: 0x5a4a35, roughness: 1 }));
  branch.rotation.z = Math.PI / 2;
  branch.position.set(0, 1.32, 0);
  stage.scene.add(branch);

  const wren = makeWren();
  wren.group.position.set(0, 1.4, 0);
  // perched, upright, facing the camera-ish
  wren.group.rotation.y = 0.5;
  stage.scene.add(wren.group);

  const syrinx = new Syrinx();
  let seed = 1;
  let singing = false;
  let phraseEnds = 0;

  const sing = async (): Promise<void> => {
    const dur = await syrinx.sing(generatePhrase(seed++));
    singing = true;
    phraseEnds = performance.now() / 1000 + dur;
  };

  const hint = soundHint(container, "tap for song");
  hint.addEventListener("click", () => { hint.remove(); sing(); });
  shell.button("sing again", () => sing());
  shell.button("auto: off", function (this: HTMLButtonElement) {
    auto = !auto;
    this.textContent = `auto: ${auto ? "on" : "off"}`;
  });
  let auto = false;

  let beak = 0;
  let last = performance.now() / 1000;
  shell.setInfo(() => (audioOn() ? (singing ? "two voices — watch the beak ride her own output" : "her syrinx has two sound sources, like two throats") : "tap for song"));

  return {
    frame() {
      const t = performance.now() / 1000;
      const dt = Math.min(t - last, 0.05);
      last = t;

      // beak opening from the live output level (RMS of the waveform)
      let target = 0;
      if (singing && audioOn()) {
        const w = waveform();
        let sum = 0;
        for (let i = 0; i < w.length; i += 8) sum += w[i] * w[i];
        target = Math.min(1, Math.sqrt(sum / (w.length / 8)) * 6);
      }
      beak += (target - beak) * Math.min(1, dt * 20);
      if (t > phraseEnds) { singing = false; if (auto && t > phraseEnds + 0.6) sing(); }

      const breath = Math.sin(t * 3) * 0.4;
      wren.pose({ phase: 0, spread: 0.12, flap: 0, tailFan: 0.25, beak, theta: breath });
      stage.render();
      shell.tick();
    },
    dispose: () => { stage.dispose(); syrinx.dispose(); },
  };
}

// ---- the whole act: land on a real tree, sing, take off -----------------------------

export async function mountLandingAct(container: HTMLElement, opts: { hero?: boolean } = {}): Promise<Demo> {
  const shell = new Shell(container, opts.hero ? 0.5 : 0.62);
  const stage = await createStage3D(shell.canvas, {
    skyTop: [0.04, 0.06, 0.11], skyBottom: [0.12, 0.13, 0.16],
    target: [0, 2, 0], distance: 7, azimuth: 0.7, elevation: 0.16, far: 300,
    fog: { color: 0x1a1e26, near: 18, far: 80 },
  });
  stage.orbit.autoSpin = 0.0006;

  // a real Ground-Truth tree, with its published perches
  const skel = growTree({ ...TREE_DEFAULTS, seed: 7, attractors: 320 });
  const treeBuild = buildTreeGeometry(skel);
  const bark = new THREE.Mesh(treeBuild.bark, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  const leaves = new THREE.Mesh(treeBuild.leaves, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
  stage.scene.add(bark, leaves);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshStandardMaterial({ color: 0x2a3326, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  stage.scene.add(ground);

  // choose perches up in the crown that a wren would actually pick
  const perches: Perch[] = findPerches(skel, { minRadius: 0.02, maxRadius: 0.06, minHeadroom: 0.28 })
    .filter((pc) => pc.position.y > 1.5)
    .sort((a, b) => b.position.y - a.position.y);
  const fallback: Perch = { position: new THREE.Vector3(0, 2.2, 0), tangent: new THREE.Vector3(1, 0, 0), radius: 0.04, headroom: 0.4 };
  const perchList = perches.length ? perches : [fallback];

  const wren = makeWren();
  stage.scene.add(wren.group);

  const p = { ...FLIGHT_DEFAULTS };
  const syrinx = new Syrinx();
  let perchIdx = 0;
  const pickPerch = (): PerchTarget => {
    const pc = perchList[perchIdx % perchList.length];
    return { position: pc.position.clone(), tangent: pc.tangent.clone() };
  };
  let target = pickPerch();
  const entryFor = (tgt: PerchTarget): THREE.Vector3 => {
    const a = (perchIdx * 2.39963) % (Math.PI * 2);
    return new THREE.Vector3(tgt.position.x + Math.cos(a) * 6, tgt.position.y + 2.4, tgt.position.z + Math.sin(a) * 6);
  };
  let ctrl = new LandingController(inboundState(entryFor(target), target.position, p), target, p);

  // state machine: FLYING → (land) → PERCHED+SING → (timeout) → TAKEOFF → FLYING
  let mode: "flying" | "perched" | "takeoff" = "flying";
  let perchedUntil = 0;
  let takeoff: FlightState | null = null;
  let beak = 0;
  let singEnds = 0;
  let phase = 0;
  let last = performance.now() / 1000;

  if (!opts.hero) {
    shell.button("send her to the next perch", () => { if (mode === "perched") { perchedUntil = 0; } });
    shell.setInfo(() => `${mode === "flying" ? ctrl.phase : mode} · ${perchList.length} perches on this tree`);
  }

  const startSing = async (): Promise<void> => {
    const dur = await syrinx.sing(generatePhrase(perchIdx * 7 + 1));
    singEnds = performance.now() / 1000 + dur;
  };

  return {
    frame() {
      const t = performance.now() / 1000;
      const dt = Math.min(t - last, 0.05);
      last = t;

      if (mode === "flying") {
        ctrl.step(dt);
        wren.group.position.copy(ctrl.state.pos);
        orientWren(wren.group, ctrl.state, target, ctrl.phase === "perched" ? ctrl.perchProgress : 0);
        const flapping = ctrl.phase === "cruise" ? 1 : ctrl.phase === "approach" ? 0.3 : 0;
        const spread = ctrl.phase === "flare" ? 1 : 0.85;
        const tailFan = ctrl.phase === "flare" ? 1 : 0.5;
        phase = (phase + dt * FLAP_DEFAULTS.rate * (0.3 + flapping)) % 1;
        wren.pose({ phase, spread, flap: flapping, tailFan, beak: 0, theta: phase * Math.PI * 2 });
        if (ctrl.phase === "perched") {
          mode = "perched";
          perchedUntil = t + 3.5 + Math.random() * 2;
          startSing();
        }
      } else if (mode === "perched") {
        // settle, sing, beak rides the output
        let tgt = 0;
        if (t < singEnds && audioOn()) {
          const w = waveform();
          let sum = 0;
          for (let i = 0; i < w.length; i += 8) sum += w[i] * w[i];
          tgt = Math.min(1, Math.sqrt(sum / (w.length / 8)) * 6);
        }
        beak += (tgt - beak) * Math.min(1, dt * 18);
        const breath = Math.sin(t * 3) * 0.35;
        orientWren(wren.group, ctrl.state, target, 1);
        wren.pose({ phase: 0, spread: 0.12, flap: 0, tailFan: 0.22, beak, theta: breath });
        if (t > perchedUntil && (t > singEnds || !audioOn())) {
          // take off toward the next perch
          perchIdx++;
          const next = pickPerch();
          takeoff = inboundState(ctrl.state.pos.clone(), next.position, p);
          takeoff.pos.copy(ctrl.state.pos);
          takeoff.vel.set(0, 0, 0); // launch from rest
          target = next;
          ctrl = new LandingController(takeoff, target, p);
          mode = "takeoff";
          perchedUntil = t + 0.6;
        }
      } else {
        // brief powered launch: full flap, climb out, then hand back to landing
        ctrl.state.flapEffort = 1;
        ctrl.step(dt);
        wren.group.position.copy(ctrl.state.pos);
        orientWren(wren.group, ctrl.state, target, 0);
        phase = (phase + dt * FLAP_DEFAULTS.rate * 1.4) % 1;
        wren.pose({ phase, spread: 0.9, flap: 1, tailFan: 0.5, beak: 0, theta: phase * Math.PI * 2 });
        if (t > perchedUntil) mode = "flying";
      }

      // camera eases toward the bird so the act stays framed
      stage.orbit.target.lerp(wren.group.position, 0.04);
      stage.render();
      if (!opts.hero) shell.tick();
    },
    dispose: () => { stage.dispose(); syrinx.dispose(); },
  };
}
