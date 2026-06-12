// The pose library. A pose is nothing but a table of joint angles (Euler,
// degrees, in each joint's parent frame) plus an optional whole-body lift.
// A move is a handful of poses with timestamps. That's the entire format —
// no curves, no clips, no files. Part 4's animator turns these tables into
// motion by *chasing* them with springs, which is also what makes any move
// blend seamlessly into any other from wherever the body happens to be.

export type Pose = {
  joints: Record<string, [number, number, number]>;
  lift?: number; // root translation upward (bounces, stretches)
};

// The neutral stance every move composes over: wu ji, "empty standing" —
// knees soft, spine tall, arms hanging just off the body.
export const WUJI: Pose = {
  joints: {
    hips: [0, 0, 0],
    spine: [3, 0, 0],
    chest: [-2, 0, 0],
    neck: [4, 0, 0],
    head: [-4, 0, 0],
    tail: [0, 0, 0],
    thighL: [-7, 0, -3], thighR: [-7, 0, 3],
    shinL: [13, 0, 0], shinR: [13, 0, 0],
    footL: [-6, 0, 0], footR: [-6, 0, 0],
    upperArmL: [-4, 0, -14], upperArmR: [-4, 0, 14],
    forearmL: [-10, 0, -2], forearmR: [-10, 0, 2],
    handL: [-6, 0, 0], handR: [-6, 0, 0],
  },
};

// Compose partial joint tables over the base stance.
export function over(base: Pose, joints: Record<string, [number, number, number]>, lift?: number): Pose {
  return { joints: { ...base.joints, ...joints }, lift: lift ?? base.lift };
}

export interface MoveKey {
  t: number; // normalized 0..1 along the move
  pose: Pose;
}

export interface Move {
  id: string;
  label: string;
  sub: string; // the traditional name, for the article and the buttons
  duration: number; // seconds at speed 1
  keys: MoveKey[];
  gaze?: (t: number) => [number, number, number] | null; // world point to watch
  breath?: number; // breath-layer amplitude multiplier during the move
}

// ---- the eight(ish) brocades, bear edition --------------------------------------

const liftSky = over(WUJI, {
  upperArmL: [-152, 0, -10], upperArmR: [-152, 0, 10],
  forearmL: [-12, 0, 0], forearmR: [-12, 0, 0],
  handL: [-14, 0, 4], handR: [-14, 0, -4],
  spine: [-3, 0, 0], chest: [-6, 0, 0],
  neck: [-2, 0, 0], head: [-12, 0, 0],
});

const armsForward = over(WUJI, {
  upperArmL: [-74, 0, -16], upperArmR: [-74, 0, 16],
  forearmL: [-18, 0, -4], forearmR: [-18, 0, 4],
  handL: [-10, 0, 0], handR: [-10, 0, 0],
});

const armsSide = over(WUJI, {
  upperArmL: [-32, 0, 40], upperArmR: [-32, 0, -40],
  forearmL: [-8, 0, 0], forearmR: [-8, 0, 0],
});

const bowStanceBase = {
  thighL: [-13, 0, -7] as [number, number, number], thighR: [-13, 0, 7] as [number, number, number],
  shinL: [24, 0, 0] as [number, number, number], shinR: [24, 0, 0] as [number, number, number],
  footL: [-11, 0, 0] as [number, number, number], footR: [-11, 0, 0] as [number, number, number],
};

const drawBowL = over(WUJI, {
  ...bowStanceBase,
  chest: [-2, 12, 0],
  neck: [2, 16, 0], head: [-4, 22, 0],
  upperArmL: [-12, 0, 54],
  forearmL: [-4, 0, 2],
  handL: [0, 0, 24],
  upperArmR: [-38, 0, -24],
  forearmR: [-104, 0, -12],
  handR: [-12, 0, -8],
});

const drawBowR = over(WUJI, {
  ...bowStanceBase,
  chest: [-2, -12, 0],
  neck: [2, -16, 0], head: [-4, -22, 0],
  upperArmR: [-12, 0, -54],
  forearmR: [-4, 0, -2],
  handR: [0, 0, -24],
  upperArmL: [-38, 0, 24],
  forearmL: [-104, 0, 12],
  handL: [-12, 0, 8],
});

const armsCrossed = over(WUJI, {
  ...bowStanceBase,
  upperArmL: [-58, 0, -40], upperArmR: [-58, 0, 40],
  forearmL: [-52, 0, -16], forearmR: [-52, 0, 16],
});

const heavenEarthL = over(WUJI, {
  upperArmL: [-166, 0, -14],
  forearmL: [-8, 0, -4],
  handL: [-90, 0, 0], // palm flattens toward the sky
  upperArmR: [-2, 0, 8],
  forearmR: [-2, 0, 4],
  handR: [86, 0, 0], // palm presses the earth
  spine: [-2, 0, 0], chest: [-4, 0, 0],
  head: [-9, 0, 0],
});

const heavenEarthR = over(WUJI, {
  upperArmR: [-166, 0, 14],
  forearmR: [-8, 0, 4],
  handR: [-90, 0, 0],
  upperArmL: [-2, 0, -8],
  forearmL: [-2, 0, -4],
  handL: [86, 0, 0],
  spine: [-2, 0, 0], chest: [-4, 0, 0],
  head: [-9, 0, 0],
});

const owlL = over(WUJI, {
  chest: [-2, 14, 0],
  neck: [2, 24, 0],
  head: [-2, 30, 0],
  upperArmL: [-2, 0, -8], upperArmR: [-2, 0, 8],
  forearmL: [-4, 0, 2], forearmR: [-4, 0, -2],
});

const owlR = over(WUJI, {
  chest: [-2, -14, 0],
  neck: [2, -24, 0],
  head: [-2, -30, 0],
  upperArmL: [-2, 0, -8], upperArmR: [-2, 0, 8],
  forearmL: [-4, 0, 2], forearmR: [-4, 0, -2],
});

const swayL = over(WUJI, {
  ...bowStanceBase,
  hips: [0, 0, 10],
  spine: [2, 0, -8],
  chest: [-2, 0, -7],
  head: [-4, 0, 9],
  tail: [0, 28, 0],
  upperArmL: [-10, 0, 2], upperArmR: [-10, 0, -2],
});

const swayR = over(WUJI, {
  ...bowStanceBase,
  hips: [0, 0, -10],
  spine: [2, 0, 8],
  chest: [-2, 0, 7],
  head: [-4, 0, -9],
  tail: [0, -28, 0],
  upperArmL: [-10, 0, 2], upperArmR: [-10, 0, -2],
});

const handsAtChest = over(WUJI, {
  upperArmL: [-36, 0, -14], upperArmR: [-36, 0, 14],
  forearmL: [-78, 0, -14], forearmR: [-78, 0, 14],
  handL: [-22, 0, 0], handR: [-22, 0, 0],
});

const pushOut = over(WUJI, {
  upperArmL: [-88, 0, -16], upperArmR: [-88, 0, 16],
  forearmL: [-6, 0, -6], forearmR: [-6, 0, 6],
  handL: [-42, 0, 0], handR: [-42, 0, 0],
  spine: [1, 0, 0], chest: [-4, 0, 0],
});

const embrace = over(WUJI, {
  upperArmL: [-56, 0, 10], upperArmR: [-56, 0, -10],
  forearmL: [-46, -26, -18], forearmR: [-46, 26, 18],
  handL: [-12, 0, -10], handR: [-12, 0, 10],
  thighL: [-10, 0, -4], thighR: [-10, 0, 4],
  shinL: [18, 0, 0], shinR: [18, 0, 0],
  footL: [-8, 0, 0], footR: [-8, 0, 0],
});

const glare = over(WUJI, {
  thighL: [-18, 0, -9], thighR: [-18, 0, 9],
  shinL: [32, 0, 0], shinR: [32, 0, 0],
  footL: [-14, 0, 0], footR: [-14, 0, 0],
  upperArmL: [-28, 0, 14], upperArmR: [-28, 0, -14],
  forearmL: [-64, 0, -12], forearmR: [-64, 0, 12],
  handL: [-30, 0, 0], handR: [-30, 0, 0],
  chest: [4, 0, 0], neck: [10, 0, 0], head: [6, 0, 0],
});

const bounceUp = over(WUJI, {}, 0.045);

const FWD: [number, number, number] = [0, 1.55, 2.5];

export const MOVES: Move[] = [
  {
    id: "sky",
    label: "Lifting the Sky",
    sub: "两手托天 · two hands hold up the heavens",
    duration: 7.5,
    breath: 1.4,
    keys: [
      { t: 0, pose: WUJI },
      { t: 0.2, pose: armsForward },
      { t: 0.42, pose: liftSky },
      { t: 0.62, pose: over(liftSky, {}, 0.03) }, // the stretch, up on the toes
      { t: 0.82, pose: armsSide },
      { t: 1, pose: WUJI },
    ],
    gaze: (t) => (t > 0.35 && t < 0.7 ? [0, 2.6, 0.9] : FWD),
  },
  {
    id: "bowL",
    label: "Drawing the Bow · left",
    sub: "左开弓 · the archer aims at the hawk",
    duration: 7,
    keys: [
      { t: 0, pose: WUJI },
      { t: 0.22, pose: armsCrossed },
      { t: 0.5, pose: drawBowL },
      { t: 0.72, pose: drawBowL }, // hold the draw
      { t: 1, pose: WUJI },
    ],
    gaze: (t) => (t > 0.35 && t < 0.8 ? [1.9, 1.5, 0.5] : FWD),
  },
  {
    id: "bowR",
    label: "Drawing the Bow · right",
    sub: "右开弓 · and turns the other way",
    duration: 7,
    keys: [
      { t: 0, pose: WUJI },
      { t: 0.22, pose: armsCrossed },
      { t: 0.5, pose: drawBowR },
      { t: 0.72, pose: drawBowR },
      { t: 1, pose: WUJI },
    ],
    gaze: (t) => (t > 0.35 && t < 0.8 ? [-1.9, 1.5, 0.5] : FWD),
  },
  {
    id: "heaven",
    label: "Separating Heaven & Earth",
    sub: "调理脾胃 · one palm sky, one palm soil",
    duration: 9,
    keys: [
      { t: 0, pose: WUJI },
      { t: 0.18, pose: heavenEarthL },
      { t: 0.36, pose: heavenEarthL },
      { t: 0.5, pose: WUJI },
      { t: 0.68, pose: heavenEarthR },
      { t: 0.86, pose: heavenEarthR },
      { t: 1, pose: WUJI },
    ],
  },
  {
    id: "owl",
    label: "Wise Owl Gazes Back",
    sub: "五劳七伤往后瞧 · the look behind",
    duration: 9,
    breath: 1.2,
    keys: [
      { t: 0, pose: WUJI },
      { t: 0.18, pose: owlL },
      { t: 0.36, pose: owlL },
      { t: 0.5, pose: WUJI },
      { t: 0.68, pose: owlR },
      { t: 0.86, pose: owlR },
      { t: 1, pose: WUJI },
    ],
    gaze: (t) => {
      if (t > 0.14 && t < 0.42) return [1.6, 1.7, -1.6];
      if (t > 0.64 && t < 0.92) return [-1.6, 1.7, -1.6];
      return FWD;
    },
  },
  {
    id: "sway",
    label: "Sway the Head, Wag the Tail",
    sub: "摇头摆尾 · the move this bear was born for",
    duration: 8,
    keys: [
      { t: 0, pose: WUJI },
      { t: 0.2, pose: swayL },
      { t: 0.45, pose: swayR },
      { t: 0.7, pose: swayL },
      { t: 0.88, pose: swayR },
      { t: 1, pose: WUJI },
    ],
  },
  {
    id: "push",
    label: "Pushing the Mountain",
    sub: "推山 · palms out, mountain moved",
    duration: 6.5,
    keys: [
      { t: 0, pose: WUJI },
      { t: 0.22, pose: handsAtChest },
      { t: 0.5, pose: pushOut },
      { t: 0.68, pose: pushOut },
      { t: 0.85, pose: handsAtChest },
      { t: 1, pose: WUJI },
    ],
  },
  {
    id: "tree",
    label: "Embracing the Tree",
    sub: "抱树桩 · holding a trunk of air",
    duration: 10,
    breath: 1.8,
    keys: [
      { t: 0, pose: WUJI },
      { t: 0.2, pose: embrace },
      { t: 0.85, pose: embrace }, // the long quiet hold
      { t: 1, pose: WUJI },
    ],
  },
  {
    id: "glare",
    label: "Fierce Bear Glares",
    sub: "攒拳怒目 · fists clenched, eyes blazing",
    duration: 7,
    keys: [
      { t: 0, pose: WUJI },
      { t: 0.25, pose: glare },
      { t: 0.45, pose: over(glare, { head: [6, -18, 0] }) },
      { t: 0.65, pose: over(glare, { head: [6, 18, 0] }) },
      { t: 0.8, pose: glare },
      { t: 1, pose: WUJI },
    ],
    gaze: () => null, // the glare aims itself
  },
  {
    id: "bounce",
    label: "Bouncing on the Toes",
    sub: "背后七颠 · seven small jolts to settle it all",
    duration: 6,
    keys: [
      { t: 0, pose: WUJI },
      { t: 0.15, pose: bounceUp },
      { t: 0.28, pose: WUJI },
      { t: 0.41, pose: bounceUp },
      { t: 0.54, pose: WUJI },
      { t: 0.67, pose: bounceUp },
      { t: 0.8, pose: WUJI },
      { t: 1, pose: WUJI },
    ],
  },
];

export const MOVE_BY_ID = new Map(MOVES.map((m) => [m.id, m]));

// Sample a move at normalized time t: find the bracketing keys and ease
// between them. Returns the pose table to chase (springs do the chasing).
export function sampleMove(move: Move, t: number): Pose {
  const keys = move.keys;
  if (t <= keys[0].t) return keys[0].pose;
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].pose;
  let k = 0;
  while (k < keys.length - 2 && keys[k + 1].t < t) k++;
  const a = keys[k], b = keys[k + 1];
  const span = Math.max(1e-6, b.t - a.t);
  let u = (t - a.t) / span;
  u = u * u * (3 - 2 * u); // smoothstep easing between keyposes
  const joints: Record<string, [number, number, number]> = {};
  for (const name of Object.keys(WUJI.joints)) {
    const ea = a.pose.joints[name] ?? WUJI.joints[name];
    const eb = b.pose.joints[name] ?? WUJI.joints[name];
    joints[name] = [ea[0] + (eb[0] - ea[0]) * u, ea[1] + (eb[1] - ea[1]) * u, ea[2] + (eb[2] - ea[2]) * u];
  }
  const lift = (a.pose.lift ?? 0) + ((b.pose.lift ?? 0) - (a.pose.lift ?? 0)) * u;
  return { joints, lift };
}
