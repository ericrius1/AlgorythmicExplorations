// 3D smoothed-particle hydrodynamics on a grid-sorted buffer, confined to the
// same hemispheric dome as part two's gravity demo: radial shell spring plus
// a floor at z = 0. Kernel support equals one grid cell (3×3×3 stencil).

struct Particle3 {
  pos: vec4f,
  vel: vec4f,
  _mom: vec4f,
  _acc: vec4f,
}

struct Sph3Params {
  count: u32,
  grid: u32,
  cell: f32,
  dt: f32,
  gravity: f32,
  stiffness: f32,
  restDensity: f32,
  nearStiffness: f32,
  xsph: f32,
  shellK: f32,
  shellR: f32,
  mouseRadius: f32,
  mouseStrength: f32,
  mouse: vec3f,
  mouseVel: vec3f,
}

@group(0) @binding(0) var<uniform> SP: Sph3Params;
@group(0) @binding(1) var<storage, read_write> parts: array<Particle3>;
@group(0) @binding(2) var<storage, read> cellStart: array<u32>;
@group(0) @binding(3) var<storage, read> cellCount: array<u32>;
@group(0) @binding(4) var<storage, read_write> density: array<vec2f>;
@group(0) @binding(5) var<storage, read_write> posOut: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> velOut: array<vec4f>;

fn cellCoord(p: vec3f) -> vec3i {
  let g = f32(SP.grid);
  return vec3i(
    i32(clamp((p.x + 1.0) * 0.5 * g, 0.0, g - 1.0)),
    i32(clamp((p.y + 1.0) * 0.5 * g, 0.0, g - 1.0)),
    i32(clamp((p.z + 1.0) * 0.5 * g, 0.0, g - 1.0)),
  );
}

fn cellIndex(c: vec3i) -> u32 {
  return (u32(c.z) * SP.grid + u32(c.y)) * SP.grid + u32(c.x);
}

@compute @workgroup_size(256)
fn packIn(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= SP.count) { return; }
  parts[i].pos = posOut[i];
  parts[i].vel = velOut[i];
}

@compute @workgroup_size(256)
fn densityPass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= SP.count) { return; }
  let pi = parts[i].pos.xyz;
  let h = SP.cell;
  let h2 = h * h;
  let cc = cellCoord(pi);
  var rho = 0.0;
  var rhoNear = 0.0;
  for (var oz = -1; oz <= 1; oz++) {
    for (var oy = -1; oy <= 1; oy++) {
      for (var ox = -1; ox <= 1; ox++) {
        let c = cc + vec3i(ox, oy, oz);
        if (c.x < 0 || c.y < 0 || c.z < 0) { continue; }
        if (c.x >= i32(SP.grid) || c.y >= i32(SP.grid) || c.z >= i32(SP.grid)) { continue; }
        let ci = cellIndex(c);
        let s = cellStart[ci];
        let n = cellCount[ci];
        for (var k = s; k < s + n; k++) {
          let d = parts[k].pos.xyz - pi;
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
  }
  density[i] = vec2f(rho, rhoNear);
}

@compute @workgroup_size(256)
fn forcePass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= SP.count) { return; }
  var p = parts[i];
  let h = SP.cell;
  let h2 = h * h;
  let di = density[i];
  let pressI = SP.stiffness * (di.x - SP.restDensity);
  let nearI = SP.nearStiffness * di.y;
  let cc = cellCoord(p.pos.xyz);

  var acc = vec3f(0.0, 0.0, -SP.gravity);
  var dv = vec3f(0.0);
  for (var oz = -1; oz <= 1; oz++) {
    for (var oy = -1; oy <= 1; oy++) {
      for (var ox = -1; ox <= 1; ox++) {
        let c = cc + vec3i(ox, oy, oz);
        if (c.x < 0 || c.y < 0 || c.z < 0) { continue; }
        if (c.x >= i32(SP.grid) || c.y >= i32(SP.grid) || c.z >= i32(SP.grid)) { continue; }
        let ci = cellIndex(c);
        let s = cellStart[ci];
        let n = cellCount[ci];
        for (var k = s; k < s + n; k++) {
          if (k == i) { continue; }
          let d = parts[k].pos.xyz - p.pos.xyz;
          let r2 = dot(d, d);
          if (r2 < h2 && r2 > 1e-14) {
            let r = sqrt(r2);
            let q = r / h;
            let dj = density[k];
            let press = 0.5 * (pressI + SP.stiffness * (dj.x - SP.restDensity));
            let near = 0.5 * (nearI + SP.nearStiffness * dj.y);
            let w = 1.0 - q;
            acc -= (d / r) * (press * w + near * w * w);
            dv += (parts[k].vel.xyz - p.vel.xyz) * w;
          }
        }
      }
    }
  }

  let md = p.pos.xyz - SP.mouse;
  let mr = length(md);
  if (mr < SP.mouseRadius) {
    acc += SP.mouseVel * SP.mouseStrength * (1.0 - mr / SP.mouseRadius);
  }

  // Same dome as pyramid3d.wgsl: radial shell + upper hemisphere floor.
  if (SP.shellK > 0.0) {
    let r = length(p.pos.xyz);
    let rhat = p.pos.xyz / max(r, 1e-6);
    acc = acc - rhat * (r - SP.shellR) * SP.shellK;
    if (p.pos.z < 0.0) {
      acc.z = acc.z - p.pos.z * SP.shellK * 4.0;
    }
  }

  var vel = (p.vel.xyz + acc * SP.dt) * 0.9995;
  vel += dv * SP.xsph;
  let speed = length(vel);
  if (speed > 2.5) { vel *= 2.5 / speed; }
  posOut[i] = vec4f(p.pos.xyz + vel * SP.dt, 0.0);
  velOut[i] = vec4f(vel, 0.0);
}
