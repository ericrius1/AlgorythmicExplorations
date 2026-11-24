// Part 5 Keystone Figures ("A Creature of Your Own"):
//  1. mountCompanionSanctuary — Full interactive 3D WebGPU living pet sanctuary
//     (6 species x 5 series-inspired environments, pure-WebGPU continual LLM chat,
//      direct 3D petting, physics orb tossing, REINFORCE trick training, Dream-mode
//      AutoResearch, 4-stage visual evolution, IndexedDB persistence, & `;` debug mode!)
//  2. mountSpeciesGallery     — Interactive 3D turntable & evolution stage explorer

import * as THREE from "three/webgpu";
import { pass } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { Shell, type Demo } from "../../lib/demoShell";

/** Lightweight pure three/webgpu studio light-dome for PMREM IBL (zero duplicate Three.js warning!) */
function createStudioEnvTexture(renderer: THREE.WebGPURenderer): THREE.Texture {
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x141826);
  const panels: { pos: [number, number, number]; scale: [number, number, number]; col: number }[] = [
    { pos: [4, 5, 4], scale: [4, 4, 0.2], col: 0xfff0d4 },
    { pos: [-5, 3, -3], scale: [5, 3, 0.2], col: 0x7ca8ff },
    { pos: [0, 6, 0], scale: [6, 0.2, 6], col: 0xb8d0ff },
    { pos: [0, -3, 0], scale: [8, 0.2, 8], col: 0x2a2434 },
  ];
  const box = new THREE.BoxGeometry(1, 1, 1);
  for (const p of panels) {
    const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: p.col }));
    m.position.set(...p.pos);
    m.scale.set(...p.scale);
    m.lookAt(0, 0, 0);
    envScene.add(m);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();
  box.dispose();
  return tex;
}
import { Orbit3D } from "../../lib/stage3d";
import { pageDebug } from "../../lib/debugmode";
import { SPECIES_CATALOG, getSpeciesById } from "../../lib/pet/speciesRegistry";
import {
  ENVIRONMENTS,
  applyEnvironmentBackdrop,
  createEnvironment,
  type EnvironmentId,
  type EnvironmentInstance,
} from "../../lib/pet/environments";
import { PetBrain, nextStageXp } from "../../lib/pet/petBrain";
import { decodeCheckpoint, downloadCheckpointFile } from "../../lib/llm/checkpoint";
import { petAudio } from "../../lib/pet/petAudio";
import {
  EVOLUTION_NAMES,
  TRICK_LIST,
  type EvolutionStage,
  type PetModelRig,
  type PetMood,
  type PetTrick,
  type SpeciesDefinition,
} from "../../lib/pet/types";

interface SparkleParticle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

// ---- 1. THE EPIC KEYSTONE LIVING PET SANCTUARY -----------------------------

export async function mountCompanionSanctuary(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.39);
  container.classList.add("sm-sanctuary-wrap");

  const renderer = new THREE.WebGPURenderer({ canvas: shell.canvas, antialias: true });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(shell.canvas.width, shell.canvas.height, false);
  // Loom-inspired filmic AgX tone mapping + real soft shadows + studio IBL environment
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 0.96;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const envTex = createStudioEnvTexture(renderer);
  scene.environment = envTex;
  scene.environmentIntensity = 0.42;

  const camera = new THREE.PerspectiveCamera(36, shell.canvas.width / shell.canvas.height, 0.05, 80);
  const orbit = new Orbit3D();
  orbit.target.set(0, 0.52, 0);
  orbit.distance = 2.85;
  orbit.minDistance = 1.45;
  orbit.maxDistance = 6.0;
  orbit.elevation = 0.22;
  orbit.azimuth = 0.34;
  orbit.autoSpin = 0.00045;
  orbit.attach(shell.canvas);

  const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x3b4d2e, 0.9);
  const key = new THREE.DirectionalLight(0xffddb5, 1.9);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 14;
  key.shadow.camera.left = -3.2;
  key.shadow.camera.right = 3.2;
  key.shadow.camera.top = 3.2;
  key.shadow.camera.bottom = -3.2;
  key.shadow.bias = -0.0008;
  const rim = new THREE.DirectionalLight(0x8fbaff, 0.95);
  scene.add(hemi, key, rim);

  // HDR Energy-Conserving Bloom pipeline (Loom film.wgsl spirit!)
  const renderPipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode("output");
  const bloomPass = bloom(sceneColor, 0.2, 0.42, 1.05);
  renderPipeline.outputNode = sceneColor.add(bloomPass);

  // Soft grounding shadow disc following pet
  const shadowDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.46, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false }),
  );
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = 0.012;
  scene.add(shadowDisc);

  // Bouncy glowing toy orb for fetch/play
  const orbMat = new THREE.MeshStandardMaterial({
    color: 0xffe48a,
    emissive: 0xffb347,
    emissiveIntensity: 1.4,
    roughness: 0.15,
  });
  const toyOrb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 16), orbMat);
  toyOrb.visible = false;
  scene.add(toyOrb);
  const orbVel = new THREE.Vector3();
  let orbActive = false;

  // 3D Sparkle burst pool
  const sparkles: SparkleParticle[] = [];
  const sparkGeo = new THREE.OctahedronGeometry(0.04, 0);
  const spawnSparkles = (origin: THREE.Vector3, colorHex: number, count = 14) => {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(sparkGeo, mat);
      mesh.position.copy(origin);
      const a = Math.random() * Math.PI * 2;
      const spd = 0.6 + Math.random() * 1.4;
      const vel = new THREE.Vector3(Math.cos(a) * spd, 1.2 + Math.random() * 1.5, Math.sin(a) * spd);
      scene.add(mesh);
      sparkles.push({ mesh, vel, life: 0, maxLife: 0.7 + Math.random() * 0.45 });
    }
  };

  // Active species, brain, rig, and environment state
  let activeSpecies: SpeciesDefinition = SPECIES_CATALOG[0];
  let brain = new PetBrain(activeSpecies);
  let rig: PetModelRig | null = null;
  let envInst: EnvironmentInstance | null = null;
  let activeEnvId: EnvironmentId = "meadow";
  let stageOverride: EvolutionStage | null = null;

  // Physical movement & emotional state
  const petPos = new THREE.Vector3(0, 0, 0);
  const petTargetPos = new THREE.Vector3(0, 0, 0);
  let petHeading = 0;
  let petSpeed = 0;
  let mood: PetMood = "happy";
  let moodTimer = 0;
  let pettedEnergy = 0;
  let speakingEnergy = 0;
  let attentionPulse = 0.2;
  let activeTrick: PetTrick | null = null;
  let trickTime = 0;
  let trickDuration = 1.45;
  let lastCueTrick: PetTrick = "hop";
  const lookTarget = new THREE.Vector3(0, 0.9, 3.0);

  const effectiveStage = (): EvolutionStage => stageOverride ?? brain.stage;

  // Floating speech & status overlays anchored over canvas
  const stageOverlay = document.createElement("div");
  stageOverlay.className = "sm-stage-overlay";
  stageOverlay.innerHTML = `
    <div class="sm-pet-pill">
      <strong data-pet-name>Mochi</strong>
      <span data-pet-stage>Stage 1 · Hatchling</span>
      <span class="sm-xp-track"><span class="sm-xp-fill" data-xp-fill></span></span>
      <span data-pet-bond>♥ 20</span>
    </div>
    <div class="sm-speech-bubble is-hidden" data-speech></div>
  `;
  container.insertBefore(stageOverlay, shell.canvas.nextSibling);

  const petNameEl = stageOverlay.querySelector<HTMLElement>("[data-pet-name]")!;
  const petStageEl = stageOverlay.querySelector<HTMLElement>("[data-pet-stage]")!;
  const xpFillEl = stageOverlay.querySelector<HTMLElement>("[data-xp-fill]")!;
  const petBondEl = stageOverlay.querySelector<HTMLElement>("[data-pet-bond]")!;
  const speechEl = stageOverlay.querySelector<HTMLElement>("[data-speech]")!;

  let speechTimeout = 0;
  const showSpeech = (text: string, durationMs = 6500) => {
    speechEl.textContent = text;
    speechEl.classList.remove("is-hidden");
    clearTimeout(speechTimeout);
    speechTimeout = window.setTimeout(() => speechEl.classList.add("is-hidden"), durationMs);
  };

  // Interactive HUD deck beneath canvas
  const hud = document.createElement("div");
  hud.className = "sm-sanctuary-hud";
  hud.innerHTML = `
    <div class="sm-hud-selectors">
      <div class="sm-selector-row">
        <span class="sm-selector-label">Species</span>
        <div class="sm-chip-group" data-species-bar></div>
      </div>
      <div class="sm-selector-row">
        <span class="sm-selector-label">World</span>
        <div class="sm-chip-group" data-env-bar></div>
      </div>
    </div>

    <div class="sm-hud-tabs" data-tabs>
      <button type="button" class="sm-tab is-active" data-tab="chat">Chat &amp; Play</button>
      <button type="button" class="sm-tab" data-tab="tricks">Teach Moves</button>
      <button type="button" class="sm-tab" data-tab="dream">Dream (AutoResearch)</button>
      <button type="button" class="sm-tab" data-tab="brain">Brain Peek</button>
    </div>

    <div class="sm-tab-pane is-active" data-pane="chat">
      <div class="sm-chat-log" data-chat-log></div>
      <form class="sm-chat-form" data-chat-form>
        <input type="text" class="sm-text-input" data-chat-input placeholder="Say hi, tell them your name, or ask for a trick..." maxlength="120" />
        <button type="submit" class="sm-primary-btn">Send</button>
        <button type="button" class="sm-secondary-btn" data-toss-btn>Toss Orb ✦</button>
      </form>
    </div>

    <div class="sm-tab-pane" data-pane="tricks">
      <p class="sm-pane-hint">Cue a move, watch your companion try it, then tap <strong>Reward ✦</strong> to update their policy weights and raise mastery.</p>
      <div class="sm-tricks-grid" data-tricks-grid></div>
    </div>

    <div class="sm-tab-pane" data-pane="dream">
      <p class="sm-pane-hint">Put your companion to sleep so their WebGPU AutoResearcher replays your episodic memories and evolves lower-loss weights.</p>
      <div class="sm-dream-bar">
        <button type="button" class="sm-primary-btn" data-dream-btn>Start Dream Cycle ☽</button>
        <span class="sm-dream-status" data-dream-status>Awake · 0 dream generations</span>
      </div>
      <div class="sm-research-log" data-dream-log></div>
    </div>

    <div class="sm-tab-pane" data-pane="brain">
      <div class="sm-brain-grid">
        <div class="sm-brain-meta">
          <div class="sm-kv" data-brain-kv></div>
          <div class="sm-brain-raw">
            <span class="sm-selector-label">Raw WebGPU Token Sample</span>
            <code data-raw-sample>(chat once to inspect live logits)</code>
          </div>
          <div class="sm-brain-actions">
            <button type="button" class="sm-secondary-btn" data-train-burst>Train +15 Steps</button>
            <button type="button" class="sm-secondary-btn" data-load-smw>Load .smw Brain</button>
            <button type="button" class="sm-secondary-btn" data-export-smw>Export .smw</button>
            <button type="button" class="sm-secondary-btn" data-reset-pet>Reset Memories</button>
            <input type="file" accept=".smw" style="display:none" data-smw-input />
          </div>
        </div>
        <div class="sm-brain-attn">
          <span class="sm-selector-label">Live Layer-0 Attention Map</span>
          <canvas width="180" height="180" data-attn-canvas></canvas>
        </div>
      </div>
    </div>
  `;
  container.insertBefore(hud, shell.controls);

  const speciesBar = hud.querySelector<HTMLElement>("[data-species-bar]")!;
  const envBar = hud.querySelector<HTMLElement>("[data-env-bar]")!;
  const chatLog = hud.querySelector<HTMLElement>("[data-chat-log]")!;
  const chatForm = hud.querySelector<HTMLFormElement>("[data-chat-form]")!;
  const chatInput = hud.querySelector<HTMLInputElement>("[data-chat-input]")!;
  const tossBtn = hud.querySelector<HTMLButtonElement>("[data-toss-btn]")!;
  const tricksGrid = hud.querySelector<HTMLElement>("[data-tricks-grid]")!;
  const dreamBtn = hud.querySelector<HTMLButtonElement>("[data-dream-btn]")!;
  const dreamStatusEl = hud.querySelector<HTMLElement>("[data-dream-status]")!;
  const dreamLogEl = hud.querySelector<HTMLElement>("[data-dream-log]")!;
  const brainKvEl = hud.querySelector<HTMLElement>("[data-brain-kv]")!;
  const rawSampleEl = hud.querySelector<HTMLElement>("[data-raw-sample]")!;
  const attnCanvas = hud.querySelector<HTMLCanvasElement>("[data-attn-canvas]")!;
  const attnCtx = attnCanvas.getContext("2d")!;

  // Tab switching
  hud.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab!;
      hud.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("is-active", b === btn));
      hud.querySelectorAll<HTMLElement>("[data-pane]").forEach((p) => p.classList.toggle("is-active", p.dataset.pane === target));
    });
  });

  const appendChat = (who: "user" | "pet" | "sys", text: string) => {
    const row = document.createElement("div");
    row.className = `sm-chat-msg is-${who}`;
    row.textContent = who === "user" ? `You: ${text}` : who === "pet" ? `${brain.customName}: ${text}` : text;
    chatLog.appendChild(row);
    chatLog.scrollTop = chatLog.scrollHeight;
  };

  const drawAttentionMap = () => {
    const w = attnCanvas.width;
    const h = attnCanvas.height;
    attnCtx.fillStyle = "#0b0e18";
    attnCtx.fillRect(0, 0, w, h);
    const attn = brain.lastAttention;
    if (!attn) {
      attnCtx.fillStyle = "#677294";
      attnCtx.font = "11px ui-monospace, Menlo, monospace";
      attnCtx.fillText("Chat to sample", 38, h * 0.5);
      return;
    }
    const T = brain.llm?.config.seqLen ?? 48;
    const show = Math.min(24, T);
    const cell = w / show;
    for (let r = 0; r < show; r++) {
      for (let c = 0; c <= r; c++) {
        const p = Math.min(1, attn[r * T + c] * 3.4);
        attnCtx.fillStyle = `rgba(122, 162, 255, ${0.08 + p * 0.92})`;
        attnCtx.fillRect(c * cell, r * cell, cell, cell);
      }
    }
  };

  const syncHud = () => {
    const st = effectiveStage();
    petNameEl.textContent = `${brain.customName} · ${activeSpecies.species}`;
    petStageEl.textContent = `Stage ${st} · ${EVOLUTION_NAMES[st]}`;
    const cap = nextStageXp(st);
    const prevCap = st === 1 ? 0 : st === 2 ? 55 : st === 3 ? 140 : 0;
    const pct = st === 4 ? 100 : Math.min(100, Math.max(4, ((brain.xp - prevCap) / Math.max(1, cap - prevCap)) * 100));
    xpFillEl.style.width = `${pct}%`;
    petBondEl.textContent = `♥ ${Math.round(brain.bond)}`;

    dreamStatusEl.textContent = brain.dreamingNow
      ? "Dreaming & running WebGPU AutoResearch..."
      : `Awake · ${brain.dreamGenerations} dream gens · ${brain.memories.length} memories`;

    brainKvEl.innerHTML = `
      <span>Backend</span><b>${brain.backend}</b>
      <span>Brain Source</span><b>${brain.brainSource}</b>
      <span>Architecture</span><b>${brain.archLabel}</b>
      <span>Parameters</span><b>${(brain.paramCount / 1000).toFixed(1)}K (${(brain.gpuBytes / 1e6).toFixed(1)} MB)</b>
      <span>Online Steps</span><b>${brain.stepsTrained} · loss ${brain.lastLoss.toFixed(2)}</b>
      <span>Decode Speed</span><b>${brain.lastTokPerSec > 0 ? `${brain.lastTokPerSec.toFixed(0)} tok/s` : "—"}</b>
      <span>Model Author</span><b>${activeSpecies.author}</b>
      <span>Saved Memories</span><b>${brain.memories.length}</b>
    `;
    if (brain.lastRawSample) rawSampleEl.textContent = brain.lastRawSample;
    drawAttentionMap();
    renderTricks();
  };

  const triggerEvolutionCelebration = (stage: EvolutionStage) => {
    rig?.setEvolution(stage);
    petAudio.evolve(activeSpecies.voicePitch);
    spawnSparkles(petPos.clone().add(new THREE.Vector3(0, 0.7, 0)), 0xffe484, 26);
    envInst?.pulse(petPos.x, petPos.z, 1.4);
    const msg = `✨ ${brain.customName} evolved into Stage ${stage}: ${EVOLUTION_NAMES[stage]}!`;
    showSpeech(msg, 8000);
    appendChat("sys", msg);
  };

  const startTrick = (trick: PetTrick) => {
    activeTrick = trick;
    lastCueTrick = trick;
    trickTime = 0;
    trickDuration = trick === "dash" ? 1.8 : trick === "sing" ? 1.65 : 1.35;
    mood = "playful";
    moodTimer = 2.4;
    envInst?.pulse(petPos.x, petPos.z, 0.9);
    if (trick === "sing") petAudio.sing(activeSpecies.voicePitch);
    else petAudio.chirp(activeSpecies.voicePitch);
  };

  const renderTricks = () => {
    tricksGrid.replaceChildren();
    for (const tr of TRICK_LIST) {
      const m = brain.trickMastery[tr.id] ?? 0;
      const card = document.createElement("div");
      card.className = "sm-trick-card" + (lastCueTrick === tr.id ? " is-focus" : "");
      card.innerHTML = `
        <div class="sm-trick-top">
          <strong>${tr.emoji} ${tr.label}</strong>
          <span>${Math.round(m * 100)}%</span>
        </div>
        <div class="sm-xp-track"><span class="sm-xp-fill" style="width:${Math.round(m * 100)}%"></span></div>
        <div class="sm-trick-btns">
          <button type="button" class="sm-mini-btn" data-cue>Cue</button>
          <button type="button" class="sm-mini-btn is-reward" data-reward>Reward ✦</button>
        </div>
      `;
      card.querySelector("[data-cue]")!.addEventListener("click", () => {
        startTrick(tr.id);
        showSpeech(`${brain.customName} practices ${tr.label.toLowerCase()}! Tap Reward ✦ to reinforce it.`);
        renderTricks();
      });
      card.querySelector("[data-reward]")!.addEventListener("click", () => {
        startTrick(tr.id);
        const res = brain.rewardTrick(tr.id);
        petAudio.reward(activeSpecies.voicePitch);
        spawnSparkles(petPos.clone().add(new THREE.Vector3(0, 0.85, 0)), 0x5ef0b5, 16);
        pettedEnergy = 1;
        attentionPulse = 1;
        if (res.evolvedTo) triggerEvolutionCelebration(res.evolvedTo);
        else showSpeech(`✦ ${tr.label} policy reinforced! Mastery → ${Math.round(res.mastery * 100)}%`);
        syncHud();
      });
      tricksGrid.appendChild(card);
    }
  };

  const switchEnvironment = (id: EnvironmentId) => {
    activeEnvId = id;
    brain.environmentId = id;
    if (envInst) {
      scene.remove(envInst.group);
      envInst.dispose();
    }
    const meta = ENVIRONMENTS.find((e) => e.id === id) ?? ENVIRONMENTS[0];
    envInst = createEnvironment(meta.id);
    scene.add(envInst.group);
    applyEnvironmentBackdrop(scene, { hemi, key, rim }, meta, brain.dreamingNow);
    envBar.querySelectorAll(".sm-chip").forEach((el) => el.classList.toggle("is-active", (el as HTMLElement).dataset.env === id));
    void brain.persist();
  };

  const switchSpecies = async (specId: string) => {
    const spec = getSpeciesById(specId);
    activeSpecies = spec;
    stageOverride = null;
    speciesBar.querySelectorAll(".sm-chip").forEach((el) => el.classList.toggle("is-active", (el as HTMLElement).dataset.spec === spec.id));

    if (rig) {
      scene.remove(rig.root);
      rig.dispose();
    }
    rig = spec.buildRig();
    petPos.set(0, 0, 0);
    petTargetPos.set(0, 0, 0);
    rig.root.position.copy(petPos);
    scene.add(rig.root);

    brain.llm?.dispose();
    brain = new PetBrain(spec);
    chatLog.replaceChildren();
    showSpeech(`Waking ${spec.name}'s WebGPU brain...`, 4000);
    await brain.init((msg) => showSpeech(msg, 3500));

    rig.setEvolution(effectiveStage());
    switchEnvironment(brain.environmentId);
    appendChat("sys", `${spec.name} the ${spec.species} is awake (${brain.backend} · ${(brain.paramCount / 1000).toFixed(1)}K params).`);
    if (brain.memories.length > 0) {
      const lastMem = brain.memories[brain.memories.length - 1];
      appendChat("pet", `Welcome back! I remember talking about "${lastMem.topic}"!`);
    } else {
      appendChat("pet", `${spec.favoriteWords[0]}! I'm ${spec.name}. Chat with me, pet me, or toss a glowing orb!`);
    }
    showSpeech(`${spec.favoriteWords[0]}! I'm ${spec.name}!`, 4500);
    syncHud();
  };

  // Populate Species & Environment selector bars
  for (const s of SPECIES_CATALOG) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sm-chip";
    b.dataset.spec = s.id;
    b.innerHTML = `<span class="sm-dot" style="background:${s.accentHex}"></span>${s.name}`;
    b.title = `${s.name} — ${s.species} (${s.tagline})`;
    b.addEventListener("click", () => void switchSpecies(s.id));
    speciesBar.appendChild(b);
  }
  for (const e of ENVIRONMENTS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sm-chip";
    b.dataset.env = e.id;
    b.textContent = e.name;
    b.title = `Inspired by ${e.inspiredBy}: ${e.tagline}`;
    b.addEventListener("click", () => switchEnvironment(e.id));
    envBar.appendChild(b);
  }

  // Toss a bouncy glowing toy orb
  const tossOrb = (targetX?: number, targetZ?: number) => {
    const angle = Math.random() * Math.PI * 2;
    const dist = 1.1 + Math.random() * 0.65;
    const tx = targetX ?? Math.cos(angle) * dist;
    const tz = targetZ ?? Math.sin(angle) * dist;
    toyOrb.position.set(petPos.x, 1.35, petPos.z);
    orbVel.set((tx - petPos.x) * 1.45, 2.2, (tz - petPos.z) * 1.45);
    toyOrb.visible = true;
    orbActive = true;
    mood = "playful";
    moodTimer = 4.0;
    petAudio.chirp(activeSpecies.voicePitch * 1.15);
  };

  tossBtn.addEventListener("click", () => tossOrb());

  // Chat submit handler -> pure WebGPU inference + continual online learning!
  let chatting = false;
  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const txt = chatInput.value.trim();
    if (!txt || chatting || !brain.ready) return;
    chatInput.value = "";
    chatting = true;
    appendChat("user", txt);
    mood = "thinking";
    moodTimer = 3.0;
    attentionPulse = 1.0;

    void brain
      .chat(txt)
      .then((res) => {
        appendChat("pet", res.text);
        showSpeech(res.text, 7000);
        speakingEnergy = 1.0;
        attentionPulse = 0.9;
        mood = res.mood;
        moodTimer = 4.0;
        if (res.triggeredTrick) startTrick(res.triggeredTrick);
        else petAudio.chirp(activeSpecies.voicePitch);
        if (res.evolvedTo) triggerEvolutionCelebration(res.evolvedTo);
        syncHud();
      })
      .finally(() => {
        chatting = false;
      });
  });

  // Dream Mode (AutoResearch Consolidation)
  dreamBtn.addEventListener("click", () => {
    if (brain.dreamingNow || !brain.ready) return;
    mood = "dreaming";
    moodTimer = 15;
    const meta = ENVIRONMENTS.find((e) => e.id === activeEnvId) ?? ENVIRONMENTS[0];
    applyEnvironmentBackdrop(scene, { hemi, key, rim }, meta, true);
    syncHud();

    void brain
      .runDreamCycle((msg, node) => {
        dreamStatusEl.textContent = msg;
        attentionPulse = 0.85;
        if (node) {
          const row = document.createElement("div");
          row.className = `sm-exp-row is-${node.status}`;
          row.innerHTML = `<span class="sm-exp-badge">${node.status === "kept" ? "KEEP" : "EXPLORE"} #${brain.dreamGenerations}</span><span class="sm-exp-diff"></span><span class="sm-exp-score">${node.valBpb.toFixed(3)} bpb</span>`;
          row.querySelector(".sm-exp-diff")!.textContent = node.diff;
          dreamLogEl.prepend(row);
        }
      })
      .then((res) => {
        applyEnvironmentBackdrop(scene, { hemi, key, rim }, meta, false);
        mood = "proud";
        moodTimer = 3.5;
        petAudio.reward(activeSpecies.voicePitch);
        spawnSparkles(petPos.clone().add(new THREE.Vector3(0, 0.9, 0)), 0x7aa2ff, 20);
        if (res.evolvedTo) triggerEvolutionCelebration(res.evolvedTo);
        else showSpeech(`Woke up wiser! Dream #${brain.dreamGenerations} finished (loss ${brain.lastLoss.toFixed(2)}).`);
        syncHud();
      });
  });

  // Brain Peek buttons
  hud.querySelector("[data-train-burst]")!.addEventListener("click", () => {
    if (brain.trainingNow || !brain.ready) return;
    attentionPulse = 1;
    const burstLr = brain.isPretrained ? 0.0008 : 0.007;
    showSpeech("Running 15 online WebGPU gradient steps...");
    void brain.runOnlineSteps(15, burstLr).then((loss) => {
      showSpeech(`Done! Loss is now ${loss.toFixed(3)} (${brain.stepsTrained} total steps).`);
      void brain.persist();
      syncHud();
    });
  });

  const smwInput = hud.querySelector<HTMLInputElement>("[data-smw-input]")!;
  hud.querySelector("[data-load-smw]")!.addEventListener("click", () => {
    if (!brain.ready) return;
    smwInput.value = "";
    smwInput.click();
  });
  smwInput.addEventListener("change", () => {
    const file = smwInput.files?.[0];
    if (!file) return;
    showSpeech(`Loading ${file.name} onto WebGPU...`, 4000);
    void file
      .arrayBuffer()
      .then((buf) => {
        const ckpt = decodeCheckpoint(buf);
        return brain.loadCheckpoint(ckpt, { label: `Imported (${file.name})` }).then(() => ckpt);
      })
      .then((ckpt) => {
        const kb = (ckpt.byteLength / 1024).toFixed(0);
        appendChat(
          "sys",
          `Loaded ${file.name} (${(ckpt.paramCount / 1000).toFixed(1)}K params · ${kb} KB ${ckpt.quant.toUpperCase()} · ${brain.archLabel}).`,
        );
        showSpeech(`Loaded ${(ckpt.paramCount / 1000).toFixed(0)}K brain from ${file.name}! Try chatting with me!`, 5500);
        spawnSparkles(petPos.clone().add(new THREE.Vector3(0, 0.85, 0)), 0x7aa2ff, 22);
        syncHud();
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        appendChat("sys", `Failed to load ${file.name}: ${msg}`);
        showSpeech(`Could not load ${file.name}: ${msg}`, 5000);
      });
  });

  hud.querySelector("[data-export-smw]")!.addEventListener("click", () => {
    if (!brain.ready) return;
    void brain.exportCheckpoint().then((bytes) => {
      const slug = brain.species.id;
      downloadCheckpointFile(bytes, `${slug}-small-minds.smw`);
      showSpeech(`Exported ${slug}-small-minds.smw (${(bytes.byteLength / 1024).toFixed(0)} KB Q8).`, 4500);
    });
  });

  hud.querySelector("[data-reset-pet]")!.addEventListener("click", () => {
    void brain.resetProgress().then(() => {
      rig?.setEvolution(effectiveStage());
      appendChat("sys", `Reset ${brain.customName}'s memories and weights.`);
      syncHud();
    });
  });

  // Shell quick buttons (sound + fullscreen)
  const muteBtn = shell.button("sound: on", () => {
    petAudio.muted = !petAudio.muted;
    muteBtn.textContent = `sound: ${petAudio.muted ? "off" : "on"}`;
  });
  shell.button("pet ♥", () => {
    pettedEnergy = 1;
    mood = "happy";
    moodTimer = 3;
    petAudio.purr(activeSpecies.voicePitch);
    spawnSparkles(petPos.clone().add(new THREE.Vector3(0, 0.85, 0)), 0xff9ec4, 16);
    envInst?.pulse(petPos.x, petPos.z, 0.8);
    const evo = brain.registerAffection(7, 4);
    if (evo) triggerEvolutionCelebration(evo);
    syncHud();
  });

  // Direct 3D Raycasting on canvas (tap pet to pet them, double-click ground to toss orb!)
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let downX = 0;
  let downY = 0;
  let lastClickAt = 0;

  const setPointerFromEvent = (e: PointerEvent) => {
    const r = shell.canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  };

  shell.canvas.addEventListener("pointerdown", (e) => {
    downX = e.clientX;
    downY = e.clientY;
  });
  shell.canvas.addEventListener("pointermove", (e) => {
    setPointerFromEvent(e);
    raycaster.setFromCamera(pointer, camera);
    const hitPt = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, hitPt)) {
      lookTarget.set(
        THREE.MathUtils.clamp(hitPt.x, -2.5, 2.5),
        0.75,
        THREE.MathUtils.clamp(hitPt.z, -2.5, 2.5),
      );
    }
  });
  shell.canvas.addEventListener("pointerup", (e) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 7) return; // was an orbit drag
    setPointerFromEvent(e);
    raycaster.setFromCamera(pointer, camera);

    if (rig) {
      const hits = raycaster.intersectObjects(rig.hitMeshes, true);
      if (hits.length > 0) {
        pettedEnergy = 1.0;
        mood = "happy";
        moodTimer = 3.2;
        petAudio.purr(activeSpecies.voicePitch);
        spawnSparkles(hits[0].point, 0xff9ec4, 15);
        envInst?.pulse(petPos.x, petPos.z, 0.85);
        const evo = brain.registerAffection(6, 3);
        if (evo) triggerEvolutionCelebration(evo);
        else showSpeech(`${activeSpecies.favoriteWords[0]}! ♥`, 2600);
        syncHud();
        return;
      }
    }

    const now = performance.now();
    const hitPt = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, hitPt)) {
      const r = Math.hypot(hitPt.x, hitPt.z);
      if (r < 2.4) {
        if (now - lastClickAt < 360) {
          tossOrb(hitPt.x, hitPt.z);
        } else {
          // Single tap on floor: pet wanders curiously over!
          petTargetPos.set(hitPt.x, 0, hitPt.z);
          envInst?.pulse(hitPt.x, hitPt.z, 0.55);
        }
      }
    }
    lastClickAt = now;
  });

  // ---- Hook into the site's native `;` Debug Mode! -------------------------
  const dbg = pageDebug();
  dbg.rows("companion", () => {
    const envMeta = ENVIRONMENTS.find((e) => e.id === activeEnvId)!;
    return [
      ["species", `${activeSpecies.name} (${activeSpecies.species})`],
      ["model author", activeSpecies.author],
      ["evolution", `Stage ${effectiveStage()} · ${EVOLUTION_NAMES[effectiveStage()]}`],
      ["environment", `${envMeta.name} (${envMeta.inspiredBy})`],
      ["llm backend", brain.backend],
      ["brain source", brain.brainSource],
      ["llm arch", brain.archLabel],
      ["llm params", `${(brain.paramCount / 1000).toFixed(1)}K · ${(brain.gpuBytes / 1e6).toFixed(1)} MB`],
      ["train / loss", `${brain.stepsTrained} steps · ${brain.lastLoss.toFixed(3)}`],
      ["decode", brain.lastTokPerSec > 0 ? `${brain.lastTokPerSec.toFixed(0)} tok/s` : "–"],
      ["dreams / mems", `${brain.dreamGenerations} gens · ${brain.memories.length} mems`],
    ];
  });
  dbg.action("preview next stage", () => {
    const next = (((effectiveStage() % 4) + 1) as EvolutionStage);
    stageOverride = next;
    rig?.setEvolution(next);
    spawnSparkles(petPos.clone().add(new THREE.Vector3(0, 0.8, 0)), 0xffe484, 18);
    syncHud();
  });
  dbg.action("+60 XP boost", () => {
    stageOverride = null;
    const evo = brain.registerAffection(60, 15);
    if (evo) triggerEvolutionCelebration(evo);
    syncHud();
  });
  dbg.action("auto-trick", () => startTrick(brain.pickAutonomousTrick()));

  shell.setInfo(
    () =>
      `${activeSpecies.name} (${activeSpecies.species}) · Stage ${effectiveStage()} · ${brain.backend} · ${brain.stepsTrained} steps · press ; for debug`,
  );

  // Boot initial species
  await switchSpecies(SPECIES_CATALOG[0].id);

  let prevTime = performance.now() * 0.001;
  let wanderTimer = 4.0;

  return {
    frame() {
      shell.tick();
      const now = performance.now() * 0.001;
      const dt = Math.min(0.05, Math.max(0.001, now - prevTime));
      prevTime = now;

      // Update bouncy toy orb & pet chasing
      if (orbActive) {
        orbVel.y -= 7.2 * dt;
        toyOrb.position.addScaledVector(orbVel, dt);
        if (toyOrb.position.y < 0.11) {
          toyOrb.position.y = 0.11;
          orbVel.y = Math.abs(orbVel.y) * 0.56;
          orbVel.x *= 0.84;
          orbVel.z *= 0.84;
          envInst?.pulse(toyOrb.position.x, toyOrb.position.z, 0.5);
        }
        petTargetPos.set(toyOrb.position.x, 0, toyOrb.position.z);
        lookTarget.copy(toyOrb.position);
        const distToOrb = Math.hypot(toyOrb.position.x - petPos.x, toyOrb.position.z - petPos.z);
        if (distToOrb < 0.34 && toyOrb.position.y < 0.32) {
          orbActive = false;
          toyOrb.visible = false;
          spawnSparkles(toyOrb.position, 0xffe484, 18);
          petAudio.reward(activeSpecies.voicePitch);
          startTrick("hop");
          const evo = brain.registerAffection(11, 5);
          if (evo) triggerEvolutionCelebration(evo);
          else showSpeech(`Caught it! ${activeSpecies.favoriteWords[0]}!`, 3000);
          syncHud();
        }
      } else if (!brain.dreamingNow && !activeTrick) {
        // Gentle curious wandering
        wanderTimer -= dt;
        if (wanderTimer <= 0) {
          wanderTimer = 4.5 + Math.random() * 5.0;
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 0.9;
          petTargetPos.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        }
      }

      // Move pet smoothly toward target
      const dx = petTargetPos.x - petPos.x;
      const dz = petTargetPos.z - petPos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.05 && !brain.dreamingNow) {
        const moveSpd = orbActive ? 1.85 : 0.72;
        const step = Math.min(dist, moveSpd * dt);
        petPos.x += (dx / dist) * step;
        petPos.z += (dz / dist) * step;
        petSpeed = step / dt;
        const wantHead = Math.atan2(dx, dz);
        let diff = wantHead - petHeading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        petHeading += diff * Math.min(1, dt * 7);
      } else {
        petSpeed = THREE.MathUtils.lerp(petSpeed, 0, Math.min(1, dt * 8));
      }

      // Advance trick timer
      let trickPhase = 0;
      if (activeTrick) {
        trickTime += dt;
        trickPhase = Math.min(1, trickTime / trickDuration);
        if (trickTime >= trickDuration) {
          activeTrick = null;
          trickPhase = 0;
        }
      }

      // Decay transient energies
      pettedEnergy = Math.max(0, pettedEnergy - dt * 0.9);
      speakingEnergy = Math.max(0, speakingEnergy - dt * 0.55);
      attentionPulse = THREE.MathUtils.lerp(attentionPulse, brain.trainingNow || brain.dreamingNow ? 0.85 : 0.18, dt * 2.5);
      if (moodTimer > 0 && !brain.dreamingNow) {
        moodTimer -= dt;
        if (moodTimer <= 0) mood = "idle";
      }

      // Update 3D pet rig
      if (rig) {
        rig.root.position.copy(petPos);
        rig.root.rotation.y = petHeading;
        rig.update({
          time: now,
          dt,
          mood: brain.dreamingNow ? "dreaming" : mood,
          evolution: effectiveStage(),
          energy: 0.8,
          affection: brain.bond / 100,
          speaking: speakingEnergy,
          listening: document.activeElement === chatInput ? 1 : 0,
          attentionPulse,
          petted: pettedEnergy,
          lookTarget,
          activeTrick,
          trickPhase,
          speed: petSpeed,
        });
      }
      shadowDisc.position.set(petPos.x, 0.012, petPos.z);

      // Update environment & sparkles
      envInst?.update(now, dt, brain.dreamingNow, petPos);
      for (let i = sparkles.length - 1; i >= 0; i--) {
        const sp = sparkles[i];
        sp.life += dt;
        if (sp.life >= sp.maxLife) {
          scene.remove(sp.mesh);
          (sp.mesh.material as THREE.Material).dispose();
          sparkles.splice(i, 1);
          continue;
        }
        sp.vel.y -= 2.2 * dt;
        sp.mesh.position.addScaledVector(sp.vel, dt);
        sp.mesh.rotation.y += dt * 5;
        const fade = 1 - sp.life / sp.maxLife;
        sp.mesh.scale.setScalar(fade);
        (sp.mesh.material as THREE.MeshBasicMaterial).opacity = fade;
      }

      orbit.apply(camera);
      renderPipeline.render();
    },
    dispose() {
      rig?.dispose();
      envInst?.dispose();
      envTex.dispose();
      brain.llm?.dispose();
      renderer.dispose();
    },
  };
}

// ---- 2. Fig 1 (below in essay): Interactive Species & Evolution Gallery ----

export async function mountSpeciesGallery(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.5);
  const renderer = new THREE.WebGPURenderer({ canvas: shell.canvas, antialias: true });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(shell.canvas.width, shell.canvas.height, false);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 0.96;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const envTex = createStudioEnvTexture(renderer);
  scene.environment = envTex;
  scene.environmentIntensity = 0.42;

  const camera = new THREE.PerspectiveCamera(34, shell.canvas.width / shell.canvas.height, 0.05, 40);
  const orbit = new Orbit3D();
  orbit.target.set(0, 0.48, 0);
  orbit.distance = 2.55;
  orbit.elevation = 0.2;
  orbit.azimuth = 0.35;
  orbit.autoSpin = 0.0055;
  orbit.attach(shell.canvas);

  const hemi = new THREE.HemisphereLight(0xc2d8ff, 0x2c2a3a, 1.0);
  const key = new THREE.DirectionalLight(0xfff0dd, 1.9);
  key.position.set(2.5, 3.8, 2.4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const rim = new THREE.DirectionalLight(0x7aa2ff, 0.95);
  rim.position.set(-2.4, 2.2, -2.5);
  scene.add(hemi, key, rim);

  const renderPipeline = new THREE.RenderPipeline(renderer);
  const gPass = pass(scene, camera);
  const gColor = gPass.getTextureNode("output");
  renderPipeline.outputNode = gColor.add(bloom(gColor, 0.22, 0.45, 0.92));

  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.95, 1.05, 0.1, 64),
    new THREE.MeshStandardMaterial({ color: 0x161926, roughness: 0.4, metalness: 0.38 }),
  );
  pedestal.position.y = -0.05;
  pedestal.receiveShadow = true;
  scene.add(pedestal);

  let idx = 0;
  let stage: EvolutionStage = 4;
  let rig: PetModelRig | null = null;
  let activeTrick: PetTrick | null = null;
  let trickT = 0;

  const loadIdx = (newIdx: number) => {
    idx = (newIdx + SPECIES_CATALOG.length) % SPECIES_CATALOG.length;
    if (rig) {
      scene.remove(rig.root);
      rig.dispose();
    }
    rig = SPECIES_CATALOG[idx].buildRig();
    rig.setEvolution(stage);
    scene.add(rig.root);
  };
  loadIdx(0);

  shell.button("prev species", () => loadIdx(idx - 1));
  shell.button("next species", () => loadIdx(idx + 1));
  shell.slider({
    label: "evolution stage",
    min: 1,
    max: 4,
    step: 1,
    value: stage,
    format: (v) => `Stage ${v} · ${EVOLUTION_NAMES[v as EvolutionStage]}`,
    onInput: (v) => {
      stage = Math.round(v) as EvolutionStage;
      rig?.setEvolution(stage);
    },
  });
  shell.button("perform trick", () => {
    const picks: PetTrick[] = ["hop", "spin", "sing", "bow", "flip"];
    activeTrick = picks[Math.floor(Math.random() * picks.length)];
    trickT = 0;
  });

  shell.setInfo(() => {
    const s = SPECIES_CATALOG[idx];
    return `${s.name} — ${s.species} · Stage ${stage} (${EVOLUTION_NAMES[stage]}) · model by ${s.author}`;
  });

  const lookPt = new THREE.Vector3(0, 0.8, 3);
  let prev = performance.now() * 0.001;

  return {
    frame() {
      shell.tick();
      const now = performance.now() * 0.001;
      const dt = Math.min(0.05, Math.max(0.001, now - prev));
      prev = now;

      let phase = 0;
      if (activeTrick) {
        trickT += dt;
        phase = Math.min(1, trickT / 1.35);
        if (trickT >= 1.35) activeTrick = null;
      }

      rig?.update({
        time: now,
        dt,
        mood: "happy",
        evolution: stage,
        energy: 0.9,
        affection: 0.85,
        speaking: 0,
        listening: 0,
        attentionPulse: 0.45 + 0.35 * Math.sin(now * 2.2),
        petted: 0,
        lookTarget: lookPt,
        activeTrick,
        trickPhase: phase,
        speed: 0,
      });

      orbit.apply(camera);
      renderPipeline.render();
    },
    dispose() {
      rig?.dispose();
      envTex.dispose();
      renderer.dispose();
    },
  };
}
