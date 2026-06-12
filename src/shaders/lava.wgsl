// Lava-lamp SPH: part three's double-density relaxation, plus one new scalar
// per particle — temperature. Heat enters near the coil at the bottom, leaks
// out everywhere (faster near the top), and diffuses between neighbours in
// the same loop that already sums density. Temperature feeds back into the
// dynamics twice: the rest density falls as a particle warms (thermal
// expansion, so hot wax genuinely takes more room) and a direct buoyancy
// term lifts warm particles, because the water the wax floats in is not
// simulated and somebody has to do its job.
//
// The lamp is not a box: walls are a taper, wide at the base, narrow at the
// throat, enforced with the same penalty springs as everywhere else in the
// series.

struct Particle2 {
  pv: vec4f,  // pos.xy, vel.zw
  aux: vec4f, // x: temperature (0 cold .. ~1 hot), yzw free
}

struct LavaParams {
  count: u32,
  grid: u32,
  cell: f32,
  dt: f32,
  gravity: f32,
  stiffness: f32,
  restDensity: f32,
  nearStiffness: f32,
  xsph: f32,
  wallK: f32,
  beta: f32,       // thermal expansion: rest density scales by (1 - beta*T)
  buoyancy: f32,   // direct lift per unit temperature
  heatRate: f32,
  coolRate: f32,
  diffusion: f32,
  heaterY: f32,    // heat is injected below this height
  mouse: vec2f,
  mouseVel: vec2f,
  mouseRadius: f32,
  mouseStrength: f32,
  wallBottom: f32, // half-width of the vessel at floorY
  wallTop: f32,    // half-width at topY
  floorY: f32,
  topY: f32,
  _pad: vec2f,
}

@group(0) @binding(0) var<uniform> LP: LavaParams;
@group(0) @binding(1) var<storage, read_write> parts: array<Particle2>;
@group(0) @binding(2) var<storage, read> cellStart: array<u32>;
@group(0) @binding(3) var<storage, read> cellCount: array<u32>;
@group(0) @binding(4) var<storage, read_write> density: array<vec4f>; // rho, rhoNear, tFlux, _

fn cellCoord(p: vec2f) -> vec2i {
  let g = f32(LP.grid);
  return vec2i(
    i32(clamp((p.x + 1.0) * 0.5 * g, 0.0, g - 1.0)),
    i32(clamp((p.y + 1.0) * 0.5 * g, 0.0, g - 1.0)),
  );
}

// Vessel half-width at height y: linear taper between base and throat.
fn vesselHalfWidth(y: f32) -> f32 {
  let t = clamp((y - LP.floorY) / (LP.topY - LP.floorY), 0.0, 1.0);
  return mix(LP.wallBottom, LP.wallTop, t);
}

@compute @workgroup_size(256)
fn densityPass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= LP.count) { return; }
  let pi = parts[i].pv.xy;
  let ti = parts[i].aux.x;
  let h = LP.cell;
  let cc = cellCoord(pi);
  var rho = 0.0;
  var rhoNear = 0.0;
  var tFlux = 0.0; // kernel-weighted sum of (T_j - T_i): heat conduction
  for (var oy = -1; oy <= 1; oy++) {
    for (var ox = -1; ox <= 1; ox++) {
      let c = cc + vec2i(ox, oy);
      if (c.x < 0 || c.y < 0 || c.x >= i32(LP.grid) || c.y >= i32(LP.grid)) { continue; }
      let ci = u32(c.y) * LP.grid + u32(c.x);
      let s = cellStart[ci];
      let n = cellCount[ci];
      for (var k = s; k < s + n; k++) {
        let q = length(parts[k].pv.xy - pi) / h;
        if (q < 1.0) {
          let w = 1.0 - q;
          rho += w * w;
          rhoNear += w * w * w;
          tFlux += (parts[k].aux.x - ti) * w;
        }
      }
    }
  }
  density[i] = vec4f(rho, rhoNear, tFlux, 0.0);
}

@compute @workgroup_size(256)
fn forcePass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= LP.count) { return; }
  var p = parts[i];
  let h = LP.cell;
  let di = density[i];
  let ti = p.aux.x;

  // thermal expansion: a warm particle is satisfied with fewer neighbours
  let restI = LP.restDensity * (1.0 - LP.beta * ti);
  let pressI = LP.stiffness * (di.x - restI);
  let nearI = LP.nearStiffness * di.y;
  let cc = cellCoord(p.pv.xy);

  var acc = vec2f(0.0, -LP.gravity + LP.buoyancy * ti);
  var dv = vec2f(0.0);
  for (var oy = -1; oy <= 1; oy++) {
    for (var ox = -1; ox <= 1; ox++) {
      let c = cc + vec2i(ox, oy);
      if (c.x < 0 || c.y < 0 || c.x >= i32(LP.grid) || c.y >= i32(LP.grid)) { continue; }
      let ci = u32(c.y) * LP.grid + u32(c.x);
      let s = cellStart[ci];
      let n = cellCount[ci];
      for (var k = s; k < s + n; k++) {
        if (k == i) { continue; }
        let d = parts[k].pv.xy - p.pv.xy;
        let r = length(d);
        let q = r / h;
        if (q < 1.0 && r > 1e-7) {
          let dj = density[k];
          let restJ = LP.restDensity * (1.0 - LP.beta * parts[k].aux.x);
          let press = 0.5 * (pressI + LP.stiffness * (dj.x - restJ));
          let near = 0.5 * (nearI + LP.nearStiffness * dj.y);
          let w = 1.0 - q;
          acc -= (d / r) * (press * w + near * w * w);
          dv += (parts[k].pv.zw - p.pv.zw) * w;
        }
      }
    }
  }

  // stirring: cursor drags nearby wax along its own velocity
  let md = p.pv.xy - LP.mouse;
  let mr = length(md);
  if (mr < LP.mouseRadius) {
    acc += LP.mouseVel * LP.mouseStrength * (1.0 - mr / LP.mouseRadius);
  }

  // tapered vessel: penalty springs against a width that depends on height
  let hw = vesselHalfWidth(p.pv.y);
  if (p.pv.x < -hw) { acc.x += (-hw - p.pv.x) * LP.wallK; }
  if (p.pv.x > hw) { acc.x -= (p.pv.x - hw) * LP.wallK; }
  if (p.pv.y < LP.floorY) { acc.y += (LP.floorY - p.pv.y) * LP.wallK; }
  if (p.pv.y > LP.topY) { acc.y -= (p.pv.y - LP.topY) * LP.wallK; }

  // --- temperature update ---------------------------------------------------
  var t = ti + LP.diffusion * di.z; // conduction between neighbours
  // the coil: heat pours in near the floor, fading with height — and the
  // coil sits under the *middle* of the pool, so the centre warms first and
  // plumes detach there instead of crawling up the glass
  let heatZone = LP.heaterY - LP.floorY;
  if (p.pv.y < LP.heaterY) {
    let f = 1.0 - (p.pv.y - LP.floorY) / max(heatZone, 1e-4);
    let cx = p.pv.x / (LP.wallBottom * 0.35);
    let centre = max(1.0 - cx * cx, 0.0);
    t += LP.heatRate * LP.dt * clamp(f, 0.0, 1.0) * centre;
  }
  // radiative loss: almost nothing mid-flight so blobs ride the full height,
  // then a hard chill concentrated in the throat so they stall and sink
  let topF = smoothstep(LP.topY - 0.28, LP.topY, p.pv.y);
  let wallF = smoothstep(hw - 0.08, hw, abs(p.pv.x));
  t -= LP.coolRate * LP.dt * t * (0.35 + 5.0 * topF + 0.4 * wallF);
  t = clamp(t, 0.0, 1.15);

  var vel = (p.pv.zw + acc * LP.dt) * 0.9996;
  // viscosity falls as wax warms: cold wax is sluggish, hot wax is runny
  vel += dv * LP.xsph * (1.0 - 0.3 * clamp(t, 0.0, 1.0));
  let speed = length(vel);
  if (speed > 2.2) { vel *= 2.2 / speed; } // CFL safety valve, gooier than water
  parts[i] = Particle2(vec4f(p.pv.xy + vel * LP.dt, vel), vec4f(t, p.aux.yzw));
}
