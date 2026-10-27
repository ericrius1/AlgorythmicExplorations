// Room acoustics for a shoebox room: materials with absorption measured in six
// octave bands, Sabine's and Eyring's reverberation times, the image-source
// method, and the room's resonant modes.

export const C_SOUND = 343; // m/s, air at about 20 °C
export const BANDS = [125, 250, 500, 1000, 2000, 4000]; // octave-band centres, Hz
export const BAND_NAMES = ["125", "250", "500", "1k", "2k", "4k"];

export interface Material {
  id: string;
  name: string;
  alpha: number[]; // absorption coefficient per octave band
  color: string; // for drawing
}

// Absorption coefficients (125 Hz … 4 kHz) from the sengpielaudio.com table
// of common materials; drywall is ½-inch gypsum board on studs, from the same
// kind of table (it flexes, so it soaks up bass).
export const MATERIALS: Material[] = [
  { id: "tile", name: "glazed tile", alpha: [0.01, 0.01, 0.01, 0.01, 0.02, 0.02], color: "#cfe3f0" },
  { id: "concrete", name: "concrete", alpha: [0.01, 0.01, 0.015, 0.02, 0.02, 0.02], color: "#9aa3ad" },
  { id: "brick", name: "brick", alpha: [0.03, 0.03, 0.03, 0.04, 0.05, 0.07], color: "#c47c5a" },
  { id: "plaster", name: "plaster on brick", alpha: [0.013, 0.015, 0.02, 0.03, 0.04, 0.05], color: "#e8e1d4" },
  { id: "drywall", name: "drywall", alpha: [0.29, 0.1, 0.05, 0.04, 0.07, 0.09], color: "#d6d0e8" },
  { id: "glass", name: "window glass", alpha: [0.35, 0.25, 0.18, 0.12, 0.07, 0.04], color: "#8fd6e8" },
  { id: "wood", name: "wood panels", alpha: [0.28, 0.22, 0.17, 0.09, 0.1, 0.11], color: "#c99a62" },
  { id: "woodfloor", name: "wood floor", alpha: [0.15, 0.11, 0.1, 0.07, 0.06, 0.07], color: "#b7894f" },
  { id: "carpet", name: "carpet", alpha: [0.02, 0.06, 0.14, 0.37, 0.6, 0.65], color: "#a26fb3" },
  { id: "curtain", name: "heavy curtains", alpha: [0.14, 0.35, 0.55, 0.72, 0.7, 0.65], color: "#b0485e" },
  { id: "acoustic", name: "acoustic tiles", alpha: [0.7, 0.66, 0.72, 0.92, 0.88, 0.75], color: "#7fb58a" },
  { id: "audience", name: "seated audience", alpha: [0.6, 0.74, 0.88, 0.96, 0.93, 0.85], color: "#d9b25a" },
  { id: "water", name: "water", alpha: [0.008, 0.008, 0.013, 0.015, 0.02, 0.025], color: "#4fa8d8" },
];

const CUSTOM = new Map<string, Material>();

export const material = (id: string): Material => CUSTOM.get(id) ?? MATERIALS.find((m) => m.id === id) ?? MATERIALS[3];

// A made-up surface that absorbs the same fraction at every frequency.
export function flatMaterial(alpha: number): string {
  const a = Math.max(0.001, Math.min(0.99, alpha));
  const id = `flat@${a.toFixed(3)}`;
  if (!CUSTOM.has(id)) {
    const c = Math.round(120 + 120 * (1 - a));
    CUSTOM.set(id, { id, name: `α = ${a.toFixed(2)}`, alpha: BANDS.map(() => a), color: `rgb(${c},${c + 8},${c + 20})` });
  }
  return id;
}

// A surface that is part one material and part another (a floor with some of
// it covered in cushions, say): area-weighted absorption. Returns its id.
export function blendMaterial(a: string, b: string, frac: number): string {
  const f = Math.max(0, Math.min(1, frac));
  const id = `${a}+${b}@${f.toFixed(3)}`;
  if (!CUSTOM.has(id)) {
    const ma = material(a);
    const mb = material(b);
    CUSTOM.set(id, {
      id,
      name: `${ma.name} / ${mb.name}`,
      alpha: ma.alpha.map((v, i) => v * (1 - f) + mb.alpha[i] * f),
      color: mb.color,
    });
  }
  return id;
}

// Energy absorbed by the air per metre, per band (about 20 °C, 50–70% humidity).
export const AIR_M = [0.0001, 0.0002, 0.0004, 0.0009, 0.0022, 0.0075];

// Surfaces in order: x = 0 wall, x = L wall, y = 0 wall, y = W wall, floor, ceiling.
export type Surfaces = [string, string, string, string, string, string];

export interface Room {
  L: number; // x, metres
  W: number; // y
  H: number; // z
  surf: Surfaces;
}

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export function areas(r: Room): number[] {
  return [r.W * r.H, r.W * r.H, r.L * r.H, r.L * r.H, r.L * r.W, r.L * r.W];
}

export function volume(r: Room): number {
  return r.L * r.W * r.H;
}

export function surfaceArea(r: Room): number {
  return areas(r).reduce((a, b) => a + b, 0);
}

// Total absorption A = Σ S·α per band, in m² ("sabins").
export function absorption(r: Room, air = true): number[] {
  const S = areas(r);
  const V = volume(r);
  return BANDS.map((_, b) => {
    let A = 0;
    for (let i = 0; i < 6; i++) A += S[i] * material(r.surf[i]).alpha[b];
    return A + (air ? 4 * AIR_M[b] * V : 0);
  });
}

export function meanAlpha(r: Room): number[] {
  const S = areas(r);
  const St = surfaceArea(r);
  return BANDS.map((_, b) => {
    let A = 0;
    for (let i = 0; i < 6; i++) A += S[i] * material(r.surf[i]).alpha[b];
    return A / St;
  });
}

// Sabine (1900): T = 0.161 V / A
export function sabine(r: Room, air = true): number[] {
  const V = volume(r);
  return absorption(r, air).map((A) => (0.161 * V) / A);
}

// Eyring (1930): T = 0.161 V / (−S ln(1 − ᾱ) + 4mV). Better when the room is dead.
export function eyring(r: Room, air = true): number[] {
  const V = volume(r);
  const S = surfaceArea(r);
  return meanAlpha(r).map((a, b) => (0.161 * V) / (-S * Math.log(1 - Math.min(a, 0.99)) + (air ? 4 * AIR_M[b] * V : 0)));
}

export function meanFreePath(r: Room): number {
  return (4 * volume(r)) / surfaceArea(r);
}

// Schroeder frequency: below it, separate modes; above it, a dense blur of them.
export function schroederFreq(T: number, V: number): number {
  return 2000 * Math.sqrt(T / V);
}

// ---- image sources ------------------------------------------------------------

export interface Image {
  pos: V3;
  dist: number; // to the listener
  order: number;
  hits: number[]; // reflections off each of the six surfaces
  gain: number[]; // pressure gain per band, including 1/r spreading (r in metres)
}

// All image sources whose path to the listener is shorter than maxDist (and of
// order ≤ maxOrder), after Allen & Berkley (1979). Surfaces listed in
// `skip` are treated as fully absorbing (no reflections off them).
export function imageSources(
  r: Room,
  src: V3,
  lis: V3,
  maxDist: number,
  maxOrder = 99,
  skip: number[] = [],
  limit = 4000,
): Image[] {
  const beta = r.surf.map((id) => material(id).alpha.map((a) => Math.sqrt(1 - a))); // pressure reflection
  const out: Image[] = [];
  const nx = Math.ceil(maxDist / (2 * r.L)) + 1;
  const ny = Math.ceil(maxDist / (2 * r.W)) + 1;
  const flat = skip.includes(4) && skip.includes(5);
  const nz = flat ? 0 : Math.ceil(maxDist / (2 * r.H)) + 1;
  for (let l = -nx; l <= nx; l++) {
    for (let u = 0; u < 2; u++) {
      const x = (1 - 2 * u) * src.x + 2 * l * r.L;
      const hx0 = Math.abs(l - u);
      const hx1 = Math.abs(l);
      for (let m = -ny; m <= ny; m++) {
        for (let v = 0; v < 2; v++) {
          const y = (1 - 2 * v) * src.y + 2 * m * r.W;
          const hy0 = Math.abs(m - v);
          const hy1 = Math.abs(m);
          for (let n = -nz; n <= nz; n++) {
            for (let w = 0; w < (flat ? 1 : 2); w++) {
              const z = flat ? src.z : (1 - 2 * w) * src.z + 2 * n * r.H;
              const hz0 = flat ? 0 : Math.abs(n - w);
              const hz1 = flat ? 0 : Math.abs(n);
              const hits = [hx0, hx1, hy0, hy1, hz0, hz1];
              let order = 0;
              let dead = false;
              for (let i = 0; i < 6; i++) {
                order += hits[i];
                if (hits[i] > 0 && skip.includes(i)) dead = true;
              }
              if (dead || order > maxOrder) continue;
              const dx = x - lis.x;
              const dy = y - lis.y;
              const dz = z - lis.z;
              const dist = Math.max(0.05, Math.hypot(dx, dy, dz));
              if (dist > maxDist) continue;
              const gain = BANDS.map((_, b) => {
                let g = 1 / dist;
                for (let i = 0; i < 6; i++) if (hits[i]) g *= Math.pow(beta[i][b], hits[i]);
                return g * Math.exp(-0.5 * AIR_M[b] * dist);
              });
              out.push({ pos: { x, y, z }, dist, order, hits, gain });
            }
          }
        }
      }
    }
  }
  out.sort((a, b) => a.dist - b.dist);
  if (out.length > limit) out.length = limit;
  return out;
}

// ---- modes ------------------------------------------------------------------------

export interface Mode {
  n: [number, number, number];
  f: number;
  kind: "axial" | "tangential" | "oblique";
}

export function modes(r: Room, fmax: number): Mode[] {
  const out: Mode[] = [];
  for (let a = 0; a < 40; a++)
    for (let b = 0; b < 40; b++)
      for (let c = 0; c < 40; c++) {
        if (!a && !b && !c) continue;
        const f = (C_SOUND / 2) * Math.hypot(a / r.L, b / r.W, c / r.H);
        if (f > fmax) continue;
        const nz = (a ? 1 : 0) + (b ? 1 : 0) + (c ? 1 : 0);
        out.push({ n: [a, b, c], f, kind: nz === 1 ? "axial" : nz === 2 ? "tangential" : "oblique" });
      }
  out.sort((p, q) => p.f - q.f);
  return out;
}

// The shape of a mode at a point: cos(aπx/L)·cos(bπy/W)·cos(cπz/H)
export function modeShape(r: Room, m: Mode, p: V3): number {
  return (
    Math.cos((m.n[0] * Math.PI * p.x) / r.L) *
    Math.cos((m.n[1] * Math.PI * p.y) / r.W) *
    Math.cos((m.n[2] * Math.PI * p.z) / r.H)
  );
}
