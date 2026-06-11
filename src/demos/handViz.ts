// Part six, hand-tracking figure: the webcam feed with all 21 landmarks,
// the skeleton, and the two derived gestures (pinch, spread) drawn live.
// Camera and model load only after the visitor clicks — never on scroll.

import { Shell, type Demo } from "../lib/demoShell";
import { HandTracker, BONES } from "../lib/hands";

export function mountHandViz(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;

  const tracker = new HandTracker();
  let state: "idle" | "starting" | "on" | "blocked" = "idle";
  let button: HTMLButtonElement;

  shell.button("📷 start hand tracking", () => {
    if (state === "on") {
      tracker.stop();
      state = "idle";
      button.textContent = "📷 start hand tracking";
      return;
    }
    state = "starting";
    button.textContent = "loading model…";
    tracker
      .start()
      .then(() => {
        state = "on";
        button.textContent = "stop";
      })
      .catch((err) => {
        console.error("hand tracking failed", err);
        state = "blocked";
        button.textContent = "camera unavailable";
      });
  });
  button = shell.controls.lastElementChild as HTMLButtonElement;

  shell.setInfo(() => {
    if (state !== "on") return "21 landmarks · 7.7 MB of weights, fetched on demand";
    const h = tracker.hands;
    if (h.length === 0) return "looking for hands…";
    return h
      .map((x) => `${x.handedness}: pinch ${(x.pinch * 100).toFixed(0)}% · spread ${(x.spread * 100).toFixed(0)}%`)
      .join(" · ");
  });

  const TIPS = [4, 8, 12, 16, 20];

  return {
    frame() {
      shell.tick();
      ctx.fillStyle = "#06070d";
      ctx.fillRect(0, 0, W, H);

      if (state !== "on") {
        ctx.fillStyle = "#5b647f";
        ctx.font = `${Math.round(W / 38)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(
          state === "blocked"
            ? "Camera permission was denied — the cursor still works everywhere below."
            : state === "starting"
              ? "Fetching weights and compiling the WebGPU pipeline…"
              : "Click “start hand tracking”. The video never leaves your machine —",
          W / 2,
          H / 2 - 10,
        );
        if (state === "idle") {
          ctx.fillText("inference runs in this tab, on your GPU.", W / 2, H / 2 + W / 30);
        }
        return;
      }

      // mirrored video, letterboxed to 4:3
      const vw = H * (4 / 3);
      const vx = (W - vw) / 2;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.translate(vx + vw, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(tracker.video, 0, 0, vw, H);
      ctx.restore();

      for (const hand of tracker.hands) {
        const px = (i: number): [number, number] => [vx + hand.lm[i * 3] * vw, hand.lm[i * 3 + 1] * H];
        const hue = hand.handedness === "left" ? 195 : 330;

        ctx.strokeStyle = `hsla(${hue}, 90%, 65%, 0.85)`;
        ctx.lineWidth = Math.max(2, W / 500);
        ctx.beginPath();
        for (const [a, b] of BONES) {
          const [ax, ay] = px(a);
          const [bx, by] = px(b);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
        }
        ctx.stroke();

        for (let i = 0; i < 21; i++) {
          const [x, y] = px(i);
          const tip = TIPS.includes(i);
          ctx.fillStyle = tip ? `hsl(${hue}, 100%, 80%)` : `hsla(${hue}, 80%, 60%, 0.9)`;
          ctx.beginPath();
          ctx.arc(x, y, tip ? W / 180 : W / 280, 0, Math.PI * 2);
          ctx.fill();
        }

        // pinch gauge between thumb and index tip
        const [tx, ty] = px(4);
        const [ix, iy] = px(8);
        ctx.strokeStyle = `hsla(${hue}, 100%, 75%, ${0.25 + hand.pinch * 0.75})`;
        ctx.lineWidth = Math.max(2, W / 400) * (1 + hand.pinch * 2);
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(ix, iy);
        ctx.stroke();
        if (hand.pinch > 0.6) {
          ctx.fillStyle = `hsla(${hue}, 100%, 85%, ${hand.pinch})`;
          ctx.beginPath();
          ctx.arc((tx + ix) / 2, (ty + iy) / 2, W / 90 * hand.pinch, 0, Math.PI * 2);
          ctx.fill();
        }

        const [wx, wy] = px(0);
        ctx.fillStyle = `hsla(${hue}, 70%, 75%, 0.9)`;
        ctx.font = `${Math.round(W / 50)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(hand.handedness, wx, wy + W / 28);
      }
    },
    dispose() {
      tracker.stop();
    },
  };
}
