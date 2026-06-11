// Webcam hand tracking via @svenflow/micro-handpose (WebGPU, 21 landmarks).
// The model and camera only spin up when a demo asks — nothing touches the
// camera on page load. Landmarks come out mirrored (webcams feel like
// mirrors), lightly smoothed, with two derived gestures: pinch and spread.

export const BONES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],        // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],        // index
  [5, 9], [9, 10], [10, 11], [11, 12],   // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20],// pinky
  [0, 17],                               // palm edge
];

export interface TrackedHand {
  handedness: "left" | "right";
  /** 21 × (x, y, z); x and y normalized [0,1], x mirrored; z relative depth */
  lm: Float32Array;
  /** palm centre (wrist + finger bases averaged), same coords as lm */
  palm: [number, number, number];
  /** 0 = open, 1 = thumb and index touching */
  pinch: number;
  /** 0 = fist, 1 = fingers splayed */
  spread: number;
}

type Handpose = {
  detect: (v: HTMLVideoElement) => Promise<
    Array<{ score: number; handedness: "left" | "right"; landmarks: Array<{ x: number; y: number; z: number }> }>
  >;
  dispose: () => void;
};

export class HandTracker {
  hands: TrackedHand[] = [];
  running = false;
  starting = false;
  readonly video: HTMLVideoElement = document.createElement("video");

  private stream: MediaStream | null = null;
  private hp: Handpose | null = null;
  private busy = false;
  private raf = 0;
  private smooth = new Map<string, Float32Array>();

  async start(): Promise<void> {
    if (this.running || this.starting) return;
    this.starting = true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      this.video.srcObject = this.stream;
      this.video.muted = true;
      this.video.playsInline = true;
      await this.video.play();
      const { createHandpose } = await import("@svenflow/micro-handpose");
      this.hp = (await createHandpose({ maxHands: 2 })) as unknown as Handpose;
      this.running = true;
      this.loop();
    } finally {
      this.starting = false;
    }
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.hp?.dispose();
    this.hp = null;
    this.hands = [];
    this.smooth.clear();
  }

  private loop = (): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.busy || !this.hp || this.video.readyState < 2) return;
    this.busy = true;
    this.hp
      .detect(this.video)
      .then((results) => {
        this.hands = results.map((r) => this.track(r));
      })
      .catch(() => {})
      .finally(() => (this.busy = false));
  };

  private track(r: {
    handedness: "left" | "right";
    landmarks: Array<{ x: number; y: number; z: number }>;
  }): TrackedHand {
    const raw = new Float32Array(63);
    for (let i = 0; i < 21; i++) {
      raw[i * 3] = 1 - r.landmarks[i].x; // mirror: your right hand on your right
      raw[i * 3 + 1] = r.landmarks[i].y;
      raw[i * 3 + 2] = r.landmarks[i].z;
    }
    let lm = this.smooth.get(r.handedness);
    if (!lm) {
      lm = raw.slice();
      this.smooth.set(r.handedness, lm);
    } else {
      const a = 0.45;
      for (let i = 0; i < 63; i++) lm[i] += (raw[i] - lm[i]) * a;
    }

    const at = (i: number): [number, number, number] => [lm[i * 3], lm[i * 3 + 1], lm[i * 3 + 2]];
    const dist = (a: number, b: number): number =>
      Math.hypot(lm[a * 3] - lm[b * 3], lm[a * 3 + 1] - lm[b * 3 + 1]);
    // hand scale: wrist → middle-finger base, stable under finger motion
    const scale = Math.max(dist(0, 9), 0.04);
    const pinch = Math.min(Math.max(1 - dist(4, 8) / (scale * 1.05), 0), 1);
    const w = at(0), i5 = at(5), m9 = at(9), r13 = at(13), p17 = at(17);
    const palm: [number, number, number] = [
      (w[0] + i5[0] + m9[0] + r13[0] + p17[0]) / 5,
      (w[1] + i5[1] + m9[1] + r13[1] + p17[1]) / 5,
      (w[2] + i5[2] + m9[2] + r13[2] + p17[2]) / 5,
    ];
    let tips = 0;
    for (const t of [8, 12, 16, 20]) {
      tips += Math.hypot(lm[t * 3] - palm[0], lm[t * 3 + 1] - palm[1]);
    }
    const spread = Math.min(Math.max((tips / 4 / scale - 0.6) / 1.1, 0), 1);
    return { handedness: r.handedness, lm, palm, pinch, spread };
  }
}
