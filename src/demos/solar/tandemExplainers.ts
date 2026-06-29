import { Shell, type Demo } from "../../lib/demoShell";

const SVG_NS = "http://www.w3.org/2000/svg";

type NodeGroup = "roots" | "silicon" | "limits" | "perovskite" | "tandem";

interface TechNode {
  id: string;
  year: string;
  title: string;
  body: string;
  x: number;
  y: number;
  group: NodeGroup;
}

interface TechEdge {
  from: string;
  to: string;
  label?: string;
}

const TREE_NODES: TechNode[] = [
  {
    id: "becquerel",
    year: "1839",
    title: "Photovoltaic effect",
    body: "Becquerel observes voltage from illuminated electrodes: light can move charge directly, before anyone has a semiconductor theory.",
    x: 0,
    y: 0,
    group: "roots",
  },
  {
    id: "selenium",
    year: "1883",
    title: "Selenium cells",
    body: "Fritts builds a selenium cell. It is inefficient, but it proves a solid material can turn light into electrical work.",
    x: 220,
    y: 0,
    group: "roots",
  },
  {
    id: "bell",
    year: "1954",
    title: "Practical silicon",
    body: "Bell Labs demonstrates a roughly 6% silicon solar cell. The useful solar cell becomes a semiconductor device, not a curiosity.",
    x: 470,
    y: 0,
    group: "silicon",
  },
  {
    id: "space",
    year: "1958",
    title: "Space pays first",
    body: "Satellites make silicon PV valuable before it is cheap. High reliability matters more than cents per watt.",
    x: 660,
    y: 120,
    group: "silicon",
  },
  {
    id: "sq",
    year: "1961",
    title: "Single-junction limit",
    body: "Shockley and Queisser show why one bandgap wastes part of the spectrum: low-energy photons pass through, high-energy excess becomes heat.",
    x: 660,
    y: -150,
    group: "limits",
  },
  {
    id: "passivation",
    year: "1970s-80s",
    title: "Surface passivation",
    body: "Better oxides, textures, and contacts turn surfaces from recombination sites into managed interfaces.",
    x: 875,
    y: 0,
    group: "silicon",
  },
  {
    id: "perc",
    year: "1980s-90s",
    title: "PERC logic",
    body: "Passivated rear contacts and optical trapping extract more from each wafer. The cell becomes an interface engineering problem.",
    x: 1090,
    y: -10,
    group: "silicon",
  },
  {
    id: "dssc",
    year: "1991",
    title: "Dye-sensitized cells",
    body: "Solution-processed absorbers and selective contacts enter the PV imagination. Perovskites will inherit this experimental culture.",
    x: 980,
    y: 245,
    group: "perovskite",
  },
  {
    id: "perovskite",
    year: "2009",
    title: "Perovskite PV",
    body: "Organometal halide perovskites appear as light absorbers. Early devices are fragile, but the absorption is startlingly strong.",
    x: 1220,
    y: 245,
    group: "perovskite",
  },
  {
    id: "solid",
    year: "2012",
    title: "Solid-state perovskites",
    body: "Liquid electrolytes disappear. The absorber becomes a thin solid film with tunable bandgap and long carrier diffusion lengths.",
    x: 1445,
    y: 245,
    group: "perovskite",
  },
  {
    id: "hjt-topcon",
    year: "2010s",
    title: "HJT / TOPCon silicon",
    body: "Industrial silicon moves toward passivated contacts: less recombination at the metal interface, better voltage, better tandem bottom cells.",
    x: 1340,
    y: -20,
    group: "silicon",
  },
  {
    id: "first-tandems",
    year: "2014-18",
    title: "Perovskite on silicon",
    body: "The spectral split becomes practical: a wide-bandgap perovskite top cell handles blue-green light while silicon catches red and infrared.",
    x: 1585,
    y: 105,
    group: "tandem",
  },
  {
    id: "composition",
    year: "2020s",
    title: "Composition tuning",
    body: "FA/Cs/Rb cations, I/Br ratios, SAM contacts, C60/SnO2 transport layers, and passivation molecules all become tuning knobs.",
    x: 1805,
    y: 105,
    group: "tandem",
  },
  {
    id: "record",
    year: "2024-25",
    title: "Mid-30% lab cells",
    body: "Certified perovskite/silicon tandems cross into the mid-30% range. The central challenge shifts from 'can it work?' to 'can it last and scale?'",
    x: 2035,
    y: 105,
    group: "tandem",
  },
  {
    id: "factory",
    year: "now",
    title: "Factories begin",
    body: "Pilot and early commercial lines try to make the tandem stack repeatable on real wafers and modules, where moisture, heat, bias, and yield matter.",
    x: 2260,
    y: 105,
    group: "tandem",
  },
];

const TREE_EDGES: TechEdge[] = [
  { from: "becquerel", to: "selenium" },
  { from: "selenium", to: "bell" },
  { from: "bell", to: "space" },
  { from: "bell", to: "sq", label: "the limit appears" },
  { from: "bell", to: "passivation" },
  { from: "passivation", to: "perc" },
  { from: "perc", to: "hjt-topcon" },
  { from: "dssc", to: "perovskite" },
  { from: "perovskite", to: "solid" },
  { from: "sq", to: "first-tandems", label: "split the spectrum" },
  { from: "solid", to: "first-tandems" },
  { from: "hjt-topcon", to: "first-tandems" },
  { from: "first-tandems", to: "composition" },
  { from: "composition", to: "record" },
  { from: "record", to: "factory" },
];

const NODE_COLORS: Record<NodeGroup, string> = {
  roots: "#aab4d4",
  silicon: "#7aa2ff",
  limits: "#ffb86b",
  perovskite: "#7dd6a0",
  tandem: "#e58cff",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function bandgapFromBr(br: number): number {
  return 1.47 + br * 0.7;
}

function model(br: number, defects: number, passivation: number, intensity = 1): {
  bandgap: number;
  top: number;
  silicon: number;
  match: number;
  recombination: number;
  stability: number;
  efficiency: number;
} {
  const bandgap = bandgapFromBr(br);
  const top = clamp((1.13 - Math.max(0, bandgap - 1.68) * 1.75) * intensity, 0.08, 1.25);
  const silicon = clamp((0.68 + Math.max(0, bandgap - 1.62) * 1.55) * intensity, 0.08, 1.25);
  const match = Math.min(top, silicon) / Math.max(top, silicon);
  const recombination = clamp(defects * (1 - passivation * 0.86) * 0.58, 0, 0.58);
  const stability = smoothstep(0.37, 0.45, br) * 0.2;
  const efficiency = clamp(35 * Math.min(top, silicon) * match * (1 - recombination - stability - 0.13), 3, 34.8);
  return { bandgap, top, silicon, match, recombination, stability, efficiency };
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function setAttrs(el: Element, attrs: Record<string, string | number>): void {
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
}

export function mountTandemTechTree(container: HTMLElement): Demo {
  container.classList.add("demo", "solar-tree-demo");
  container.innerHTML = "";

  const toolbar = document.createElement("div");
  toolbar.className = "solar-tree-toolbar";
  const title = document.createElement("strong");
  title.textContent = "Technology tree";
  toolbar.appendChild(title);

  const hint = document.createElement("span");
  hint.textContent = "drag to pan · wheel/pinch to zoom · click a node";
  toolbar.appendChild(hint);

  const fitButton = document.createElement("button");
  fitButton.className = "demo-button";
  fitButton.textContent = "fit";
  toolbar.appendChild(fitButton);
  container.appendChild(toolbar);

  const viewport = document.createElement("div");
  viewport.className = "solar-tree-viewport";
  container.appendChild(viewport);

  const diagram = svg("svg");
  diagram.setAttribute("role", "img");
  diagram.setAttribute("aria-label", "Zoomable technology tree for perovskite silicon tandem solar cells");
  viewport.appendChild(diagram);

  const edgeLayer = svg("g");
  const nodeLayer = svg("g");
  diagram.append(edgeLayer, nodeLayer);

  const detail = document.createElement("aside");
  detail.className = "solar-tree-detail";
  container.appendChild(detail);

  let centerX = 1120;
  let centerY = 55;
  let zoom = 1;
  let selected = TREE_NODES.find((node) => node.id === "record") ?? TREE_NODES[0];
  const nodeElements = new Map<string, SVGGElement>();

  const nodeById = new Map(TREE_NODES.map((node) => [node.id, node]));

  const updateViewBox = (): void => {
    const w = viewport.clientWidth || 900;
    const h = viewport.clientHeight || 430;
    const viewW = w / zoom;
    const viewH = h / zoom;
    diagram.setAttribute("viewBox", `${centerX - viewW / 2} ${centerY - viewH / 2} ${viewW} ${viewH}`);
  };

  const updateDetail = (): void => {
    detail.innerHTML = `
      <span>${selected.year}</span>
      <strong>${selected.title}</strong>
      <p>${selected.body}</p>
    `;
    for (const [id, el] of nodeElements) {
      el.classList.toggle("is-selected", id === selected.id);
    }
  };

  for (const edge of TREE_EDGES) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    const line = svg("path");
    const mx = (from.x + to.x) / 2;
    const d = `M ${from.x + 86} ${from.y} C ${mx} ${from.y}, ${mx} ${to.y}, ${to.x - 86} ${to.y}`;
    setAttrs(line, {
      d,
      class: "solar-tree-edge",
    });
    edgeLayer.appendChild(line);
    if (edge.label) {
      const label = svg("text");
      label.classList.add("solar-tree-edge-label");
      label.textContent = edge.label;
      setAttrs(label, { x: mx, y: (from.y + to.y) / 2 - 8, "text-anchor": "middle" });
      edgeLayer.appendChild(label);
    }
  }

  for (const node of TREE_NODES) {
    const g = svg("g");
    g.classList.add("solar-tree-node", `solar-node-${node.group}`);
    g.tabIndex = 0;
    g.setAttribute("role", "button");
    g.setAttribute("aria-label", `${node.year}: ${node.title}`);
    setAttrs(g, { transform: `translate(${node.x - 86}, ${node.y - 42})` });

    const rect = svg("rect");
    setAttrs(rect, { width: 172, height: 84, rx: 9, ry: 9 });
    rect.style.setProperty("--node-color", NODE_COLORS[node.group]);
    g.appendChild(rect);

    const year = svg("text");
    year.classList.add("solar-tree-year");
    year.textContent = node.year;
    setAttrs(year, { x: 12, y: 22 });
    g.appendChild(year);

    const head = svg("text");
    head.classList.add("solar-tree-title");
    head.textContent = node.title;
    setAttrs(head, { x: 12, y: 48 });
    g.appendChild(head);

    const group = svg("text");
    group.classList.add("solar-tree-group");
    group.textContent = node.group;
    setAttrs(group, { x: 12, y: 68 });
    g.appendChild(group);

    g.addEventListener("click", () => {
      selected = node;
      updateDetail();
    });
    g.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selected = node;
        updateDetail();
      }
    });

    nodeLayer.appendChild(g);
    nodeElements.set(node.id, g);
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  viewport.addEventListener("pointerdown", (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const w = viewport.clientWidth || 900;
    const h = viewport.clientHeight || 430;
    centerX -= ((event.clientX - lastX) / w) * (w / zoom);
    centerY -= ((event.clientY - lastY) / h) * (h / zoom);
    lastX = event.clientX;
    lastY = event.clientY;
    updateViewBox();
  });
  viewport.addEventListener("pointerup", () => {
    dragging = false;
  });
  viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const before = zoom;
      zoom = clamp(zoom * Math.exp(-event.deltaY * 0.001), 0.38, 2.4);
      const factor = before / zoom;
      centerX = selected.x + (centerX - selected.x) * factor;
      centerY = selected.y + (centerY - selected.y) * factor;
      updateViewBox();
    },
    { passive: false },
  );

  fitButton.addEventListener("click", () => {
    centerX = 1120;
    centerY = 55;
    zoom = Math.min(1, Math.max(0.42, (viewport.clientWidth || 900) / 2500));
    updateViewBox();
  });

  window.addEventListener("resize", updateViewBox);
  fitButton.click();
  updateDetail();

  return {
    frame: () => {},
    dispose: () => window.removeEventListener("resize", updateViewBox),
  };
}

export function mountSpectrumSplitter(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.52);
  const ctx = shell.canvas.getContext("2d")!;
  const w = shell.canvas.width;
  const h = shell.canvas.height;
  let br = 0.34;
  let defects = 0.24;
  let passivation = 0.65;

  shell.slider({
    label: "Br fraction",
    min: 0.25,
    max: 0.45,
    step: 0.005,
    value: br,
    format: (v) => v.toFixed(3),
    onInput: (v) => (br = v),
  });
  shell.slider({
    label: "Defect density",
    min: 0,
    max: 1,
    step: 0.01,
    value: defects,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (defects = v),
  });
  shell.slider({
    label: "Passivation",
    min: 0,
    max: 1,
    step: 0.01,
    value: passivation,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (passivation = v),
  });
  shell.setInfo(() => {
    const m = model(br, defects, passivation);
    return `Eg ${m.bandgap.toFixed(2)} eV · match ${Math.round(m.match * 100)}% · proxy ${m.efficiency.toFixed(1)}%`;
  });

  const px = (v: number): number => (v * w) / 900;
  const energyToX = (ev: number): number => px(90) + ((ev - 0.8) / (2.8 - 0.8)) * px(700);

  return {
    frame: () => {
      const m = model(br, defects, passivation);
      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, w, h);

      const x0 = px(90);
      const y0 = px(72);
      const sw = px(700);
      const sh = px(64);
      const grad = ctx.createLinearGradient(x0, 0, x0 + sw, 0);
      grad.addColorStop(0, "#851f1f");
      grad.addColorStop(0.23, "#ff5540");
      grad.addColorStop(0.48, "#ffdd55");
      grad.addColorStop(0.66, "#56e38b");
      grad.addColorStop(0.82, "#43a1ff");
      grad.addColorStop(1, "#8b6dff");
      ctx.fillStyle = grad;
      ctx.fillRect(x0, y0, sw, sh);
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(x0, y0, sw, sh);
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.strokeRect(x0, y0, sw, sh);

      ctx.font = `${px(15)}px ui-sans-serif, system-ui`;
      ctx.fillStyle = "#d7dbe6";
      ctx.fillText("photon energy", x0, y0 - px(18));
      ctx.fillStyle = "#8a91a5";
      ctx.font = `${px(12)}px ui-monospace, Menlo, monospace`;
      ctx.fillText("red / infrared", x0, y0 + sh + px(24));
      ctx.fillText("violet / blue", x0 + sw - px(112), y0 + sh + px(24));

      const perovX = energyToX(m.bandgap);
      const siliconX = energyToX(1.12);
      for (const [x, label, color] of [
        [siliconX, "Si 1.12 eV", "#7aa2ff"],
        [perovX, `perovskite ${m.bandgap.toFixed(2)} eV`, "#7dd6a0"],
      ] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = px(3);
        ctx.beginPath();
        ctx.moveTo(x, y0 - px(10));
        ctx.lineTo(x, y0 + sh + px(10));
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.fillText(label, x + px(8), y0 - px(12));
      }

      const topY = px(188);
      const barH = px(34);
      drawMeter(ctx, px(90), topY, px(330), barH, m.top / 1.25, "#7dd6a0", "top-cell useful current");
      drawMeter(ctx, px(90), topY + px(50), px(330), barH, m.silicon / 1.25, "#7aa2ff", "silicon useful current");
      drawMeter(ctx, px(470), topY, px(320), barH, m.match, "#ffb86b", "series current match");
      drawMeter(ctx, px(470), topY + px(50), px(320), barH, 1 - m.recombination - m.stability, "#e58cff", "survival after defects/stability");

      const bx = px(108);
      const by = px(312);
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = px(1);
      ctx.strokeRect(bx, by, px(660), px(56));
      ctx.fillStyle = "rgba(125,214,160,0.16)";
      ctx.fillRect(bx, by, px(660) * clamp((2.8 - m.bandgap) / 2.0, 0, 1), px(25));
      ctx.fillStyle = "rgba(122,162,255,0.16)";
      ctx.fillRect(bx, by + px(31), px(660) * clamp((m.bandgap - 1.12) / 1.68, 0, 1), px(25));
      ctx.fillStyle = "#d7dbe6";
      ctx.font = `${px(13)}px ui-sans-serif, system-ui`;
      ctx.fillText("What bromide tuning is doing: raise the top bandgap, pass more red light to silicon, then hope both subcells make the same current.", bx, by + px(82));

      shell.tick();
    },
  };
}

export function mountLayerTradeoffs(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const ctx = shell.canvas.getContext("2d")!;
  const w = shell.canvas.width;
  const h = shell.canvas.height;
  let passivation = 0.65;
  let defects = 0.28;
  let br = 0.34;
  let time = 0;

  shell.slider({
    label: "Passivation",
    min: 0,
    max: 1,
    step: 0.01,
    value: passivation,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (passivation = v),
  });
  shell.slider({
    label: "Defect density",
    min: 0,
    max: 1,
    step: 0.01,
    value: defects,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (defects = v),
  });
  shell.slider({
    label: "Br fraction",
    min: 0.25,
    max: 0.45,
    step: 0.005,
    value: br,
    format: (v) => v.toFixed(3),
    onInput: (v) => (br = v),
  });
  shell.setInfo(() => {
    const m = model(br, defects, passivation);
    return `loss ${Math.round(m.recombination * 100)}% · stability penalty ${Math.round(m.stability * 100)}%`;
  });

  const layers = [
    ["glass", "#9fdcff", 0.12],
    ["TCO", "#64f4ff", 0.08],
    ["SAM", "#ff74bb", 0.06],
    ["perovskite", "#78caff", 0.22],
    ["passivation", "#7dd6a0", 0.06],
    ["C60 / SnO2", "#42d6ff", 0.08],
    ["recombination contact", "#ffcf62", 0.06],
    ["silicon HJT / TOPCon", "#7a8fff", 0.26],
    ["back metal", "#d19b61", 0.1],
  ] as const;

  return {
    frame: () => {
      time += 0.016;
      const px = (v: number): number => (v * w) / 900;
      const m = model(br, defects, passivation);
      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, w, h);

      const panelX = px(126);
      const panelY = px(70);
      const panelW = px(510);
      const totalH = px(255);
      let y = panelY;

      ctx.save();
      ctx.translate(px(0), px(8) * Math.sin(time * 0.7));
      for (const [name, color, frac] of layers) {
        const lh = totalH * frac;
        const isPerov = name === "perovskite";
        const alpha = isPerov ? 0.34 + smoothstep(0.37, 0.45, br) * 0.14 : 0.22;
        ctx.fillStyle = hexAlpha(color, alpha);
        ctx.fillRect(panelX, y, panelW, lh);
        ctx.strokeStyle = hexAlpha(color, 0.58);
        ctx.strokeRect(panelX, y, panelW, lh);
        ctx.fillStyle = "#d7dbe6";
        ctx.font = `${px(11)}px ui-sans-serif, system-ui`;
        ctx.fillText(name, panelX + panelW + px(18), y + lh * 0.62);
        y += lh + px(5);
      }

      const bad = clamp(defects * (1 - passivation * 0.75) + smoothstep(0.37, 0.45, br) * 0.45, 0, 1);
      for (let i = 0; i < 42; i++) {
        const seed = Math.sin(i * 127.1) * 43758.5453;
        const rx = panelX + (seed - Math.floor(seed)) * panelW;
        const ry = panelY + px(84) + ((Math.sin(i * 55.7) * 0.5 + 0.5) * px(60));
        const pulse = Math.max(0, Math.sin(time * (1.8 + bad * 4) + i));
        ctx.fillStyle = `rgba(255, ${Math.round(90 + 120 * passivation)}, 70, ${bad * (0.1 + pulse * 0.38)})`;
        ctx.beginPath();
        ctx.arc(rx, ry, px(2 + pulse * 5), 0, Math.PI * 2);
        ctx.fill();
      }

      for (let i = 0; i < 14; i++) {
        const x = panelX + (i / 13) * panelW;
        const p = (time * 0.35 + i * 0.13) % 1;
        drawArrow(ctx, x, panelY - px(42), x - px(18), panelY + px(82 + p * 120), "#ffcf62", px(1.4));
      }
      for (let i = 0; i < 7; i++) {
        const x = panelX + px(60 + i * 60);
        drawArrow(ctx, x, panelY + px(146), x - px(22), panelY + px(55), "#ff74bb", px(1.2));
        drawArrow(ctx, x, panelY + px(146), x + px(22), panelY + px(210), "#42d6ff", px(1.2));
      }
      ctx.restore();

      drawMeter(ctx, px(126), px(390), px(230), px(32), 1 - m.recombination, "#7dd6a0", "carrier survival");
      drawMeter(ctx, px(405), px(390), px(230), px(32), 1 - m.stability, "#ffb86b", "phase stability");

      ctx.fillStyle = "#8a91a5";
      ctx.font = `${px(13)}px ui-sans-serif, system-ui`;
      ctx.fillText("Passivation is not decoration. In this toy model it turns dark defect sites into quiet interfaces.", px(126), px(462));
      shell.tick();
    },
  };
}

function drawMeter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  value: number,
  color: string,
  label: string,
): void {
  ctx.fillStyle = "rgba(255,255,255,0.045)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = hexAlpha(color, 0.75);
  ctx.fillRect(x, y, w * clamp(value, 0, 1), h);
  ctx.fillStyle = "#d7dbe6";
  ctx.font = `${Math.max(11, h * 0.36)}px ui-sans-serif, system-ui`;
  ctx.fillText(label, x + 10, y + h * 0.65);
  ctx.fillStyle = "#f2f4fa";
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(clamp(value, 0, 1) * 100)}%`, x + w - 10, y + h * 0.65);
  ctx.textAlign = "left";
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const head = width * 4.5;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.72;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - ux * head, y1 - uy * head);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * head - uy * head * 0.55, y1 - uy * head + ux * head * 0.55);
  ctx.lineTo(x1 - ux * head + uy * head * 0.55, y1 - uy * head - ux * head * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function hexAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
