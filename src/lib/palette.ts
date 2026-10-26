// Colours for the canvas-2D demos, matched to the GPU particle shaders so a
// body looks the same whichever renderer drew it: slow is deep blue,
// middling is pale violet, fast is amber.

const STOPS: [number, [number, number, number]][] = [
  [0.0, [52, 86, 235]],
  [0.5, [178, 174, 255]],
  [1.0, [255, 168, 92]],
];

export function speedRgb(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    const [t0, c0] = STOPS[i - 1];
    if (x <= t1) {
      const f = (x - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

// The ramp pre-cut into buckets, so a renderer can batch fills by colour.
export const SPEED_BUCKETS = 16;
export function speedBuckets(alpha: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < SPEED_BUCKETS; i++) {
    const [r, g, b] = speedRgb(i / (SPEED_BUCKETS - 1));
    out.push(`rgba(${r | 0}, ${g | 0}, ${b | 0}, ${alpha})`);
  }
  return out;
}

// Dark-to-bright ramp (roughly "inferno") for densities and heat maps.
export function heatRgb(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  const stops: [number, number, number][] = [
    [22, 14, 52],
    [96, 28, 110],
    [196, 58, 82],
    [246, 128, 44],
    [252, 226, 120],
  ];
  const f = x * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const k = f - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

// Device pixels per CSS pixel for a canvas, so strokes and dots keep the
// same on-screen size on Retina and standard displays.
export function pixelRatio(canvas: HTMLCanvasElement): number {
  return canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : window.devicePixelRatio || 1;
}
