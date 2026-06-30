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

function spectralWeight(ev: number): number {
  const redIr = 0.62 * Math.exp(-((ev - 1.22) * (ev - 1.22)) / 0.27);
  const visible = 1.0 * Math.exp(-((ev - 1.82) * (ev - 1.82)) / 0.36);
  const blue = 0.42 * Math.exp(-((ev - 2.42) * (ev - 2.42)) / 0.22);
  return redIr + visible + blue;
}

function wavelengthNm(ev: number): number {
  return 1240 / ev;
}

const SILICON_ARCHITECTURES = [
  {
    title: "Al-BSF silicon",
    year: "1970s-2000s",
    ceiling: 18,
    recombinationControl: 0.34,
    manufacturability: 0.9,
    tandemReadiness: 0.18,
    layers: [
      ["front metal", "#d19b61", 0.1],
      ["textured silicon", "#7aa2ff", 0.54],
      ["aluminum back field", "#ffb86b", 0.22],
      ["rear metal", "#d19b61", 0.14],
    ],
    note: "Cheap and robust, but the rear surface wastes voltage through recombination.",
  },
  {
    title: "PERC",
    year: "1980s-2010s",
    ceiling: 24,
    recombinationControl: 0.58,
    manufacturability: 0.82,
    tandemReadiness: 0.38,
    layers: [
      ["front metal", "#d19b61", 0.08],
      ["textured silicon", "#7aa2ff", 0.48],
      ["rear passivation", "#7dd6a0", 0.14],
      ["local contacts", "#ffb86b", 0.12],
      ["rear metal", "#d19b61", 0.18],
    ],
    note: "Passivating the rear side turns a major loss channel into an optical and electrical asset.",
  },
  {
    title: "TOPCon",
    year: "2010s-now",
    ceiling: 26.5,
    recombinationControl: 0.76,
    manufacturability: 0.72,
    tandemReadiness: 0.68,
    layers: [
      ["front grid", "#d19b61", 0.07],
      ["textured silicon", "#7aa2ff", 0.48],
      ["tunnel oxide", "#7dd6a0", 0.08],
      ["poly-Si contact", "#e58cff", 0.16],
      ["rear metal", "#d19b61", 0.21],
    ],
    note: "A thin oxide and doped poly-Si contact let carriers out while keeping recombination down.",
  },
  {
    title: "HJT",
    year: "1990s-now",
    ceiling: 27,
    recombinationControl: 0.82,
    manufacturability: 0.64,
    tandemReadiness: 0.76,
    layers: [
      ["TCO / grid", "#64f4ff", 0.1],
      ["a-Si passivation", "#7dd6a0", 0.12],
      ["crystalline silicon", "#7aa2ff", 0.5],
      ["a-Si passivation", "#7dd6a0", 0.12],
      ["TCO / metal", "#d19b61", 0.16],
    ],
    note: "Thin amorphous silicon layers passivate both faces, making high voltage a practical manufacturing target.",
  },
  {
    title: "Perovskite/silicon tandem",
    year: "2010s-now",
    ceiling: 35,
    recombinationControl: 0.88,
    manufacturability: 0.43,
    tandemReadiness: 0.94,
    layers: [
      ["glass / TCO", "#64f4ff", 0.09],
      ["perovskite top cell", "#7dd6a0", 0.24],
      ["recombination junction", "#ffb86b", 0.1],
      ["passivated silicon", "#7aa2ff", 0.43],
      ["rear contact", "#d19b61", 0.14],
    ],
    note: "The silicon cell stays valuable; the thin top absorber sorts the high-energy photons first.",
  },
] as const;

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
  hint.textContent = "roots · silicon · limits · perovskite · tandem";
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

export function mountBandgapLossMap(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.58);
  const ctx = shell.canvas.getContext("2d")!;
  const w = shell.canvas.width;
  const h = shell.canvas.height;
  let bandgap = 1.12;
  let opticalQuality = 0.86;

  const compute = (): { useful: number; thermal: number; transmitted: number; missed: number } => {
    let useful = 0;
    let thermal = 0;
    let transmitted = 0;
    let missed = 0;
    for (let i = 0; i < 260; i++) {
      const ev = 0.55 + (i / 259) * 2.65;
      const weight = spectralWeight(ev);
      if (ev < bandgap) {
        transmitted += weight * ev;
      } else {
        useful += weight * bandgap * opticalQuality;
        thermal += weight * Math.max(0, ev - bandgap);
        missed += weight * bandgap * (1 - opticalQuality);
      }
    }
    const total = useful + thermal + transmitted + missed || 1;
    return {
      useful: useful / total,
      thermal: thermal / total,
      transmitted: transmitted / total,
      missed: missed / total,
    };
  };

  shell.slider({
    label: "Absorber bandgap",
    min: 0.9,
    max: 2.05,
    step: 0.01,
    value: bandgap,
    format: (v) => `${v.toFixed(2)} eV`,
    onInput: (v) => (bandgap = v),
  });
  shell.slider({
    label: "Optical/electrical quality",
    min: 0.55,
    max: 0.98,
    step: 0.01,
    value: opticalQuality,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (opticalQuality = v),
  });
  shell.setInfo(() => {
    const losses = compute();
    return `${Math.round(losses.useful * 100)}% useful · ${Math.round(losses.transmitted * 100)}% transmitted · ${Math.round(losses.thermal * 100)}% heat`;
  });

  const px = (v: number): number => (v * w) / 900;
  const xForEnergy = (ev: number): number => px(88) + ((ev - 0.55) / 2.65) * px(700);

  return {
    frame: () => {
      const losses = compute();
      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, w, h);

      const plotX = px(88);
      const plotY = px(70);
      const plotW = px(700);
      const plotH = px(155);
      const grad = ctx.createLinearGradient(plotX, 0, plotX + plotW, 0);
      grad.addColorStop(0, "#7c1d1d");
      grad.addColorStop(0.26, "#ff5540");
      grad.addColorStop(0.48, "#ffdd55");
      grad.addColorStop(0.68, "#56e38b");
      grad.addColorStop(0.84, "#43a1ff");
      grad.addColorStop(1, "#8b6dff");
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.2;
      ctx.fillRect(plotX, plotY, plotW, plotH);
      ctx.globalAlpha = 1;

      ctx.strokeStyle = "rgba(255,255,255,0.14)";
      ctx.strokeRect(plotX, plotY, plotW, plotH);
      ctx.beginPath();
      for (let i = 0; i < 220; i++) {
        const ev = 0.55 + (i / 219) * 2.65;
        const weight = spectralWeight(ev);
        const x = xForEnergy(ev);
        const y = plotY + plotH - weight * px(95);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "#f2f4fa";
      ctx.lineWidth = px(2);
      ctx.stroke();

      const egX = xForEnergy(bandgap);
      ctx.fillStyle = "rgba(122, 162, 255, 0.14)";
      ctx.fillRect(plotX, plotY, Math.max(0, egX - plotX), plotH);
      ctx.fillStyle = "rgba(255, 184, 107, 0.12)";
      ctx.fillRect(egX, plotY, plotX + plotW - egX, plotH);
      ctx.strokeStyle = "#7dd6a0";
      ctx.lineWidth = px(3);
      ctx.beginPath();
      ctx.moveTo(egX, plotY - px(10));
      ctx.lineTo(egX, plotY + plotH + px(12));
      ctx.stroke();

      ctx.font = `${px(14)}px ui-sans-serif, system-ui`;
      ctx.fillStyle = "#d7dbe6";
      ctx.fillText("sunlight by photon energy", plotX, plotY - px(18));
      ctx.fillStyle = "#7dd6a0";
      ctx.fillText(`${bandgap.toFixed(2)} eV gate · ${Math.round(wavelengthNm(bandgap))} nm`, egX + px(10), plotY + px(22));
      ctx.fillStyle = "#8a91a5";
      ctx.font = `${px(12)}px ui-monospace, Menlo, monospace`;
      ctx.fillText("too red: passes through", plotX, plotY + plotH + px(28));
      ctx.fillText("too energetic: excess becomes heat", egX + px(16), plotY + plotH + px(28));

      const barX = px(96);
      const barY = px(285);
      const barW = px(690);
      const barH = px(44);
      let cursor = barX;
      for (const [label, value, color] of [
        ["useful electrical work", losses.useful, "#7dd6a0"],
        ["thermalization", losses.thermal, "#ffb86b"],
        ["transmitted", losses.transmitted, "#7aa2ff"],
        ["collection losses", losses.missed, "#e58cff"],
      ] as const) {
        const segW = barW * value;
        ctx.fillStyle = hexAlpha(color, 0.72);
        ctx.fillRect(cursor, barY, segW, barH);
        if (segW > px(92)) {
          ctx.fillStyle = "#06070b";
          ctx.font = `${px(12)}px ui-sans-serif, system-ui`;
          ctx.fillText(label, cursor + px(10), barY + px(27));
        }
        cursor += segW;
      }
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.strokeRect(barX, barY, barW, barH);

      drawMeter(ctx, px(96), px(362), px(312), px(32), losses.useful / 0.42, "#7dd6a0", "single-junction proxy");
      drawMeter(ctx, px(474), px(362), px(312), px(32), 1 - Math.abs(bandgap - 1.34) / 0.9, "#ffb86b", "ideal-bandgap neighborhood");
      ctx.fillStyle = "#8a91a5";
      ctx.font = `${px(13)}px ui-sans-serif, system-ui`;
      drawWrapped(ctx, "The single-junction problem is visible here: moving the gate right lowers heat but throws away red photons; moving it left catches more light but wastes the extra energy of blue photons.", px(96), px(438), px(700), px(18));
      shell.tick();
    },
  };
}

export function mountSiliconArchitecture(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const ctx = shell.canvas.getContext("2d")!;
  const w = shell.canvas.width;
  const h = shell.canvas.height;
  let stage = 3;
  let interfaceQuality = 0.78;

  shell.slider({
    label: "Architecture",
    min: 0,
    max: SILICON_ARCHITECTURES.length - 1,
    step: 1,
    value: stage,
    format: (v) => SILICON_ARCHITECTURES[Math.round(v)]?.title ?? "",
    onInput: (v) => (stage = Math.round(v)),
  });
  shell.slider({
    label: "Interface quality",
    min: 0.35,
    max: 1,
    step: 0.01,
    value: interfaceQuality,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (interfaceQuality = v),
  });
  shell.setInfo(() => {
    const arch = SILICON_ARCHITECTURES[stage] ?? SILICON_ARCHITECTURES[0];
    const voltageGain = arch.recombinationControl * interfaceQuality;
    return `${arch.year} · ceiling ${arch.ceiling.toFixed(1)}% · passivation ${Math.round(voltageGain * 100)}%`;
  });

  const px = (v: number): number => (v * w) / 900;

  return {
    frame: () => {
      const arch = SILICON_ARCHITECTURES[stage] ?? SILICON_ARCHITECTURES[0];
      const voltageGain = clamp(arch.recombinationControl * interfaceQuality, 0, 1);
      const tandemFit = clamp(arch.tandemReadiness * (0.65 + interfaceQuality * 0.35), 0, 1);
      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, w, h);

      const baseX = px(84);
      const baseY = px(82);
      const stepW = px(126);
      for (let i = 0; i < SILICON_ARCHITECTURES.length; i++) {
        const item = SILICON_ARCHITECTURES[i];
        const x = baseX + i * stepW;
        const selected = i === stage;
        ctx.fillStyle = selected ? "rgba(122,162,255,0.22)" : "rgba(255,255,255,0.045)";
        ctx.strokeStyle = selected ? "#7aa2ff" : "rgba(255,255,255,0.12)";
        ctx.lineWidth = selected ? px(2) : px(1);
        ctx.fillRect(x, baseY + px(100 - item.ceiling * 2.3), px(82), px(item.ceiling * 2.3));
        ctx.strokeRect(x, baseY + px(100 - item.ceiling * 2.3), px(82), px(item.ceiling * 2.3));
        ctx.fillStyle = selected ? "#f2f4fa" : "#8a91a5";
        ctx.font = `${px(11)}px ui-sans-serif, system-ui`;
        drawWrapped(ctx, item.title, x - px(8), baseY + px(125), px(100), px(13));
        ctx.font = `${px(11)}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = "#ffb86b";
        ctx.fillText(`${item.ceiling}%`, x + px(12), baseY + px(92 - item.ceiling * 2.3));
      }

      ctx.fillStyle = "#d7dbe6";
      ctx.font = `${px(15)}px ui-sans-serif, system-ui`;
      ctx.fillText("silicon learned to spend less voltage at its surfaces", baseX, px(48));

      const stackX = px(126);
      const stackY = px(270);
      const stackW = px(315);
      const stackH = px(138);
      let y = stackY;
      for (const [name, color, frac] of arch.layers) {
        const layerH = stackH * frac;
        ctx.fillStyle = hexAlpha(color, 0.3);
        ctx.fillRect(stackX, y, stackW, layerH);
        ctx.strokeStyle = hexAlpha(color, 0.68);
        ctx.strokeRect(stackX, y, stackW, layerH);
        ctx.fillStyle = "#d7dbe6";
        ctx.font = `${px(11)}px ui-sans-serif, system-ui`;
        ctx.fillText(name, stackX + stackW + px(16), y + layerH * 0.64);
        y += layerH + px(4);
      }

      drawMeter(ctx, px(510), px(274), px(280), px(30), voltageGain, "#7dd6a0", "recombination control");
      drawMeter(ctx, px(510), px(322), px(280), px(30), arch.manufacturability, "#ffb86b", "manufacturing maturity");
      drawMeter(ctx, px(510), px(370), px(280), px(30), tandemFit, "#e58cff", "tandem bottom-cell fit");

      ctx.fillStyle = "#f2f4fa";
      ctx.font = `${px(15)}px ui-sans-serif, system-ui`;
      ctx.fillText(`${arch.title}: ${arch.year}`, px(126), px(246));
      ctx.fillStyle = "#8a91a5";
      ctx.font = `${px(13)}px ui-sans-serif, system-ui`;
      drawWrapped(ctx, arch.note, px(126), px(450), px(660), px(18));
      shell.tick();
    },
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

export function mountCompositionCompass(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.56);
  const ctx = shell.canvas.getContext("2d")!;
  const w = shell.canvas.width;
  const h = shell.canvas.height;
  let br = 0.34;
  let cationBalance = 0.68;
  let passivation = 0.66;

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
    label: "Cation balance",
    min: 0,
    max: 1,
    step: 0.01,
    value: cationBalance,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (cationBalance = v),
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
    const m = model(br, 0.24, passivation);
    const phaseRisk = clamp(smoothstep(0.37, 0.45, br) * (1.1 - cationBalance * 0.55), 0, 1);
    return `Eg ${m.bandgap.toFixed(2)} eV · current match ${Math.round(m.match * 100)}% · phase risk ${Math.round(phaseRisk * 100)}%`;
  });

  const px = (v: number): number => (v * w) / 900;

  return {
    frame: () => {
      const m = model(br, 0.24, passivation);
      const phaseRisk = clamp(smoothstep(0.37, 0.45, br) * (1.1 - cationBalance * 0.55), 0, 1);
      const voltageQuality = clamp(0.38 + passivation * 0.48 + cationBalance * 0.18 - phaseRisk * 0.22, 0, 1);
      const recipeScore = clamp(m.match * 0.44 + voltageQuality * 0.38 + (1 - phaseRisk) * 0.18, 0, 1);

      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, w, h);

      const mapX = px(112);
      const mapY = px(70);
      const mapW = px(500);
      const mapH = px(280);
      const cells = 24;
      for (let ix = 0; ix < cells; ix++) {
        for (let iy = 0; iy < cells; iy++) {
          const bx = ix / (cells - 1);
          const cy = iy / (cells - 1);
          const localBr = 0.25 + bx * 0.2;
          const localGap = bandgapFromBr(localBr);
          const localMatch = model(localBr, 0.24, passivation).match;
          const localRisk = clamp(smoothstep(0.37, 0.45, localBr) * (1.15 - cy * 0.55), 0, 1);
          const green = clamp(localMatch * 0.7 + cy * 0.18 - localRisk * 0.35, 0, 1);
          const red = clamp(localRisk * 0.75 + Math.abs(localGap - 1.72) * 0.42, 0, 1);
          ctx.fillStyle = `rgba(${Math.round(70 + red * 160)}, ${Math.round(80 + green * 150)}, ${Math.round(115 + green * 80)}, 0.68)`;
          ctx.fillRect(mapX + (ix / cells) * mapW, mapY + ((cells - 1 - iy) / cells) * mapH, mapW / cells + 1, mapH / cells + 1);
        }
      }
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.strokeRect(mapX, mapY, mapW, mapH);

      const pointX = mapX + ((br - 0.25) / 0.2) * mapW;
      const pointY = mapY + (1 - cationBalance) * mapH;
      ctx.strokeStyle = "#f2f4fa";
      ctx.lineWidth = px(2.5);
      ctx.beginPath();
      ctx.arc(pointX, pointY, px(10), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#f2f4fa";
      ctx.beginPath();
      ctx.arc(pointX, pointY, px(3), 0, Math.PI * 2);
      ctx.fill();

      ctx.font = `${px(14)}px ui-sans-serif, system-ui`;
      ctx.fillStyle = "#d7dbe6";
      ctx.fillText("composition field", mapX, mapY - px(22));
      ctx.fillStyle = "#8a91a5";
      ctx.font = `${px(12)}px ui-monospace, Menlo, monospace`;
      ctx.fillText("less Br / lower Eg", mapX, mapY + mapH + px(25));
      ctx.fillText("more Br / higher Eg", mapX + mapW - px(130), mapY + mapH + px(25));
      ctx.save();
      ctx.translate(mapX - px(35), mapY + mapH);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText("more balanced A-site mix", 0, 0);
      ctx.restore();

      drawMeter(ctx, px(660), px(86), px(165), px(30), m.match, "#7dd6a0", "current match");
      drawMeter(ctx, px(660), px(138), px(165), px(30), voltageQuality, "#7aa2ff", "voltage quality");
      drawMeter(ctx, px(660), px(190), px(165), px(30), 1 - phaseRisk, "#ffb86b", "phase stability");
      drawMeter(ctx, px(660), px(242), px(165), px(30), recipeScore, "#e58cff", "recipe score");

      ctx.fillStyle = "#8a91a5";
      ctx.font = `${px(13)}px ui-sans-serif, system-ui`;
      drawWrapped(ctx, "The useful top cell lives in a narrow neighborhood: wide enough bandgap for silicon, enough iodide-bromide stability to avoid segregation, and enough passivation to preserve voltage.", px(112), px(395), px(695), px(18));
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

export function mountManufacturingGauntlet(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.56);
  const ctx = shell.canvas.getContext("2d")!;
  const w = shell.canvas.width;
  const h = shell.canvas.height;
  let moduleArea = 0.55;
  let uniformity = 0.76;
  let encapsulation = 0.66;

  shell.slider({
    label: "Module area",
    min: 0,
    max: 1,
    step: 0.01,
    value: moduleArea,
    format: (v) => `${Math.round(100 + v * 9900)} cm²`,
    onInput: (v) => (moduleArea = v),
  });
  shell.slider({
    label: "Coating uniformity",
    min: 0.35,
    max: 1,
    step: 0.01,
    value: uniformity,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (uniformity = v),
  });
  shell.slider({
    label: "Encapsulation",
    min: 0.35,
    max: 1,
    step: 0.01,
    value: encapsulation,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (encapsulation = v),
  });

  const gateScores = (): Array<[string, number, string]> => {
    const areaPenalty = 0.14 + moduleArea * 0.42;
    return [
      ["uniform film", clamp(uniformity - areaPenalty * 0.28, 0, 1), "wide coating must not leave pinholes"],
      ["no shunts", clamp(uniformity * 0.72 + (1 - moduleArea) * 0.2, 0, 1), "tiny defects can short large-area cells"],
      ["current match", clamp(0.86 - Math.abs(moduleArea - 0.42) * 0.16, 0, 1), "subcells must still make equal series current"],
      ["damp heat", clamp(encapsulation - moduleArea * 0.2, 0, 1), "moisture and heat attack the softest interfaces"],
      ["bankable yield", clamp(uniformity * encapsulation * (1 - areaPenalty * 0.45), 0, 1), "repeatability matters more than one heroic cell"],
    ];
  };

  shell.setInfo(() => {
    const scores = gateScores();
    const passed = scores.filter(([, score]) => score > 0.7).length;
    const productScore = scores.reduce((acc, [, score]) => acc * (0.78 + score * 0.22), 1);
    return `${passed}/5 gates above 70% · module confidence ${Math.round(productScore * 100)}%`;
  });

  const px = (v: number): number => (v * w) / 900;

  return {
    frame: () => {
      const scores = gateScores();
      const productScore = scores.reduce((acc, [, score]) => acc * (0.78 + score * 0.22), 1);
      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, w, h);

      const startX = px(72);
      const y = px(150);
      const gateW = px(126);
      const gap = px(18);
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = px(2);
      ctx.beginPath();
      ctx.moveTo(startX, y + px(50));
      ctx.lineTo(startX + scores.length * (gateW + gap), y + px(50));
      ctx.stroke();

      for (let i = 0; i < scores.length; i++) {
        const [name, score, note] = scores[i];
        const x = startX + i * (gateW + gap);
        const color = score > 0.72 ? "#7dd6a0" : score > 0.52 ? "#ffb86b" : "#e58cff";
        ctx.fillStyle = hexAlpha(color, 0.16 + score * 0.18);
        ctx.strokeStyle = hexAlpha(color, 0.45 + score * 0.45);
        ctx.lineWidth = px(1.4);
        roundRect(ctx, x, y, gateW, px(104), px(8));
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = `${px(22)}px ui-monospace, Menlo, monospace`;
        ctx.fillText(`${Math.round(score * 100)}`, x + px(12), y + px(34));
        ctx.font = `${px(12)}px ui-sans-serif, system-ui`;
        ctx.fillStyle = "#f2f4fa";
        drawWrapped(ctx, name, x + px(12), y + px(58), gateW - px(24), px(14));
        ctx.fillStyle = "#8a91a5";
        ctx.font = `${px(10)}px ui-sans-serif, system-ui`;
        drawWrapped(ctx, note, x + px(12), y + px(78), gateW - px(20), px(12));
      }

      ctx.fillStyle = "#d7dbe6";
      ctx.font = `${px(15)}px ui-sans-serif, system-ui`;
      ctx.fillText("the lab-to-module gauntlet", startX, px(70));
      ctx.fillStyle = "#8a91a5";
      ctx.font = `${px(13)}px ui-sans-serif, system-ui`;
      drawWrapped(ctx, "A record cell proves a stack can work. A module process proves the stack can be repeated over large area, laminated, shipped, heated, cooled, biased, and insured.", startX, px(90), px(700), px(18));

      drawMeter(ctx, px(118), px(320), px(300), px(34), 1 - moduleArea * 0.58, "#7aa2ff", "small-cell advantage");
      drawMeter(ctx, px(480), px(320), px(300), px(34), productScore, "#7dd6a0", "module confidence");

      ctx.fillStyle = "#8a91a5";
      ctx.font = `${px(13)}px ui-sans-serif, system-ui`;
      drawWrapped(ctx, "The unpleasant lesson is that scale is not a photo enlargement. The defect statistics, thermal budget, lamination chemistry, edge seals, and process windows all change when the active area grows.", px(118), px(405), px(660), px(18));
      shell.tick();
    },
  };
}

export function mountCarrierJourney(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.58);
  const ctx = shell.canvas.getContext("2d")!;
  const w = shell.canvas.width;
  const h = shell.canvas.height;
  let field = 0.68;
  let lifetime = 0.72;
  let selectivity = 0.74;
  let time = 0;

  shell.slider({
    label: "Built-in field",
    min: 0.2,
    max: 1,
    step: 0.01,
    value: field,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (field = v),
  });
  shell.slider({
    label: "Carrier lifetime",
    min: 0.2,
    max: 1,
    step: 0.01,
    value: lifetime,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (lifetime = v),
  });
  shell.slider({
    label: "Contact selectivity",
    min: 0.2,
    max: 1,
    step: 0.01,
    value: selectivity,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (selectivity = v),
  });

  shell.setInfo(() => {
    const collection = clamp(field * 0.35 + lifetime * 0.35 + selectivity * 0.3, 0, 1);
    const recomb = clamp((1 - lifetime) * 0.48 + (1 - selectivity) * 0.32, 0, 1);
    return `collection ${Math.round(collection * 100)}% · recombination risk ${Math.round(recomb * 100)}%`;
  });

  const px = (v: number): number => (v * w) / 900;

  return {
    frame: () => {
      time += 0.016;
      const collection = clamp(field * 0.35 + lifetime * 0.35 + selectivity * 0.3, 0, 1);
      const recomb = clamp((1 - lifetime) * 0.48 + (1 - selectivity) * 0.32, 0, 1);
      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, w, h);

      const layers = [
        ["glass", "#9fdcff", 0.08],
        ["hole contact", "#ff74bb", 0.11],
        ["perovskite absorber", "#7dd6a0", 0.36],
        ["electron contact", "#42d6ff", 0.11],
        ["recombination junction", "#ffb86b", 0.1],
        ["silicon bottom cell", "#7aa2ff", 0.24],
      ] as const;
      const x0 = px(100);
      const y0 = px(74);
      const stackW = px(520);
      const stackH = px(260);
      let y = y0;
      for (const [name, color, frac] of layers) {
        const lh = stackH * frac;
        ctx.fillStyle = hexAlpha(color, 0.2);
        ctx.fillRect(x0, y, stackW, lh);
        ctx.strokeStyle = hexAlpha(color, 0.56);
        ctx.strokeRect(x0, y, stackW, lh);
        ctx.fillStyle = "#d7dbe6";
        ctx.font = `${px(11)}px ui-sans-serif, system-ui`;
        ctx.fillText(name, x0 + stackW + px(18), y + lh * 0.6);
        y += lh + px(3);
      }

      for (let i = 0; i < 14; i++) {
        const p = (time * (0.18 + field * 0.28) + i * 0.071) % 1;
        const x = x0 + px(30) + ((i * 47) % 450) * (stackW / px(520));
        const startY = y0 - px(40);
        const hitY = y0 + px(64) + p * px(116);
        drawArrow(ctx, x + Math.sin(i) * px(10), startY, x, hitY, "#ffcf62", px(1.25));
      }

      for (let i = 0; i < 11; i++) {
        const seed = (Math.sin(i * 91.7) * 0.5 + 0.5);
        const gx = x0 + px(55) + seed * (stackW - px(110));
        const gy = y0 + px(102) + (Math.sin(i * 37.1) * 0.5 + 0.5) * px(76);
        const phase = (time * (0.4 + field * 0.35) + i * 0.17) % 1;
        const good = phase < collection;
        const hx = gx - px(58) * phase * (0.55 + field);
        const ex = gx + px(64) * phase * (0.55 + field);
        const hy = gy - px(42) * phase;
        const ey = gy + px(42) * phase;
        ctx.fillStyle = good ? "#ff74bb" : "rgba(255,116,187,0.22)";
        ctx.beginPath();
        ctx.arc(hx, hy, px(4), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = good ? "#42d6ff" : "rgba(66,214,255,0.22)";
        ctx.beginPath();
        ctx.arc(ex, ey, px(4), 0, Math.PI * 2);
        ctx.fill();
        if (phase > lifetime * 0.9 && i % 3 === 0) {
          ctx.strokeStyle = `rgba(255, 120, 80, ${0.25 + recomb * 0.55})`;
          ctx.lineWidth = px(2);
          ctx.beginPath();
          ctx.arc(gx, gy, px(12 + 12 * Math.sin(time * 4 + i) ** 2), 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      drawMeter(ctx, px(96), px(385), px(210), px(32), collection, "#7dd6a0", "collected carriers");
      drawMeter(ctx, px(340), px(385), px(210), px(32), 1 - recomb, "#ffb86b", "avoids recombination");
      drawMeter(ctx, px(584), px(385), px(210), px(32), selectivity, "#e58cff", "right carrier, right contact");
      ctx.fillStyle = "#8a91a5";
      ctx.font = `${px(13)}px ui-sans-serif, system-ui`;
      drawWrapped(ctx, "Absorption is only the start. The device has to separate the electron and hole, keep them apart long enough, and deliver each one to a contact that does not let the wrong carrier leak backward.", px(96), px(452), px(700), px(18));
      shell.tick();
    },
  };
}

export function mountBandAlignment(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.55);
  const ctx = shell.canvas.getContext("2d")!;
  const w = shell.canvas.width;
  const h = shell.canvas.height;
  let samDipole = 0.58;
  let etlOffset = 0.42;
  let traps = 0.22;

  shell.slider({
    label: "SAM dipole",
    min: 0,
    max: 1,
    step: 0.01,
    value: samDipole,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (samDipole = v),
  });
  shell.slider({
    label: "ETL offset",
    min: 0,
    max: 1,
    step: 0.01,
    value: etlOffset,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (etlOffset = v),
  });
  shell.slider({
    label: "Interface traps",
    min: 0,
    max: 1,
    step: 0.01,
    value: traps,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (traps = v),
  });
  shell.setInfo(() => {
    const extraction = clamp(1 - Math.abs(etlOffset - 0.48) * 1.25, 0, 1);
    const voc = clamp(0.36 + samDipole * 0.32 + extraction * 0.2 - traps * 0.28, 0, 1);
    return `Voc proxy ${Math.round(voc * 100)}% · extraction ${Math.round(extraction * 100)}%`;
  });

  const px = (v: number): number => (v * w) / 900;

  return {
    frame: () => {
      const extraction = clamp(1 - Math.abs(etlOffset - 0.48) * 1.25, 0, 1);
      const voc = clamp(0.36 + samDipole * 0.32 + extraction * 0.2 - traps * 0.28, 0, 1);
      const recomb = clamp(traps * (1.1 - samDipole * 0.45), 0, 1);
      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, w, h);

      const x0 = px(94);
      const y0 = px(70);
      const regionW = px(150);
      const names = ["HTL / SAM", "perovskite", "ETL", "junction", "silicon"];
      const colors = ["#ff74bb", "#7dd6a0", "#42d6ff", "#ffb86b", "#7aa2ff"];
      for (let i = 0; i < names.length; i++) {
        const x = x0 + i * regionW;
        ctx.fillStyle = hexAlpha(colors[i], 0.09);
        ctx.fillRect(x, y0, regionW, px(240));
        ctx.strokeStyle = "rgba(255,255,255,0.09)";
        ctx.strokeRect(x, y0, regionW, px(240));
        ctx.fillStyle = "#8a91a5";
        ctx.font = `${px(11)}px ui-sans-serif, system-ui`;
        drawWrapped(ctx, names[i], x + px(12), y0 + px(260), regionW - px(18), px(13));
      }

      const conduction = [
        y0 + px(76 - samDipole * 16),
        y0 + px(62),
        y0 + px(68 + (etlOffset - 0.48) * 72),
        y0 + px(90),
        y0 + px(98),
      ];
      const valence = [
        y0 + px(194 - samDipole * 22),
        y0 + px(204),
        y0 + px(218 + etlOffset * 18),
        y0 + px(192),
        y0 + px(186),
      ];
      drawEnergyLine(ctx, x0, regionW, conduction, "#42d6ff", px);
      drawEnergyLine(ctx, x0, regionW, valence, "#ff74bb", px);

      ctx.setLineDash([px(7), px(6)]);
      ctx.strokeStyle = hexAlpha("#f2f4fa", 0.46);
      ctx.lineWidth = px(1.2);
      ctx.beginPath();
      ctx.moveTo(x0, y0 + px(122 - voc * 26));
      ctx.lineTo(x0 + regionW * names.length, y0 + px(122 - voc * 26));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#f2f4fa";
      ctx.font = `${px(12)}px ui-monospace, Menlo, monospace`;
      ctx.fillText("quasi-Fermi split", x0 + px(12), y0 + px(112 - voc * 26));

      for (let i = 0; i < 28; i++) {
        const x = x0 + px(170) + (Math.sin(i * 83.1) * 0.5 + 0.5) * px(260);
        const y = y0 + px(110) + (Math.sin(i * 39.7) * 0.5 + 0.5) * px(86);
        const alpha = traps * (0.15 + 0.55 * (Math.sin(i + performance.now() * 0.002) * 0.5 + 0.5));
        ctx.strokeStyle = `rgba(255, 112, 88, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, px(3 + traps * 5), 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = "#d7dbe6";
      ctx.font = `${px(15)}px ui-sans-serif, system-ui`;
      ctx.fillText("energy alignment is an interface design problem", x0, px(44));
      drawMeter(ctx, px(104), px(360), px(210), px(32), voc, "#7dd6a0", "voltage quality");
      drawMeter(ctx, px(346), px(360), px(210), px(32), extraction, "#42d6ff", "electron extraction");
      drawMeter(ctx, px(588), px(360), px(210), px(32), 1 - recomb, "#ffb86b", "trap suppression");
      shell.tick();
    },
  };
}

export function mountTandemCircuit(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.54);
  const ctx = shell.canvas.getContext("2d")!;
  const w = shell.canvas.width;
  const h = shell.canvas.height;
  let topology = 0;
  let topCurrent = 0.78;
  let bottomCurrent = 0.86;

  const topologies = ["2-terminal", "3-terminal", "4-terminal"] as const;
  shell.slider({
    label: "Topology",
    min: 0,
    max: 2,
    step: 1,
    value: topology,
    format: (v) => topologies[Math.round(v)] ?? "2-terminal",
    onInput: (v) => (topology = Math.round(v)),
  });
  shell.slider({
    label: "Top current",
    min: 0.45,
    max: 1.15,
    step: 0.01,
    value: topCurrent,
    format: (v) => `${v.toFixed(2)}x`,
    onInput: (v) => (topCurrent = v),
  });
  shell.slider({
    label: "Bottom current",
    min: 0.45,
    max: 1.15,
    step: 0.01,
    value: bottomCurrent,
    format: (v) => `${v.toFixed(2)}x`,
    onInput: (v) => (bottomCurrent = v),
  });

  shell.setInfo(() => {
    const twoTerminal = Math.min(topCurrent, bottomCurrent) * 2.05;
    const fourTerminal = topCurrent * 0.96 + bottomCurrent * 0.92;
    const score = topology === 0 ? twoTerminal : topology === 1 ? (twoTerminal + fourTerminal) * 0.5 - 0.08 : fourTerminal - 0.13;
    return `${topologies[topology]} · power proxy ${score.toFixed(2)}x`;
  });

  const px = (v: number): number => (v * w) / 900;

  return {
    frame: () => {
      const twoTerminal = Math.min(topCurrent, bottomCurrent) * 2.05;
      const fourTerminal = topCurrent * 0.96 + bottomCurrent * 0.92;
      const score = topology === 0 ? twoTerminal : topology === 1 ? (twoTerminal + fourTerminal) * 0.5 - 0.08 : fourTerminal - 0.13;
      const mismatch = 1 - Math.min(topCurrent, bottomCurrent) / Math.max(topCurrent, bottomCurrent);

      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, w, h);
      const x = px(110);
      const y = px(82);
      const cellW = px(290);
      const cellH = px(84);
      drawCellBlock(ctx, x, y, cellW, cellH, "#7dd6a0", "perovskite top cell", topCurrent, px);
      drawCellBlock(ctx, x, y + px(132), cellW, cellH, "#7aa2ff", "silicon bottom cell", bottomCurrent, px);

      ctx.strokeStyle = "#f2f4fa";
      ctx.lineWidth = px(2);
      if (topology === 0) {
        drawWire(ctx, x + cellW, y + cellH / 2, x + px(580), y + cellH / 2, px);
        drawWire(ctx, x + cellW, y + px(132) + cellH / 2, x + px(580), y + px(132) + cellH / 2, px);
        drawWire(ctx, x + px(60), y + cellH, x + px(60), y + px(132), px);
        ctx.fillStyle = "#ffb86b";
        ctx.font = `${px(13)}px ui-sans-serif, system-ui`;
        ctx.fillText("series connection: weaker current sets the stack", x + px(386), y + px(62));
      } else if (topology === 1) {
        drawWire(ctx, x + cellW, y + cellH / 2, x + px(580), y + cellH / 2, px);
        drawWire(ctx, x + cellW, y + px(132) + cellH / 2, x + px(580), y + px(132) + cellH / 2, px);
        drawWire(ctx, x + px(145), y + cellH, x + px(145), y + px(132), px);
        ctx.fillStyle = "#ffb86b";
        ctx.font = `${px(13)}px ui-sans-serif, system-ui`;
        drawWrapped(ctx, "shared middle contact: more routing freedom, harder module integration", x + px(386), y + px(50), px(310), px(17));
      } else {
        drawWire(ctx, x + cellW, y + cellH / 2, x + px(580), y + cellH / 2, px);
        drawWire(ctx, x + cellW, y + px(132) + cellH / 2, x + px(580), y + px(132) + cellH / 2, px);
        drawWire(ctx, x - px(60), y + cellH / 2, x, y + cellH / 2, px);
        drawWire(ctx, x - px(60), y + px(132) + cellH / 2, x, y + px(132) + cellH / 2, px);
        ctx.fillStyle = "#ffb86b";
        ctx.font = `${px(13)}px ui-sans-serif, system-ui`;
        drawWrapped(ctx, "independent subcells tolerate mismatch, but need extra transparent contacts and wiring", x + px(386), y + px(50), px(310), px(17));
      }

      drawMeter(ctx, px(110), px(330), px(220), px(32), 1 - mismatch, "#ffb86b", "current match");
      drawMeter(ctx, px(370), px(330), px(220), px(32), clamp(twoTerminal / 2.1, 0, 1), "#7dd6a0", "2T advantage");
      drawMeter(ctx, px(630), px(330), px(170), px(32), clamp(score / 2.1, 0, 1), "#e58cff", "selected proxy");
      ctx.fillStyle = "#8a91a5";
      ctx.font = `${px(13)}px ui-sans-serif, system-ui`;
      drawWrapped(ctx, "A two-terminal tandem is elegant because it drops into a module like a single cell. That same elegance creates the current-matching constraint. Four-terminal tandems can dodge mismatch, but they pay in optics, wiring, and manufacturing complexity.", px(110), px(420), px(690), px(18));
      shell.tick();
    },
  };
}

export function mountTextureCoating(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.56);
  const ctx = shell.canvas.getContext("2d")!;
  const w = shell.canvas.width;
  const h = shell.canvas.height;
  let texture = 0.65;
  let conformality = 0.72;
  let parasitic = 0.22;

  shell.slider({
    label: "Silicon texture",
    min: 0,
    max: 1,
    step: 0.01,
    value: texture,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (texture = v),
  });
  shell.slider({
    label: "Coating conformality",
    min: 0.25,
    max: 1,
    step: 0.01,
    value: conformality,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (conformality = v),
  });
  shell.slider({
    label: "Parasitic absorption",
    min: 0,
    max: 0.55,
    step: 0.01,
    value: parasitic,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (parasitic = v),
  });
  shell.setInfo(() => {
    const trap = clamp(texture * 0.55 + conformality * 0.25 - parasitic * 0.35, 0, 1);
    const shunt = clamp(texture * (1 - conformality) * 0.9, 0, 1);
    return `light trapping ${Math.round(trap * 100)}% · shunt risk ${Math.round(shunt * 100)}%`;
  });

  const px = (v: number): number => (v * w) / 900;

  return {
    frame: () => {
      const trap = clamp(texture * 0.55 + conformality * 0.25 - parasitic * 0.35, 0, 1);
      const shunt = clamp(texture * (1 - conformality) * 0.9, 0, 1);
      const optical = clamp(1 - parasitic - shunt * 0.18, 0, 1);
      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, w, h);

      const x0 = px(92);
      const y0 = px(92);
      const width = px(620);
      const amp = px(10 + texture * 42);
      const base = y0 + px(176);
      const points: Array<[number, number]> = [];
      for (let i = 0; i <= 120; i++) {
        const x = x0 + (i / 120) * width;
        const tri = Math.abs(((i / 12) % 2) - 1);
        const y = base - amp * tri;
        points.push([x, y]);
      }

      ctx.beginPath();
      ctx.moveTo(x0, y0 + px(292));
      for (const [x, y] of points) ctx.lineTo(x, y);
      ctx.lineTo(x0 + width, y0 + px(292));
      ctx.closePath();
      ctx.fillStyle = "rgba(122,162,255,0.26)";
      ctx.fill();
      ctx.strokeStyle = "rgba(122,162,255,0.72)";
      ctx.stroke();

      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const [x, y] = points[i];
        const coat = px(16 + conformality * 22) * (0.72 + 0.28 * Math.sin(i * 0.4));
        if (i === 0) ctx.moveTo(x, y - coat);
        else ctx.lineTo(x, y - coat);
      }
      for (let i = points.length - 1; i >= 0; i--) {
        const [x, y] = points[i];
        ctx.lineTo(x, y - px(2));
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(125,214,160,0.34)";
      ctx.fill();
      ctx.strokeStyle = "rgba(125,214,160,0.74)";
      ctx.stroke();

      for (let i = 0; i < 20; i++) {
        const idx = Math.floor((i / 20) * points.length);
        const [x, y] = points[idx];
        const bad = shunt * (Math.sin(i * 18.1) * 0.5 + 0.5);
        if (bad > 0.2) {
          ctx.strokeStyle = `rgba(255, 90, 80, ${bad})`;
          ctx.lineWidth = px(1.8);
          ctx.beginPath();
          ctx.moveTo(x, y - px(28));
          ctx.lineTo(x + px(8 * Math.sin(i)), y + px(28));
          ctx.stroke();
        }
      }

      for (let i = 0; i < 12; i++) {
        const x = x0 + px(22) + (i / 11) * (width - px(44));
        const bend = texture * px(26) * Math.sin(i * 1.7);
        drawArrow(ctx, x, y0 - px(46), x + bend, base - amp * 0.5, "#ffcf62", px(1.3));
      }

      ctx.fillStyle = "#d7dbe6";
      ctx.font = `${px(15)}px ui-sans-serif, system-ui`;
      ctx.fillText("textured silicon helps optics and punishes bad coating", x0, px(48));
      drawMeter(ctx, px(96), px(374), px(210), px(32), trap, "#7dd6a0", "light trapping");
      drawMeter(ctx, px(344), px(374), px(210), px(32), 1 - shunt, "#ffb86b", "shunt avoidance");
      drawMeter(ctx, px(592), px(374), px(210), px(32), optical, "#42d6ff", "transparent stack");
      shell.tick();
    },
  };
}

export function mountJVCurveExplorer(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.58);
  const ctx = shell.canvas.getContext("2d")!;
  const w = shell.canvas.width;
  const h = shell.canvas.height;
  let series = 0.2;
  let shunt = 0.16;
  let hysteresis = 0.28;

  shell.slider({
    label: "Series resistance",
    min: 0,
    max: 0.65,
    step: 0.01,
    value: series,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (series = v),
  });
  shell.slider({
    label: "Shunt leakage",
    min: 0,
    max: 0.65,
    step: 0.01,
    value: shunt,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (shunt = v),
  });
  shell.slider({
    label: "Hysteresis",
    min: 0,
    max: 0.75,
    step: 0.01,
    value: hysteresis,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (hysteresis = v),
  });
  shell.setInfo(() => {
    const ff = clamp(0.82 - series * 0.25 - shunt * 0.22 - hysteresis * 0.11, 0.35, 0.86);
    const pce = clamp(34.5 * ff * (1 - shunt * 0.15), 8, 31);
    return `fill factor ${Math.round(ff * 100)}% · PCE proxy ${pce.toFixed(1)}%`;
  });

  const px = (v: number): number => (v * w) / 900;

  return {
    frame: () => {
      const ff = clamp(0.82 - series * 0.25 - shunt * 0.22 - hysteresis * 0.11, 0.35, 0.86);
      const pce = clamp(34.5 * ff * (1 - shunt * 0.15), 8, 31);
      const x0 = px(98);
      const y0 = px(70);
      const plotW = px(550);
      const plotH = px(300);
      const voc = 1.82 - shunt * 0.28;
      const jsc = 1.0 - shunt * 0.12;
      const toX = (v: number): number => x0 + (v / 2.0) * plotW;
      const toY = (j: number): number => y0 + (1 - j / 1.16) * plotH;
      const curve = (v: number, reverse: boolean): number => {
        const knee = 1 / (1 + Math.exp((v - (1.45 - series * 0.28 + (reverse ? hysteresis * 0.08 : -hysteresis * 0.08))) * 9));
        return clamp(jsc * knee - shunt * v * 0.12, 0, 1.12);
      };

      let bestV = 0;
      let bestJ = 0;
      let bestP = -1;
      for (let i = 0; i <= 200; i++) {
        const v = (i / 200) * voc;
        const j = curve(v, true);
        const p = v * j;
        if (p > bestP) {
          bestP = p;
          bestV = v;
          bestJ = j;
        }
      }

      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.strokeRect(x0, y0, plotW, plotH);
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      for (let i = 1; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(x0, y0 + (i / 5) * plotH);
        ctx.lineTo(x0 + plotW, y0 + (i / 5) * plotH);
        ctx.moveTo(x0 + (i / 5) * plotW, y0);
        ctx.lineTo(x0 + (i / 5) * plotW, y0 + plotH);
        ctx.stroke();
      }

      for (const [reverse, color] of [[true, "#7dd6a0"], [false, "#e58cff"]] as const) {
        ctx.beginPath();
        for (let i = 0; i <= 180; i++) {
          const v = (i / 180) * voc;
          const x = toX(v);
          const y = toY(curve(v, reverse));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = px(2.4);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(255,184,107,0.14)";
      ctx.fillRect(x0, toY(bestJ), toX(bestV) - x0, y0 + plotH - toY(bestJ));
      ctx.strokeStyle = "#ffb86b";
      ctx.strokeRect(x0, toY(bestJ), toX(bestV) - x0, y0 + plotH - toY(bestJ));
      ctx.fillStyle = "#ffb86b";
      ctx.font = `${px(12)}px ui-monospace, Menlo, monospace`;
      ctx.fillText("MPP", toX(bestV) + px(8), toY(bestJ) + px(4));

      ctx.fillStyle = "#d7dbe6";
      ctx.font = `${px(14)}px ui-sans-serif, system-ui`;
      ctx.fillText("J-V curve: what the certified number compresses", x0, px(43));
      ctx.fillStyle = "#8a91a5";
      ctx.font = `${px(12)}px ui-monospace, Menlo, monospace`;
      ctx.fillText("voltage", x0 + plotW - px(54), y0 + plotH + px(28));
      ctx.save();
      ctx.translate(x0 - px(36), y0 + px(86));
      ctx.rotate(-Math.PI / 2);
      ctx.fillText("current density", 0, 0);
      ctx.restore();

      drawMeter(ctx, px(690), px(96), px(150), px(30), ff, "#7dd6a0", "fill factor");
      drawMeter(ctx, px(690), px(146), px(150), px(30), 1 - hysteresis, "#e58cff", "scan stability");
      drawMeter(ctx, px(690), px(196), px(150), px(30), pce / 31, "#ffb86b", "PCE proxy");
      drawWrapped(ctx, "Perovskites made the J-V measurement itself controversial early on because ion motion can create hysteresis. Stable devices still need high current, high voltage, high fill factor, and low scan-direction dependence.", px(690), px(266), px(150), px(16));
      shell.tick();
    },
  };
}

export function mountDegradationMap(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.58);
  const ctx = shell.canvas.getContext("2d")!;
  const w = shell.canvas.width;
  const h = shell.canvas.height;
  let heat = 0.55;
  let moisture = 0.36;
  let biasUv = 0.48;
  let time = 0;

  shell.slider({
    label: "Heat",
    min: 0,
    max: 1,
    step: 0.01,
    value: heat,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (heat = v),
  });
  shell.slider({
    label: "Moisture ingress",
    min: 0,
    max: 1,
    step: 0.01,
    value: moisture,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (moisture = v),
  });
  shell.slider({
    label: "UV / electrical bias",
    min: 0,
    max: 1,
    step: 0.01,
    value: biasUv,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (biasUv = v),
  });
  shell.setInfo(() => {
    const hazard = clamp(heat * 0.3 + moisture * 0.34 + biasUv * 0.24 + heat * moisture * 0.18, 0, 1);
    return `accelerated stress ${Math.round(hazard * 100)}% · remaining lifetime proxy ${Math.round((1 - hazard * 0.72) * 100)}%`;
  });

  const px = (v: number): number => (v * w) / 900;

  return {
    frame: () => {
      time += 0.016;
      const ion = clamp(heat * 0.52 + biasUv * 0.38, 0, 1);
      const contact = clamp(moisture * 0.45 + biasUv * 0.28 + heat * 0.2, 0, 1);
      const phase = clamp(heat * 0.25 + biasUv * 0.18 + moisture * 0.14, 0, 1);
      const seal = clamp(1 - moisture * 0.72 - heat * 0.12, 0, 1);
      const hazard = clamp(ion * 0.28 + contact * 0.26 + phase * 0.18 + (1 - seal) * 0.28, 0, 1);
      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, w, h);

      const cx = px(450);
      const cy = px(210);
      const nodes = [
        ["ion migration", ion, "#e58cff", cx - px(250), cy - px(110)],
        ["phase segregation", phase, "#ffb86b", cx + px(210), cy - px(110)],
        ["contact corrosion", contact, "#ff7468", cx - px(260), cy + px(100)],
        ["edge seal failure", 1 - seal, "#42d6ff", cx + px(210), cy + px(100)],
      ] as const;

      ctx.fillStyle = "rgba(125,214,160,0.16)";
      roundRect(ctx, cx - px(120), cy - px(70), px(240), px(140), px(12));
      ctx.fill();
      ctx.strokeStyle = "rgba(125,214,160,0.65)";
      ctx.stroke();
      ctx.fillStyle = "#f2f4fa";
      ctx.font = `${px(15)}px ui-sans-serif, system-ui`;
      ctx.fillText("tandem stack", cx - px(50), cy - px(10));
      ctx.fillStyle = "#8a91a5";
      ctx.font = `${px(12)}px ui-sans-serif, system-ui`;
      ctx.fillText("absorber + interfaces + package", cx - px(84), cy + px(18));

      for (const [label, value, color, x, y] of nodes) {
        drawArrow(ctx, x + px(92), y + px(30), cx + (x < cx ? -px(110) : px(110)), cy + (y < cy ? -px(42) : px(42)), color, px(1.3 + value));
        ctx.fillStyle = hexAlpha(color, 0.16 + value * 0.22);
        roundRect(ctx, x, y, px(175), px(72), px(9));
        ctx.fill();
        ctx.strokeStyle = hexAlpha(color, 0.42 + value * 0.45);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = `${px(20)}px ui-monospace, Menlo, monospace`;
        ctx.fillText(`${Math.round(value * 100)}`, x + px(12), y + px(30));
        ctx.fillStyle = "#f2f4fa";
        ctx.font = `${px(12)}px ui-sans-serif, system-ui`;
        drawWrapped(ctx, label, x + px(12), y + px(52), px(148), px(13));
      }

      for (let i = 0; i < 34; i++) {
        const angle = i * 2.399 + time * (0.3 + hazard * 0.9);
        const r = px(38 + (i % 7) * 9 + hazard * 30);
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r * 0.6;
        ctx.fillStyle = `rgba(255, ${Math.round(150 - hazard * 70)}, 90, ${0.08 + hazard * 0.35})`;
        ctx.beginPath();
        ctx.arc(x, y, px(2 + hazard * 3), 0, Math.PI * 2);
        ctx.fill();
      }

      drawMeter(ctx, px(110), px(398), px(205), px(32), 1 - hazard, "#7dd6a0", "lifetime proxy");
      drawMeter(ctx, px(348), px(398), px(205), px(32), seal, "#42d6ff", "package barrier");
      drawMeter(ctx, px(586), px(398), px(205), px(32), 1 - ion, "#ffb86b", "ion stability");
      shell.tick();
    },
  };
}

export function mountProcessWindow(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.56);
  const ctx = shell.canvas.getContext("2d")!;
  const w = shell.canvas.width;
  const h = shell.canvas.height;
  let speed = 0.56;
  let chemistry = 0.7;
  let anneal = 0.58;

  shell.slider({
    label: "Line speed",
    min: 0.2,
    max: 1,
    step: 0.01,
    value: speed,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (speed = v),
  });
  shell.slider({
    label: "Solvent/vapor control",
    min: 0.2,
    max: 1,
    step: 0.01,
    value: chemistry,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (chemistry = v),
  });
  shell.slider({
    label: "Anneal budget",
    min: 0.2,
    max: 1,
    step: 0.01,
    value: anneal,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (anneal = v),
  });
  shell.setInfo(() => {
    const uniform = clamp(chemistry * 0.52 + anneal * 0.25 - speed * 0.18, 0, 1);
    const throughput = clamp(speed * (0.7 + uniform * 0.3), 0, 1);
    return `uniformity ${Math.round(uniform * 100)}% · throughput ${Math.round(throughput * 100)}%`;
  });

  const px = (v: number): number => (v * w) / 900;

  return {
    frame: () => {
      const uniform = clamp(chemistry * 0.52 + anneal * 0.25 - speed * 0.18, 0, 1);
      const throughput = clamp(speed * (0.7 + uniform * 0.3), 0, 1);
      const damage = clamp(anneal * 0.22 + speed * 0.18 - chemistry * 0.14, 0, 1);
      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, w, h);

      const x0 = px(86);
      const y0 = px(88);
      const steps = [
        ["wafer prep", "#7aa2ff"],
        ["transport layer", "#ff74bb"],
        ["perovskite coat", "#7dd6a0"],
        ["anneal", "#ffb86b"],
        ["top contact", "#42d6ff"],
        ["laminate", "#e58cff"],
      ] as const;
      for (let i = 0; i < steps.length; i++) {
        const x = x0 + i * px(116);
        const [label, color] = steps[i];
        ctx.fillStyle = hexAlpha(color, 0.13 + (i === 2 ? uniform * 0.18 : 0));
        roundRect(ctx, x, y0, px(96), px(72), px(8));
        ctx.fill();
        ctx.strokeStyle = hexAlpha(color, 0.55);
        ctx.stroke();
        ctx.fillStyle = "#f2f4fa";
        ctx.font = `${px(12)}px ui-sans-serif, system-ui`;
        drawWrapped(ctx, label, x + px(10), y0 + px(30), px(78), px(14));
        if (i < steps.length - 1) drawArrow(ctx, x + px(98), y0 + px(36), x + px(114), y0 + px(36), "#8a91a5", px(1.1));
      }

      const mapX = px(136);
      const mapY = px(225);
      const mapW = px(330);
      const mapH = px(190);
      for (let ix = 0; ix < 28; ix++) {
        for (let iy = 0; iy < 18; iy++) {
          const sx = ix / 27;
          const ay = iy / 17;
          const local = clamp(chemistry * 0.44 + ay * 0.26 - sx * 0.22 - Math.abs(ay - 0.58) * 0.18, 0, 1);
          ctx.fillStyle = `rgba(${Math.round(90 + (1 - local) * 130)}, ${Math.round(90 + local * 130)}, ${Math.round(120 + local * 70)}, 0.72)`;
          ctx.fillRect(mapX + (ix / 28) * mapW, mapY + ((17 - iy) / 18) * mapH, mapW / 28 + 1, mapH / 18 + 1);
        }
      }
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.strokeRect(mapX, mapY, mapW, mapH);
      const dotX = mapX + speed * mapW;
      const dotY = mapY + (1 - anneal) * mapH;
      ctx.strokeStyle = "#f2f4fa";
      ctx.lineWidth = px(2);
      ctx.beginPath();
      ctx.arc(dotX, dotY, px(9), 0, Math.PI * 2);
      ctx.stroke();

      drawMeter(ctx, px(540), px(240), px(260), px(32), uniform, "#7dd6a0", "film uniformity");
      drawMeter(ctx, px(540), px(292), px(260), px(32), throughput, "#ffb86b", "throughput");
      drawMeter(ctx, px(540), px(344), px(260), px(32), 1 - damage, "#42d6ff", "silicon compatibility");
      ctx.fillStyle = "#8a91a5";
      ctx.font = `${px(12)}px ui-monospace, Menlo, monospace`;
      ctx.fillText("line speed", mapX + mapW - px(70), mapY + mapH + px(24));
      ctx.save();
      ctx.translate(mapX - px(32), mapY + px(110));
      ctx.rotate(-Math.PI / 2);
      ctx.fillText("anneal budget", 0, 0);
      ctx.restore();
      shell.tick();
    },
  };
}

export function mountCostYieldMap(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.55);
  const ctx = shell.canvas.getContext("2d")!;
  const w = shell.canvas.width;
  const h = shell.canvas.height;
  let efficiencyGain = 0.55;
  let yieldLoss = 0.22;
  let capex = 0.36;

  shell.slider({
    label: "Efficiency gain",
    min: 0,
    max: 1,
    step: 0.01,
    value: efficiencyGain,
    format: (v) => `${Math.round(3 + v * 9)} pts`,
    onInput: (v) => (efficiencyGain = v),
  });
  shell.slider({
    label: "Yield loss",
    min: 0,
    max: 0.55,
    step: 0.01,
    value: yieldLoss,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (yieldLoss = v),
  });
  shell.slider({
    label: "Added capex",
    min: 0,
    max: 0.8,
    step: 0.01,
    value: capex,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (capex = v),
  });
  shell.setInfo(() => {
    const value = clamp(0.42 + efficiencyGain * 0.52 - yieldLoss * 0.64 - capex * 0.28, 0, 1);
    const watts = 1 + efficiencyGain * 0.34;
    return `factory value ${Math.round(value * 100)}% · watts/module ${watts.toFixed(2)}x`;
  });

  const px = (v: number): number => (v * w) / 900;

  return {
    frame: () => {
      const value = clamp(0.42 + efficiencyGain * 0.52 - yieldLoss * 0.64 - capex * 0.28, 0, 1);
      const watts = 1 + efficiencyGain * 0.34;
      const bankability = clamp(1 - yieldLoss * 1.25 - capex * 0.25, 0, 1);
      const x0 = px(105);
      const y0 = px(72);
      const mapW = px(430);
      const mapH = px(300);
      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, w, h);

      for (let ix = 0; ix < 34; ix++) {
        for (let iy = 0; iy < 26; iy++) {
          const eg = ix / 33;
          const yl = iy / 25;
          const local = clamp(0.42 + eg * 0.52 - yl * 0.64 - capex * 0.28, 0, 1);
          ctx.fillStyle = `rgba(${Math.round(105 + (1 - local) * 120)}, ${Math.round(75 + local * 160)}, ${Math.round(120 + local * 80)}, 0.72)`;
          ctx.fillRect(x0 + (ix / 34) * mapW, y0 + ((25 - iy) / 26) * mapH, mapW / 34 + 1, mapH / 26 + 1);
        }
      }
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.strokeRect(x0, y0, mapW, mapH);
      const dotX = x0 + efficiencyGain * mapW;
      const dotY = y0 + (yieldLoss / 0.55) * mapH;
      ctx.strokeStyle = "#f2f4fa";
      ctx.lineWidth = px(2.4);
      ctx.beginPath();
      ctx.arc(dotX, dotY, px(10), 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "#d7dbe6";
      ctx.font = `${px(15)}px ui-sans-serif, system-ui`;
      ctx.fillText("the factory cares about watts, yield, and risk at once", x0, px(43));
      ctx.fillStyle = "#8a91a5";
      ctx.font = `${px(12)}px ui-monospace, Menlo, monospace`;
      ctx.fillText("more efficiency gain", x0 + mapW - px(130), y0 + mapH + px(25));
      ctx.save();
      ctx.translate(x0 - px(34), y0 + px(190));
      ctx.rotate(-Math.PI / 2);
      ctx.fillText("more yield loss", 0, 0);
      ctx.restore();

      drawMeter(ctx, px(590), px(105), px(220), px(32), value, "#7dd6a0", "factory value");
      drawMeter(ctx, px(590), px(157), px(220), px(32), clamp((watts - 1) / 0.34, 0, 1), "#ffb86b", "watts per module");
      drawMeter(ctx, px(590), px(209), px(220), px(32), bankability, "#42d6ff", "bankability");
      drawWrapped(ctx, "The economic promise is simple: more watts from nearly the same area. The catch is equally simple: extra process steps must not erase the value through yield loss, capex, warranty risk, or slower throughput.", px(590), px(285), px(220), px(17));
      shell.tick();
    },
  };
}

function drawEnergyLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  regionW: number,
  levels: number[],
  color: string,
  px: (v: number) => number,
): void {
  ctx.beginPath();
  for (let i = 0; i < levels.length; i++) {
    const x = x0 + i * regionW + regionW * 0.1;
    const xEnd = x0 + i * regionW + regionW * 0.9;
    const y = levels[i];
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    ctx.lineTo(xEnd, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = px(2.2);
  ctx.stroke();
}

function drawCellBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  label: string,
  current: number,
  px: (v: number) => number,
): void {
  ctx.fillStyle = hexAlpha(color, 0.18);
  roundRect(ctx, x, y, w, h, px(10));
  ctx.fill();
  ctx.strokeStyle = hexAlpha(color, 0.7);
  ctx.stroke();
  ctx.fillStyle = "#f2f4fa";
  ctx.font = `${px(14)}px ui-sans-serif, system-ui`;
  ctx.fillText(label, x + px(18), y + px(30));
  drawMeter(ctx, x + px(18), y + px(45), w - px(36), px(24), current / 1.15, color, "current");
}

function drawWire(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  px: (v: number) => number,
): void {
  ctx.strokeStyle = "rgba(242,244,250,0.72)";
  ctx.lineWidth = px(2);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.fillStyle = "#f2f4fa";
  ctx.beginPath();
  ctx.arc(x1, y1, px(4), 0, Math.PI * 2);
  ctx.fill();
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

function drawWrapped(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(/\s+/);
  let line = "";
  let lineY = y;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, lineY);
      line = word;
      lineY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, lineY);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
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
