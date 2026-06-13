// Ferrofluid SPH: the lava lamp's double-density relaxation core, with the
// thermodynamics removed and two forces promoted to stars of the show —
// surface tension (Akinci-style cohesion, the same kernel the lamp uses) and
// a magnet. The magnet force is the gradient of a dipole field's energy
// density, F ∝ ∇|B|²: it pulls fluid toward the magnet, hardest along the
// dipole axis, and sideways *toward* the axis — which is what piles the
// fluid into a spike instead of a blob. Surface tension and gravity push
// back, and the three-way fight is the whole phenomenon.

struct Particle2 {
  pv: vec4f,  // pos.xy, vel.zw
  aux: vec4f, // unused here (kept for layout parity with the sorter)
}

struct FerroParams {
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
  tension: f32,     // pairwise cohesion strength
  magStrength: f32, // magnet pull; 0 = magnet off
  mag: vec2f,       // magnet position, world units
  magDir: vec2f,    // dipole axis, unit vector
  magSoft: f32,     // softening radius so the pull stays finite up close
  floorY: f32,
  wallX: f32,       // tray half-width
  topY: f32,
}

@group(0) @binding(0) var<uniform> FP: FerroParams;
@group(0) @binding(1) var<storage, read_write> parts: array<Particle2>;
@group(0) @binding(2) var<storage, read> cellStart: array<u32>;
@group(0) @binding(3) var<storage, read> cellCount: array<u32>;
@group(0) @binding(4) var<storage, read_write> density: array<vec4f>; // rho, rhoNear, _, _

// Cohesion kernel (Akinci, Akinci & Teschner 2013), normalized so the
// attractive peak at q = 0.5 is exactly 1 and the core bottoms out at -1.
fn cohesionW(q: f32) -> f32 {
  let a = (1.0 - q) * (1.0 - q) * (1.0 - q) * q * q * q;
  if (q < 0.5) { return 64.0 * (2.0 * a - 0.015625); }
  return 64.0 * a;
}

fn cellCoord(p: vec2f) -> vec2i {
  let g = f32(FP.grid);
  return vec2i(
    i32(clamp((p.x + 1.0) * 0.5 * g, 0.0, g - 1.0)),
    i32(clamp((p.y + 1.0) * 0.5 * g, 0.0, g - 1.0)),
  );
}

@compute @workgroup_size(256)
fn densityPass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= FP.count) { return; }
  let pi = parts[i].pv.xy;
  let h = FP.cell;
  let h2 = h * h;
  let cc = cellCoord(pi);
  var rho = 0.0;
  var rhoNear = 0.0;
  for (var oy = -1; oy <= 1; oy++) {
    for (var ox = -1; ox <= 1; ox++) {
      let c = cc + vec2i(ox, oy);
      if (c.x < 0 || c.y < 0 || c.x >= i32(FP.grid) || c.y >= i32(FP.grid)) { continue; }
      let ci = u32(c.y) * FP.grid + u32(c.x);
      let s = cellStart[ci];
      let n = cellCount[ci];
      for (var k = s; k < s + n; k++) {
        let d = parts[k].pv.xy - pi;
        let r2 = dot(d, d);
        if (r2 < h2) {
          let q = sqrt(r2) / h;
          let w = 1.0 - q;
          rho += w * w;
          rhoNear += w * w * w;
        }
      }
    }
  }
  density[i] = vec4f(rho, rhoNear, 0.0, 0.0);
}

@compute @workgroup_size(256)
fn forcePass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= FP.count) { return; }
  var p = parts[i];
  let h = FP.cell;
  let h2 = h * h;
  let di = density[i];

  let pressI = FP.stiffness * (di.x - FP.restDensity);
  let nearI = FP.nearStiffness * di.y;
  let cc = cellCoord(p.pv.xy);

  var acc = vec2f(0.0, -FP.gravity);
  var dv = vec2f(0.0);
  for (var oy = -1; oy <= 1; oy++) {
    for (var ox = -1; ox <= 1; ox++) {
      let c = cc + vec2i(ox, oy);
      if (c.x < 0 || c.y < 0 || c.x >= i32(FP.grid) || c.y >= i32(FP.grid)) { continue; }
      let ci = u32(c.y) * FP.grid + u32(c.x);
      let s = cellStart[ci];
      let n = cellCount[ci];
      for (var k = s; k < s + n; k++) {
        if (k == i) { continue; }
        let d = parts[k].pv.xy - p.pv.xy;
        let r2 = dot(d, d);
        if (r2 < h2 && r2 > 1e-14) {
          let r = sqrt(r2);
          let q = r / h;
          let dj = density[k];
          let press = 0.5 * (pressI + FP.stiffness * (dj.x - FP.restDensity));
          let near = 0.5 * (nearI + FP.nearStiffness * dj.y);
          let w = 1.0 - q;
          acc -= (d / r) * (press * w + near * w * w);
          acc += (d / r) * (FP.tension * cohesionW(q));
          dv += (parts[k].pv.zw - p.pv.zw) * w;
        }
      }
    }
  }

  // --- the magnet -------------------------------------------------------------
  // F ∝ ∇|B|² for a point dipole. |B|² ∝ (3cos²θ + 1)/r⁶, so the gradient has
  // a radial term (toward the magnet, strongest on-axis) and an angular term
  // (toward the axis). The true 1/r⁷ falloff is too vicious for a toy, so the
  // softened (r²+s²)² stands in — same shape near the magnet, kinder far away.
  if (FP.magStrength > 0.0) {
    let dm = p.pv.xy - FP.mag;
    let r2 = dot(dm, dm) + FP.magSoft * FP.magSoft;
    let rl = sqrt(r2);
    let rhat = dm / rl;
    let cth = dot(FP.magDir, rhat);
    let falloff = 0.001 / (r2 * r2);
    var macc = FP.magStrength * falloff *
      (6.0 * cth * (FP.magDir - cth * rhat) - 6.0 * (3.0 * cth * cth + 1.0) * rhat);
    let ml = length(macc);
    if (ml > 90.0) { macc *= 90.0 / ml; }
    acc += macc;
  }

  // tray: penalty springs, the series' usual walls
  if (p.pv.x < -FP.wallX) { acc.x += (-FP.wallX - p.pv.x) * FP.wallK; }
  if (p.pv.x > FP.wallX) { acc.x -= (p.pv.x - FP.wallX) * FP.wallK; }
  if (p.pv.y < FP.floorY) { acc.y += (FP.floorY - p.pv.y) * FP.wallK; }
  if (p.pv.y > FP.topY) { acc.y -= (p.pv.y - FP.topY) * FP.wallK; }

  var vel = (p.pv.zw + acc * FP.dt) * 0.9994;
  vel += dv * FP.xsph;
  let speed = length(vel);
  if (speed > 2.5) { vel *= 2.5 / speed; }
  parts[i] = Particle2(vec4f(p.pv.xy + vel * FP.dt, vel), p.aux);
}
