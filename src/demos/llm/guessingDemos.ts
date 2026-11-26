// Part 1 Figures ("The Guessing Game"):
//  1. mountGuessingHero   — Live streaming next-character probability fountain
//  2. mountMarkovDemo     — Interactive N-gram / Markov table builder & explosion counter
//  3. mountSoftmaxTempDemo — Logits, Softmax, Temperature, Top-p & Surprise (Cross-Entropy) lab

import { Shell, type Demo } from "../../lib/demoShell";
import { pixelRatio } from "../../lib/palette";
import { CORPORA } from "../../lib/llm/datasets";

// ---- 1. Hero: Next-Token Probability Fountain ------------------------------

export function mountGuessingHero(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.46);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  const phrase = "soft wind wakes the grass and warm light spills across the hill. ";
  // Build a quick character-level bigram+trigram table from CORPORA[1] (Haiku) + phrase
  const corpus = (CORPORA[1].text + "\n" + phrase).toLowerCase();
  const counts = new Map<string, Map<string, number>>();
  for (let i = 0; i < corpus.length - 1; i++) {
    const ch = corpus[i];
    const nxt = corpus[i + 1];
    if (nxt === "\n") continue;
    let m = counts.get(ch);
    if (!m) {
      m = new Map();
      counts.set(ch, m);
    }
    m.set(nxt, (m.get(nxt) ?? 0) + 1);
  }

  const getTopCandidates = (prefixChar: string, trueNext: string): { ch: string; p: number; isTrue: boolean }[] => {
    const m = counts.get(prefixChar.toLowerCase()) ?? new Map<string, number>();
    const merged = new Map<string, number>(m);
    merged.set(trueNext, (merged.get(trueNext) ?? 0) + 2.2);
    let total = 0;
    for (const v of merged.values()) total += v;
    const arr = [...merged.entries()]
      .map(([ch, c]) => ({ ch, p: c / Math.max(1, total), isTrue: ch === trueNext }))
      .sort((a, b) => b.p - a.p)
      .slice(0, 7);
    if (!arr.some((x) => x.isTrue)) {
      arr[arr.length - 1] = { ch: trueNext, p: 0.06, isTrue: true };
    }
    return arr;
  };

  let cursor = 5;
  let lastAdvance = performance.now();
  let lastInfo = "Predicting the next character as a probability distribution";
  shell.setInfo(() => lastInfo);

  return {
    frame() {
      shell.tick();
      const now = performance.now();
      const stepDur = 680;
      const elapsed = now - lastAdvance;
      if (elapsed >= stepDur) {
        lastAdvance = now;
        cursor = (cursor + 1) % (phrase.length - 2);
        if (cursor < 4) cursor = 4;
      }
      const frac = Math.min(1, elapsed / stepDur);

      ctx.fillStyle = "#080a12";
      ctx.fillRect(0, 0, W, H);

      // Subtle radial glow
      const g = ctx.createRadialGradient(W * 0.56, H * 0.44, 10, W * 0.56, H * 0.44, W * 0.52);
      g.addColorStop(0, "rgba(122, 162, 255, 0.14)");
      g.addColorStop(0.55, "rgba(94, 240, 181, 0.05)");
      g.addColorStop(1, "rgba(8, 10, 18, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      const shown = phrase.slice(Math.max(0, cursor - 22), cursor);
      const lastCh = phrase[cursor - 1] ?? " ";
      const trueNext = phrase[cursor] ?? " ";
      const cands = getTopCandidates(lastCh, trueNext);
      const chosen = cands.find((c) => c.isTrue) ?? cands[0];
      const bits = -Math.log2(Math.max(0.001, chosen.p));
      const dispNext = trueNext === " " ? "␣" : trueNext;
      lastInfo = `prefix “…${shown.slice(-10)}” → next '${dispNext}' (${(chosen.p * 100).toFixed(0)}% · ${bits.toFixed(2)} bits of surprise)`;

      // Left / center stream of typed tokens
      const baseY = H * 0.46;
      const splitX = W * 0.52;
      ctx.font = `600 ${20 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(218, 226, 248, 0.88)";
      ctx.fillText(shown, splitX - 16 * dpr, baseY);

      // Active prediction slot
      const boxW = 30 * dpr;
      const boxH = 38 * dpr;
      const boxX = splitX - 8 * dpr;
      const boxY = baseY - 27 * dpr;
      ctx.fillStyle = frac > 0.72 ? "rgba(94, 240, 181, 0.24)" : "rgba(122, 162, 255, 0.16)";
      ctx.strokeStyle = frac > 0.72 ? "#5ef0b5" : "#7aa2ff";
      ctx.lineWidth = 1.8 * dpr;
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      ctx.textAlign = "center";
      ctx.fillStyle = frac > 0.72 ? "#5ef0b5" : "#a8c2ff";
      ctx.fillText(frac > 0.72 ? dispNext : "?", boxX + boxW * 0.5, baseY);

      // Candidate probability fan on the right
      const barStartX = splitX + 54 * dpr;
      const barMaxW = Math.max(90 * dpr, W * 0.34);
      const rowGap = Math.min(34 * dpr, (H * 0.56) / cands.length);
      const topY = baseY - ((cands.length - 1) * rowGap) * 0.5;

      cands.forEach((c, i) => {
        const cy = topY + i * rowGap;
        const label = c.ch === " " ? "␣" : c.ch;
        const isPick = c.isTrue && frac > 0.65;

        // Subtle connecting curve from active box to candidate
        ctx.strokeStyle = isPick ? "rgba(94, 240, 181, 0.65)" : "rgba(122, 162, 255, 0.2)";
        ctx.lineWidth = (isPick ? 2 : 1) * dpr;
        ctx.beginPath();
        ctx.moveTo(boxX + boxW + 2 * dpr, boxY + boxH * 0.5);
        ctx.quadraticCurveTo(boxX + boxW + 24 * dpr, cy, barStartX - 18 * dpr, cy);
        ctx.stroke();

        // Candidate letter badge
        ctx.font = `600 ${13 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.textAlign = "center";
        ctx.fillStyle = isPick ? "#5ef0b5" : "#cfd7f0";
        ctx.fillText(label, barStartX - 9 * dpr, cy + 4 * dpr);

        // Bar track
        const bw = Math.max(4 * dpr, c.p * barMaxW * 1.45);
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(barStartX + 4 * dpr, cy - 8 * dpr, barMaxW, 16 * dpr);
        ctx.fillStyle = isPick ? "#5ef0b5" : c.isTrue ? "#7aa2ff" : "rgba(122, 162, 255, 0.42)";
        ctx.fillRect(barStartX + 4 * dpr, cy - 8 * dpr, Math.min(barMaxW, bw), 16 * dpr);

        ctx.textAlign = "left";
        ctx.font = `${11 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = isPick ? "#5ef0b5" : "#8d98b8";
        ctx.fillText(`${(c.p * 100).toFixed(0)}%`, barStartX + Math.min(barMaxW, bw) + 10 * dpr, cy + 4 * dpr);
      });
    },
  };
}

// ---- 2. Fig 1: Live N-gram / Markov Table Builder --------------------------

export function mountMarkovDemo(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.54);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  let corpusIdx = 0;
  let order = 2; // context length k (1..4)
  let prefix = "th";
  let generated = "";
  let table = new Map<string, Map<string, number>>();

  const rebuildTable = () => {
    table = new Map();
    const src = CORPORA[corpusIdx].text;
    for (let i = 0; i <= src.length - order - 1; i++) {
      const ctxStr = src.slice(i, i + order);
      const nxt = src[i + order];
      let bucket = table.get(ctxStr);
      if (!bucket) {
        bucket = new Map();
        table.set(ctxStr, bucket);
      }
      bucket.set(nxt, (bucket.get(nxt) ?? 0) + 1);
    }
    // Seed a valid prefix from the corpus prompt or first matching key
    const p = CORPORA[corpusIdx].prompt;
    const candidate = p.slice(0, order);
    if (table.has(candidate)) {
      prefix = candidate;
    } else {
      const firstKey = table.keys().next().value;
      prefix = firstKey ?? " ".repeat(order);
    }
    generated = prefix;
    prefixInput.value = prefix;
  };

  const sampleNext = (ctxStr: string): string | null => {
    const bucket = table.get(ctxStr);
    if (!bucket || bucket.size === 0) return null;
    let sum = 0;
    for (const c of bucket.values()) sum += c;
    let r = Math.random() * sum;
    for (const [ch, c] of bucket.entries()) {
      r -= c;
      if (r <= 0) return ch;
    }
    return bucket.keys().next().value ?? null;
  };

  const generateRun = (steps = 90) => {
    let out = prefix;
    for (let i = 0; i < steps; i++) {
      const tail = out.slice(-order);
      const nxt = sampleNext(tail);
      if (!nxt) break;
      out += nxt;
    }
    generated = out;
    outEl.textContent = generated;
  };

  // Interactive panel: corpus picker, prefix input, and live output box
  const panel = document.createElement("div");
  panel.className = "sm-trainer-panel";
  panel.innerHTML = `
    <div class="sm-row">
      <div class="sm-chip-group" data-corpora></div>
      <label class="sm-prefix-wrap">
        <span>Prefix (last k chars):</span>
        <input type="text" class="sm-text-input sm-prefix-input" data-prefix maxlength="8" />
      </label>
    </div>
    <div class="sm-output-box">
      <div class="sm-output-head"><span>Sampled from Counting Table</span><span data-meta></span></div>
      <pre class="sm-output-pre" data-out></pre>
    </div>
  `;
  container.insertBefore(panel, shell.controls);

  const corporaEl = panel.querySelector<HTMLElement>("[data-corpora]")!;
  const prefixInput = panel.querySelector<HTMLInputElement>("[data-prefix]")!;
  const outEl = panel.querySelector<HTMLElement>("[data-out]")!;
  const metaEl = panel.querySelector<HTMLElement>("[data-meta]")!;

  CORPORA.forEach((c, idx) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sm-chip" + (idx === 0 ? " is-active" : "");
    b.textContent = c.label;
    b.addEventListener("click", () => {
      corpusIdx = idx;
      corporaEl.querySelectorAll(".sm-chip").forEach((el, i) => el.classList.toggle("is-active", i === idx));
      rebuildTable();
      generateRun(85);
    });
    corporaEl.appendChild(b);
  });

  prefixInput.addEventListener("input", () => {
    const val = prefixInput.value;
    if (val.length > 0) {
      prefix = val.slice(-order);
      generated = prefix;
      outEl.textContent = generated;
    }
  });

  shell.slider({
    label: "context k",
    min: 1,
    max: 5,
    step: 1,
    value: order,
    format: (v) => `${Math.round(v)} char${v > 1 ? "s" : ""}`,
    onInput: (v) => {
      order = Math.round(v);
      rebuildTable();
      generateRun(85);
    },
  });
  shell.button("generate", () => generateRun(95));
  shell.button("step 1 char", () => {
    const tail = generated.slice(-order);
    const nxt = sampleNext(tail);
    if (nxt) {
      generated += nxt;
      prefix = generated.slice(-order);
      prefixInput.value = prefix;
      outEl.textContent = generated;
    }
  });

  rebuildTable();
  generateRun(85);

  const fmtSci = (exp: number): string => {
    const val = Math.pow(98, exp);
    if (val < 1e6) return Math.round(val).toLocaleString();
    const p = Math.floor(Math.log10(val));
    const m = val / Math.pow(10, p);
    return `${m.toFixed(1)} × 10^${p}`;
  };

  let infoStr = "";
  shell.setInfo(() => infoStr);

  return {
    frame() {
      shell.tick();
      ctx.fillStyle = "#0a0c14";
      ctx.fillRect(0, 0, W, H);
      const pad = 24 * dpr;

      const activeKey = prefix.slice(-order);
      const bucket = table.get(activeKey);
      let totalHits = 0;
      const entries: { ch: string; count: number; p: number }[] = [];
      if (bucket) {
        for (const c of bucket.values()) totalHits += c;
        for (const [ch, count] of bucket.entries()) entries.push({ ch, count, p: count / totalHits });
        entries.sort((a, b) => b.count - a.count);
      }

      const possibleCells = fmtSci(order + 1);
      metaEl.textContent = `k=${order} · ${table.size} seen prefixes`;
      infoStr = `Observed ${table.size} unique ${order}-char prefixes · full 98-char table needs ${possibleCells} cells`;

      // Left half: next-character counts for current prefix
      const leftW = W * 0.56 - pad * 1.5;
      ctx.textAlign = "left";
      ctx.font = `600 ${12 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = "#9aa4c2";
      const safeDisp = activeKey.replace(/\n/g, "↵").replace(/ /g, "␣");
      ctx.fillText(`NEXT CHARACTERS AFTER "${safeDisp}" (${totalHits} hits)`, pad, pad + 10 * dpr);

      const listY = pad + 34 * dpr;
      const shown = entries.slice(0, 8);
      if (shown.length === 0) {
        ctx.fillStyle = "#ff9e7d";
        ctx.font = `${12 * dpr}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText(
          `Prefix "${safeDisp}" never appeared in this corpus! Zero counts → table is stuck.`,
          pad,
          listY + 26 * dpr,
        );
        ctx.fillStyle = "#8a94b2";
        ctx.fillText("Try typing a prefix that appears in the text, or lower context k.", pad, listY + 48 * dpr);
      } else {
        const rowH = Math.min(30 * dpr, (H - listY - pad) / Math.max(6, shown.length));
        const maxP = Math.max(0.15, shown[0].p);
        shown.forEach((e, i) => {
          const y = listY + i * rowH;
          const lbl = e.ch === " " ? "␣" : e.ch === "\n" ? "↵" : e.ch;
          ctx.fillStyle = "#eef2ff";
          ctx.font = `600 ${13 * dpr}px ui-monospace, Menlo, monospace`;
          ctx.fillText(`'${lbl}'`, pad, y + 14 * dpr);

          const bx = pad + 42 * dpr;
          const bwMax = leftW - 140 * dpr;
          const bw = Math.max(4 * dpr, (e.p / maxP) * bwMax);
          ctx.fillStyle = "rgba(255,255,255,0.06)";
          ctx.fillRect(bx, y + 1 * dpr, bwMax, 18 * dpr);
          ctx.fillStyle = i === 0 ? "#5ef0b5" : "#7aa2ff";
          ctx.fillRect(bx, y + 1 * dpr, bw, 18 * dpr);

          ctx.fillStyle = "#b8c3e0";
          ctx.font = `${11 * dpr}px ui-monospace, Menlo, monospace`;
          ctx.fillText(`${(e.p * 100).toFixed(0)}% (${e.count})`, bx + bwMax + 10 * dpr, y + 14 * dpr);
        });
      }

      // Right half: The Combinatorial Wall (log10 table size vs k)
      const rx = pad * 2 + leftW;
      const rw = W - rx - pad;
      ctx.fillStyle = "#9aa4c2";
      ctx.font = `600 ${12 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText("THE WALL: TABLE SIZE = 98^(k+1)", rx, pad + 10 * dpr);

      const boxY = pad + 26 * dpr;
      const boxH = H - boxY - pad;
      ctx.fillStyle = "rgba(15, 19, 32, 0.9)";
      ctx.strokeStyle = "rgba(122, 162, 255, 0.2)";
      ctx.lineWidth = dpr;
      ctx.fillRect(rx, boxY, rw, boxH);
      ctx.strokeRect(rx, boxY, rw, boxH);

      const ks = [1, 2, 3, 4, 5, 10];
      const maxLog = 11 * Math.log10(98); // k=10 => 98^11
      const barStep = (boxH - 26 * dpr) / ks.length;
      ks.forEach((kVal, idx) => {
        const y = boxY + 14 * dpr + idx * barStep;
        const logVal = (kVal + 1) * Math.log10(98);
        const frac = logVal / maxLog;
        const isCur = kVal === order;

        ctx.fillStyle = isCur ? "#5ef0b5" : "#9aa4c2";
        ctx.font = `${isCur ? 700 : 500} ${11 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillText(`k=${kVal}`, rx + 10 * dpr, y + 14 * dpr);

        const bx = rx + 50 * dpr;
        const maxW = rw - 134 * dpr;
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(bx, y + 3 * dpr, maxW, 15 * dpr);
        ctx.fillStyle = isCur ? "#5ef0b5" : kVal >= 5 ? "#ff7a8a" : "#7aa2ff";
        ctx.fillRect(bx, y + 3 * dpr, Math.max(5 * dpr, frac * maxW), 15 * dpr);

        ctx.fillStyle = "#eef2ff";
        ctx.textAlign = "right";
        ctx.fillText(fmtSci(kVal + 1), rx + rw - 10 * dpr, y + 14 * dpr);
        ctx.textAlign = "left";
      });
    },
  };
}

// ---- 3. Fig 2: Logits, Softmax, Temperature, Top-p & Surprise Lab ----------

export function mountSoftmaxTempDemo(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.56);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  const tokens = ["h", "o", "r", "e", "a", "z"];
  let logits = [2.6, 1.3, 0.8, 0.4, -0.3, -1.8];
  let temp = 1.0;
  let topP = 0.9;
  let trueIdx = 0; // "the" after "t" -> 'h'
  let sampledIdx: number | null = null;
  let sampleFlash = 0;

  const computeProbs = (): { probs: number[]; kept: boolean[] } => {
    const t = Math.max(0.08, temp);
    const scaled = logits.map((z) => z / t);
    const maxZ = Math.max(...scaled);
    const exps = scaled.map((z) => Math.exp(z - maxZ));
    const sum = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map((e) => e / sum);

    // Top-p nucleus mask
    const order = tokens.map((_, i) => i).sort((a, b) => probs[b] - probs[a]);
    const kept = new Array(tokens.length).fill(false);
    let cum = 0;
    for (const idx of order) {
      kept[idx] = true;
      cum += probs[idx];
      if (cum >= topP) break;
    }
    return { probs, kept };
  };

  // Click directly on left logit bars to adjust them, or click token letter to pick the true next letter!
  let dragIdx = -1;
  const layout = () => {
    const pad = 24 * dpr;
    const leftW = W * 0.58 - pad * 1.5;
    const barAreaY = pad + 42 * dpr;
    const barAreaH = H - barAreaY - pad - 44 * dpr;
    const colW = leftW / tokens.length;
    return { pad, leftW, barAreaY, barAreaH, colW };
  };

  const toCanvas = (e: PointerEvent) => {
    const r = shell.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * W,
      y: ((e.clientY - r.top) / r.height) * H,
    };
  };

  const updateLogitFromY = (idx: number, y: number) => {
    const { barAreaY, barAreaH } = layout();
    const frac = 1 - (y - barAreaY) / barAreaH;
    const val = Math.max(-3.5, Math.min(4.5, -3.5 + frac * 8.0));
    logits[idx] = Math.round(val * 10) / 10;
  };

  shell.canvas.style.cursor = "pointer";
  shell.canvas.addEventListener("pointerdown", (e) => {
    const pt = toCanvas(e);
    const { pad, leftW, barAreaY, barAreaH, colW } = layout();
    if (pt.x >= pad && pt.x <= pad + leftW) {
      const idx = Math.floor((pt.x - pad) / colW);
      if (idx >= 0 && idx < tokens.length) {
        if (pt.y > barAreaY + barAreaH + 4 * dpr) {
          trueIdx = idx;
        } else if (pt.y >= barAreaY - 12 * dpr) {
          dragIdx = idx;
          shell.canvas.setPointerCapture(e.pointerId);
          updateLogitFromY(idx, pt.y);
        }
      }
    }
  });
  shell.canvas.addEventListener("pointermove", (e) => {
    if (dragIdx < 0) return;
    updateLogitFromY(dragIdx, toCanvas(e).y);
  });
  shell.canvas.addEventListener("pointerup", () => {
    dragIdx = -1;
  });

  shell.slider({
    label: "temperature T",
    min: 0.15,
    max: 2.4,
    step: 0.05,
    value: temp,
    format: (v) => v.toFixed(2),
    onInput: (v) => (temp = v),
  });
  shell.slider({
    label: "top-p nucleus",
    min: 0.25,
    max: 1.0,
    step: 0.05,
    value: topP,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (topP = v),
  });
  shell.button("roll dice", () => {
    const { probs, kept } = computeProbs();
    let total = 0;
    for (let i = 0; i < probs.length; i++) if (kept[i]) total += probs[i];
    let r = Math.random() * total;
    for (let i = 0; i < probs.length; i++) {
      if (!kept[i]) continue;
      r -= probs[i];
      if (r <= 0) {
        sampledIdx = i;
        sampleFlash = 1;
        return;
      }
    }
    sampledIdx = 0;
    sampleFlash = 1;
  });
  shell.button("confident", () => {
    logits = [2.6, 1.3, 0.8, 0.4, -0.3, -1.8];
    trueIdx = 0;
  });
  shell.button("torn 50/50", () => {
    logits = [2.1, 2.0, -0.4, -0.6, -1.0, -1.8];
    trueIdx = 0;
  });
  shell.button("wrong guess!", () => {
    logits = [2.6, 1.3, 0.8, 0.4, -0.3, -1.8];
    trueIdx = 5; // truth was 'z'!
  });

  let infoStr = "";
  shell.setInfo(() => infoStr);

  return {
    frame() {
      shell.tick();
      sampleFlash = Math.max(0, sampleFlash - 0.025);
      const { probs, kept } = computeProbs();
      const pTrue = Math.max(1e-6, probs[trueIdx]);
      const nats = -Math.log(pTrue);
      const bits = -Math.log2(pTrue);
      infoStr = `Truth = '${tokens[trueIdx]}' · P = ${(pTrue * 100).toFixed(1)}% · Cross-entropy loss = ${nats.toFixed(2)} nats (${bits.toFixed(2)} bits)`;

      ctx.fillStyle = "#0a0c14";
      ctx.fillRect(0, 0, W, H);
      const { pad, leftW, barAreaY, barAreaH, colW } = layout();

      // Left header
      ctx.textAlign = "left";
      ctx.fillStyle = "#9aa4c2";
      ctx.font = `600 ${11.5 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText("LOGITS (DRAG BARS) & SOFTMAX PROBS (CLICK TRUTH)", pad, pad + 10 * dpr);

      // Zero baseline for logits (range -3.5 to +4.5 -> 0 is at 3.5/8 from bottom)
      const zeroY = barAreaY + (1 - 3.5 / 8.0) * barAreaH;
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(pad, zeroY);
      ctx.lineTo(pad + leftW, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);

      tokens.forEach((tok, i) => {
        const cx = pad + (i + 0.5) * colW;
        const z = logits[i];
        const p = probs[i];
        const isTrue = i === trueIdx;
        const isSampled = i === sampledIdx && sampleFlash > 0.05;

        // Logit stem + handle (left sub-bar)
        const ly = barAreaY + (1 - (z + 3.5) / 8.0) * barAreaH;
        const bw = colW * 0.34;
        ctx.fillStyle = "rgba(122, 162, 255, 0.32)";
        ctx.fillRect(cx - bw - 2 * dpr, Math.min(ly, zeroY), bw, Math.abs(zeroY - ly));
        ctx.fillStyle = "#7aa2ff";
        ctx.fillRect(cx - bw - 2 * dpr, ly - 2 * dpr, bw, 4 * dpr);

        // Probability bar (right sub-bar)
        const ph = p * barAreaH;
        const pCol = isSampled
          ? "#ffffff"
          : isTrue
            ? "#5ef0b5"
            : kept[i]
              ? "#ffb86b"
              : "rgba(130, 142, 174, 0.35)";
        ctx.fillStyle = pCol;
        ctx.fillRect(cx + 2 * dpr, barAreaY + barAreaH - ph, bw, ph);

        // Numeric labels above
        ctx.textAlign = "center";
        ctx.font = `${10 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = "#8fb3ff";
        ctx.fillText(z.toFixed(1), cx - bw * 0.5 - 2 * dpr, Math.min(ly, zeroY) - 6 * dpr);
        ctx.fillStyle = isTrue ? "#5ef0b5" : kept[i] ? "#ffd19c" : "#677294";
        ctx.fillText(`${Math.round(p * 100)}%`, cx + bw * 0.5 + 2 * dpr, barAreaY + barAreaH - ph - 6 * dpr);

        // Clickable truth pill below
        const pillY = barAreaY + barAreaH + 10 * dpr;
        ctx.fillStyle = isTrue ? "rgba(94, 240, 181, 0.22)" : "rgba(255,255,255,0.05)";
        ctx.strokeStyle = isTrue ? "#5ef0b5" : "rgba(122,162,255,0.22)";
        ctx.lineWidth = dpr;
        ctx.fillRect(cx - 18 * dpr, pillY, 36 * dpr, 24 * dpr);
        ctx.strokeRect(cx - 18 * dpr, pillY, 36 * dpr, 24 * dpr);
        ctx.fillStyle = isTrue ? "#5ef0b5" : "#dce3f7";
        ctx.font = `700 ${13 * dpr}px ui-monospace, Menlo, monospace`;
        ctx.fillText(tok, cx, pillY + 16 * dpr);
      });

      // Legend under left panel
      ctx.textAlign = "left";
      ctx.font = `${10 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = "#7aa2ff";
      ctx.fillText("■ raw logit z", pad, pad + 26 * dpr);
      ctx.fillStyle = "#ffb86b";
      ctx.fillText("■ softmax prob (in top-p)", pad + 105 * dpr, pad + 26 * dpr);
      ctx.fillStyle = "#5ef0b5";
      ctx.fillText("■ true token", pad + 278 * dpr, pad + 26 * dpr);

      // Right half: Surprise / Cross-Entropy Curve L(p) = -ln(p)
      const rx = pad * 2 + leftW;
      const rw = W - rx - pad;
      const gy = barAreaY;
      const gh = barAreaH;

      ctx.fillStyle = "#9aa4c2";
      ctx.font = `600 ${11.5 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText("SURPRISE CURVE: LOSS = −ln(p)", rx, pad + 10 * dpr);

      ctx.fillStyle = "rgba(15, 19, 32, 0.9)";
      ctx.strokeStyle = "rgba(122, 162, 255, 0.2)";
      ctx.fillRect(rx, gy, rw, gh);
      ctx.strokeRect(rx, gy, rw, gh);

      const maxLoss = 6.0;
      // Curve
      ctx.beginPath();
      for (let s = 1; s <= 120; s++) {
        const pv = s / 120;
        const lv = Math.min(maxLoss, -Math.log(pv));
        const px = rx + 10 * dpr + pv * (rw - 20 * dpr);
        const py = gy + (1 - lv / maxLoss) * (gh - 20 * dpr) + 10 * dpr;
        if (s === 1) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = "rgba(122, 162, 255, 0.7)";
      ctx.lineWidth = 2.2 * dpr;
      ctx.stroke();

      // Current (pTrue, nats) marker
      const clampedLoss = Math.min(maxLoss, nats);
      const mx = rx + 10 * dpr + pTrue * (rw - 20 * dpr);
      const my = gy + (1 - clampedLoss / maxLoss) * (gh - 20 * dpr) + 10 * dpr;

      ctx.strokeStyle = "rgba(94, 240, 181, 0.4)";
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.moveTo(mx, gy + gh - 10 * dpr);
      ctx.lineTo(mx, my);
      ctx.lineTo(rx + 10 * dpr, my);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = nats > 2.5 ? "#ff6b81" : "#5ef0b5";
      ctx.beginPath();
      ctx.arc(mx, my, 6.5 * dpr, 0, Math.PI * 2);
      ctx.fill();

      // Big readout inside graph corner
      ctx.textAlign = "right";
      ctx.font = `700 ${18 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = nats > 2.5 ? "#ff6b81" : "#5ef0b5";
      ctx.fillText(`${nats.toFixed(2)} nats`, rx + rw - 14 * dpr, gy + 30 * dpr);
      ctx.font = `${11.5 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = "#b5c0de";
      ctx.fillText(`(${bits.toFixed(2)} bits)`, rx + rw - 14 * dpr, gy + 49 * dpr);
      ctx.fillStyle = "#7e88a8";
      ctx.fillText(`p('${tokens[trueIdx]}') = ${(pTrue * 100).toFixed(1)}%`, rx + rw - 14 * dpr, gy + 68 * dpr);

      // Axis hints
      ctx.textAlign = "left";
      ctx.fillStyle = "#6c7796";
      ctx.font = `${10 * dpr}px ui-monospace, Menlo, monospace`;
      ctx.fillText("p = 0 (shocked!)", rx + 4 * dpr, gy + gh + 16 * dpr);
      ctx.textAlign = "right";
      ctx.fillText("p = 1 (loss 0)", rx + rw, gy + gh + 16 * dpr);
    },
  };
}
