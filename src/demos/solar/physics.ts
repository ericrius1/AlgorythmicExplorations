// Detailed-balance solar cell physics shared by the Solar Stack figures.
//
// The sun is a 5,778 K blackbody scaled to 1,000 W/m² (no atmosphere), and
// cells sit at 300 K. Every current here is in mA/cm², every voltage in volts,
// every power in mW/cm² (so 100 mW/cm² of sunlight in, efficiency = P / 100).

const Q = 1.602176634e-19;
const H = 6.62607015e-34;
const C = 2.99792458e8;
const KB = 1.380649e-23;

export const T_SUN = 5778;
export const T_CELL = 300;
export const KT = (KB * T_CELL) / Q; // thermal voltage, ~25.85 mV
export const SUN_POWER = 100; // mW/cm²
export const SI_GAP = 1.12;

export const E_MIN = 0.3;
export const E_MAX = 4.4;
const DE = 0.002;
export const N_E = Math.round((E_MAX - E_MIN) / DE) + 1;

/** photon energy at grid index i, eV */
export const energyAt = (i: number): number => E_MIN + i * DE;

// photon flux density per eV at each grid energy, photons / (m² s eV)
export const PHOTON_FLUX = new Float64Array(N_E);
// cumulative photon current above each grid energy, mA/cm²
const JPH_ABOVE = new Float64Array(N_E + 1);
// cumulative radiative dark current (300 K blackbody emission) above each energy, mA/cm²
const J0_ABOVE = new Float64Array(N_E + 1);

{
  const kTs = (KB * T_SUN) / Q;
  const shape = new Float64Array(N_E);
  let power = 0;
  for (let i = 0; i < N_E; i++) {
    const e = energyAt(i);
    shape[i] = (e * e) / Math.expm1(e / kTs);
    power += shape[i] * e * Q * DE; // W/m² per unit of shape
  }
  const scale = 1000 / power;
  const emit = (2 * Math.PI) / (H * H * H * C * C);
  for (let i = N_E - 1; i >= 0; i--) {
    const e = energyAt(i);
    PHOTON_FLUX[i] = shape[i] * scale;
    // A/m² → mA/cm² is × 0.1
    JPH_ABOVE[i] = JPH_ABOVE[i + 1] + PHOTON_FLUX[i] * DE * Q * 0.1;
    const eJ = e * Q;
    const bb = (emit * eJ * eJ) / Math.expm1(e / KT); // photons / (m² s J)
    J0_ABOVE[i] = J0_ABOVE[i + 1] + bb * DE * Q * Q * 0.1;
  }
}

const idx = (e: number): number => Math.max(0, Math.min(N_E, Math.round((e - E_MIN) / DE)));

/** photocurrent from every photon between lo and hi eV, mA/cm² */
export function jph(lo: number, hi = E_MAX): number {
  return Math.max(0, JPH_ABOVE[idx(lo)] - JPH_ABOVE[idx(hi)]);
}

/** radiative-limit dark saturation current for a step absorber with gap eg, mA/cm² */
export function j0rad(eg: number): number {
  return J0_ABOVE[idx(eg)];
}

/** sunlight power carried by photons between lo and hi eV, mW/cm² */
export function powerBetween(lo: number, hi = E_MAX): number {
  let p = 0;
  const a = idx(lo);
  const b = Math.min(N_E, idx(hi));
  for (let i = a; i < b; i++) p += PHOTON_FLUX[i] * energyAt(i) * DE;
  return p * Q * 0.1;
}

export interface Diode {
  jsc: number; // mA/cm²
  j0: number; // mA/cm²
  n?: number; // ideality
  rs?: number; // Ω·cm²
  rsh?: number; // Ω·cm² (Infinity = none)
}

/**
 * Voltage of one illuminated cell carrying current density j (mA/cm²).
 * Past its own photocurrent a cell is driven into reverse; then only the
 * shunt (or reverse breakdown, capped here) lets the extra current through.
 */
export function cellVoltage(d: Diode, j: number): number {
  const n = d.n ?? 1;
  const rs = (d.rs ?? 0) / 1000; // V per mA/cm²
  const rsh = (d.rsh ?? Infinity) / 1000;
  let vd = 0;
  if (j < d.jsc) {
    // V_d = n kT ln((Jsc - J - V_d/Rsh)/J0 + 1), solved by fixed point
    vd = n * KT * Math.log((d.jsc - j) / d.j0 + 1);
    if (Number.isFinite(rsh)) {
      for (let k = 0; k < 8; k++) {
        const net = Math.max(1e-12, d.jsc - j - vd / rsh);
        vd = n * KT * Math.log(net / d.j0 + 1);
      }
    }
  } else {
    // reverse: the shunt carries the excess, breakdown caps it at -12 V
    vd = Number.isFinite(rsh) ? Math.max(-12, -(j - d.jsc) * rsh) : -12;
  }
  return vd - j * rs;
}

export interface Mpp {
  voc: number;
  jsc: number;
  vmp: number;
  jmp: number;
  pmax: number; // mW/cm²
  ff: number;
}

/** maximum power point of a set of series-connected cells (one cell is fine) */
export function seriesMpp(cells: Diode[], samples = 400): Mpp {
  const jmax = Math.max(...cells.map((c) => c.jsc)) * 1.02;
  let best = { v: 0, j: 0, p: -1 };
  let jsc = 0;
  let voc = 0;
  let prevV = Infinity;
  let prevJ = 0;
  for (let s = 0; s <= samples; s++) {
    const j = (s / samples) * jmax;
    let v = 0;
    for (const c of cells) v += cellVoltage(c, j);
    if (s === 0) voc = v;
    if (prevV > 0 && v <= 0) jsc = prevJ + ((j - prevJ) * prevV) / (prevV - v || 1);
    if (v * j > best.p) best = { v, j, p: v * j };
    prevV = v;
    prevJ = j;
  }
  // refine the MPP with a golden-section search around the coarse best
  let lo = Math.max(0, best.j - jmax / samples);
  let hi = Math.min(jmax, best.j + jmax / samples);
  const pAt = (j: number): number => j * cells.reduce((a, c) => a + cellVoltage(c, j), 0);
  for (let k = 0; k < 24; k++) {
    const m1 = hi - (hi - lo) * 0.618;
    const m2 = lo + (hi - lo) * 0.618;
    if (pAt(m1) > pAt(m2)) hi = m2;
    else lo = m1;
  }
  const jmp = (lo + hi) / 2;
  const pmax = pAt(jmp);
  const vmp = pmax / (jmp || 1);
  if (!jsc) jsc = best.j;
  return { voc, jsc, vmp, jmp, pmax, ff: pmax / (voc * jsc || 1) };
}

/** Shockley–Queisser single junction with gap eg */
export function sqCell(eg: number): Mpp {
  return seriesMpp([{ jsc: jph(eg), j0: j0rad(eg) }], 300);
}

// Efficiency vs bandgap, precomputed once for the curve plots.
export const SQ_CURVE: { eg: number; eff: number }[] = [];
for (let eg = 0.5; eg <= 2.6001; eg += 0.01) SQ_CURVE.push({ eg, eff: sqCell(eg).pmax });

export interface TandemResult {
  jTop: number;
  jBot: number;
  twoT: Mpp;
  fourT: number; // mW/cm², each subcell at its own MPP
}

/** detailed-balance perovskite-on-silicon tandem with a step-edge top cell */
export function idealTandem(topGap: number): TandemResult {
  const jTop = jph(topGap);
  const jBot = jph(SI_GAP, topGap);
  const top: Diode = { jsc: jTop, j0: j0rad(topGap) };
  const bot: Diode = { jsc: jBot, j0: j0rad(SI_GAP) };
  const twoT = seriesMpp([top, bot], 300);
  const fourT = seriesMpp([top], 200).pmax + seriesMpp([bot], 200).pmax;
  return { jTop, jBot, twoT, fourT };
}

export const TANDEM_CURVE: { eg: number; twoT: number; fourT: number }[] = [];
for (let eg = 1.3; eg <= 2.3001; eg += 0.01) {
  const t = idealTandem(eg);
  TANDEM_CURVE.push({ eg, twoT: t.twoT.pmax, fourT: t.fourT });
}

/**
 * Rough bandgap of an FA/Cs lead iodide–bromide perovskite with bromide
 * fraction x (0 = all iodide, 1 = all bromide). A smooth fit through typical
 * reported values: about 1.55 eV at x = 0, 1.68 eV near x = 0.25, 2.28 eV at
 * x = 1. The exact numbers shift with the A-site cation mix.
 */
export function perovskiteGap(x: number): number {
  return 1.55 + 0.45 * x + 0.28 * x * x;
}

/** inverse of perovskiteGap, or null outside the iodide–bromide range */
export function bromideFor(eg: number): number | null {
  if (eg < perovskiteGap(0) - 1e-6 || eg > perovskiteGap(1) + 1e-6) return null;
  // 0.28x² + 0.45x + (1.55 - eg) = 0
  const a = 0.28;
  const b = 0.45;
  const c = 1.55 - eg;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

/** photon energy (eV) ↔ wavelength (nm) */
export const nmFromEv = (ev: number): number => 1239.84 / ev;
export const evFromNm = (nm: number): number => 1239.84 / nm;

/**
 * Absorption coefficient of crystalline silicon at 300 K, 1/cm, log-interpolated
 * from Green's tabulated values. Used for how deep each photon gets.
 */
const SI_ALPHA: [number, number][] = [
  [400, 9.5e4],
  [450, 2.55e4],
  [500, 1.11e4],
  [550, 6.4e3],
  [600, 4.14e3],
  [650, 2.81e3],
  [700, 1.9e3],
  [750, 1.3e3],
  [800, 850],
  [850, 535],
  [900, 306],
  [950, 157],
  [1000, 64],
  [1050, 16.3],
  [1100, 3.5],
  [1150, 0.32],
  [1200, 0.022],
];

export function siliconAlpha(nm: number): number {
  if (nm <= SI_ALPHA[0][0]) return SI_ALPHA[0][1];
  for (let i = 1; i < SI_ALPHA.length; i++) {
    const [x1, y1] = SI_ALPHA[i];
    const [x0, y0] = SI_ALPHA[i - 1];
    if (nm <= x1) {
      const t = (nm - x0) / (x1 - x0);
      return Math.exp(Math.log(y0) + (Math.log(y1) - Math.log(y0)) * t);
    }
  }
  return 0;
}

/**
 * Direct-gap absorption edge used for the perovskite: α = α0·√(E − Eg),
 * with α0 chosen so α ≈ 1e5 /cm half an eV above the gap.
 */
export function perovskiteAlpha(ev: number, eg: number): number {
  return ev <= eg ? 0 : 1.45e5 * Math.sqrt(ev - eg);
}

/** photocurrent a top cell of thickness d (nm) absorbs in one pass, and what it lets through above the silicon gap */
export function topCellSplit(eg: number, thicknessNm: number): { jTop: number; jPass: number } {
  const d = thicknessNm * 1e-7; // cm
  let jTop = 0;
  let jPass = 0;
  const a = idx(SI_GAP);
  for (let i = a; i < N_E; i++) {
    const e = energyAt(i);
    const j = PHOTON_FLUX[i] * DE * Q * 0.1;
    const absorbed = 1 - Math.exp(-perovskiteAlpha(e, eg) * d);
    jTop += j * absorbed;
    jPass += j * (1 - absorbed);
  }
  return { jTop, jPass };
}

/** fraction of all sunlight photons above an energy */
export function photonFractionAbove(e: number): number {
  return JPH_ABOVE[idx(e)] / JPH_ABOVE[0];
}

/** inverse CDF sampling of a sunlight photon's energy, for the hero */
export function samplePhotonEnergy(u: number): number {
  const target = (1 - u) * JPH_ABOVE[0];
  let lo = 0;
  let hi = N_E;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (JPH_ABOVE[mid] > target) lo = mid;
    else hi = mid;
  }
  return energyAt(lo);
}
