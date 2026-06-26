// Tiny orbit camera + just enough mat4 to avoid a dependency.

export type Mat4 = Float32Array;

export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = far / (near - far);
  out[11] = -1;
  out[14] = (near * far) / (near - far);
  return out;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

export class OrbitCamera {
  azimuth = 0.6;
  elevation = 0.45;
  distance = 2.6;
  autoSpin = 0.0012;
  zoomEnabled = true;

  private lastInteraction = 0;

  attach(canvas: HTMLCanvasElement): void {
    let orbiting = false;
    let dollying = false;
    let lx = 0;
    let ly = 0;

    const dollyBy = (delta: number): void => {
      if (!this.zoomEnabled) return;
      this.distance = Math.min(8, Math.max(1.0, this.distance * Math.exp(delta)));
      this.lastInteraction = performance.now();
    };

    canvas.addEventListener("pointerdown", (e) => {
      if (e.button === 0) {
        orbiting = true;
        lx = e.clientX;
        ly = e.clientY;
        canvas.setPointerCapture(e.pointerId);
      } else if (e.button === 1 && this.zoomEnabled) {
        dollying = true;
        ly = e.clientY;
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
      }
    });
    canvas.addEventListener("pointerup", (e) => {
      if (e.button === 0) orbiting = false;
      if (e.button === 1) dollying = false;
    });
    canvas.addEventListener("pointercancel", () => {
      orbiting = false;
      dollying = false;
    });
    canvas.addEventListener("pointermove", (e) => {
      if (orbiting) {
        this.azimuth -= (e.clientX - lx) * 0.005;
        this.elevation = Math.min(1.5, Math.max(-0.2, this.elevation + (e.clientY - ly) * 0.005));
        lx = e.clientX;
        ly = e.clientY;
        this.lastInteraction = performance.now();
      } else if (dollying) {
        dollyBy((e.clientY - ly) * 0.005);
        ly = e.clientY;
      }
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (!this.zoomEnabled) return; // let the page scroll
        // Two-finger trackpad scroll, mouse wheel, and pinch (ctrl+wheel) all dolly.
        e.preventDefault();
        dollyBy(e.deltaY * 0.001);
      },
      { passive: false },
    );
    canvas.addEventListener("auxclick", (e) => {
      if (e.button === 1) e.preventDefault();
    });
  }

  // Returns viewProj plus the camera's right/up axes for billboarding.
  matrices(aspect: number): { viewProj: Mat4; right: [number, number, number]; up: [number, number, number] } {
    if (performance.now() - this.lastInteraction > 2500) this.azimuth += this.autoSpin;
    const ce = Math.cos(this.elevation);
    const eye = [
      Math.cos(this.azimuth) * ce * this.distance,
      Math.sin(this.azimuth) * ce * this.distance,
      Math.sin(this.elevation) * this.distance,
    ];
    // look-at with +z up
    const f = normalize([-eye[0], -eye[1], -eye[2]]);
    const r = normalize(cross(f, [0, 0, 1]));
    const u = cross(r, f);
    const view = new Float32Array(16);
    view[0] = r[0]; view[4] = r[1]; view[8] = r[2];
    view[1] = u[0]; view[5] = u[1]; view[9] = u[2];
    view[2] = -f[0]; view[6] = -f[1]; view[10] = -f[2];
    view[12] = -(r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2]);
    view[13] = -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]);
    view[14] = f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2];
    view[15] = 1;
    const proj = perspective(0.9, aspect, 0.05, 50);
    return { viewProj: multiply(proj, view), right: r, up: u };
  }
}

function cross(a: number[], b: number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: number[]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
