import type { Demo } from "../../lib/demoShell";

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

// x runs roughly with time; y separates the branches (silicon above,
// perovskite below, the tandem trunk in between).
const TREE_NODES: TechNode[] = [
  {
    id: "becquerel",
    year: "1839",
    title: "Photovoltaic effect",
    body: "Edmond Becquerel, 19, sees a current flow when he shines light on electrodes in an electrolyte. Light can move charge directly.",
    x: 0,
    y: 0,
    group: "roots",
  },
  {
    id: "selenium",
    year: "1883",
    title: "Selenium cell",
    body: "Charles Fritts coats selenium with a thin layer of gold. It converts about 1% of the light. Still, it shows a solid can turn light into electrical work.",
    x: 198,
    y: 0,
    group: "roots",
  },
  {
    id: "bell",
    year: "1954",
    title: "Bell Labs silicon",
    body: "Chapin, Fuller and Pearson demonstrate a silicon cell at about 6%. The solar cell becomes a semiconductor device.",
    x: 414,
    y: 0,
    group: "silicon",
  },
  {
    id: "space",
    year: "1958",
    title: "Vanguard 1",
    body: "The first solar-powered satellite. For two decades space is the market: reliability and watts per kilogram matter, cost per watt barely does.",
    x: 612,
    y: -110,
    group: "silicon",
  },
  {
    id: "sq",
    year: "1961",
    title: "The single-junction limit",
    body: "Shockley and Queisser's detailed-balance argument. One bandgap can't keep more than about a third of sunlight: photons below the gap pass through, and the excess energy of the rest becomes heat.",
    x: 612,
    y: 110,
    group: "limits",
  },
  {
    id: "passivation",
    year: "1970s–80s",
    title: "Surface passivation",
    body: "Grown oxides, texturing and better contacts. Silicon's surfaces stop eating the carriers the bulk produces.",
    x: 810,
    y: -51,
    group: "silicon",
  },
  {
    id: "perc",
    year: "1989",
    title: "PERC",
    body: "Blakers and Green at UNSW passivate the rear and contact it only through small openings: 22.8%. By the late 2010s PERC is what most factories make.",
    x: 1008,
    y: -51,
    group: "silicon",
  },
  {
    id: "dssc",
    year: "1991",
    title: "Dye-sensitized cells",
    body: "O'Regan and Grätzel's cheap, solution-made cell: a dye on porous TiO₂ in a liquid electrolyte. The perovskite story starts inside this device.",
    x: 810,
    y: 212,
    group: "perovskite",
  },
  {
    id: "hjt-topcon",
    year: "1990s–2013",
    title: "Passivated contacts",
    body: "Sanyo's HIT heterojunction (1990s) and Fraunhofer's TOPCon (2013) put a passivating layer between the metal and the wafer. These become the bottom cells tandems are built on.",
    x: 1206,
    y: -51,
    group: "silicon",
  },
  {
    id: "perovskite",
    year: "2009",
    title: "Perovskite absorber",
    body: "Kojima, Miyasaka and colleagues use CH₃NH₃PbI₃ in place of the dye: 3.8%. The liquid electrolyte dissolves it quickly.",
    x: 1008,
    y: 212,
    group: "perovskite",
  },
  {
    id: "solid",
    year: "2012",
    title: "Solid-state perovskite",
    body: "Two groups replace the liquid with a solid hole conductor and reach about 10%. The perovskite turns out to carry charge well by itself, so it becomes a thin-film semiconductor in its own right.",
    x: 1206,
    y: 212,
    group: "perovskite",
  },
  {
    id: "segregation",
    year: "2015",
    title: "Halide segregation",
    body: "Hoke and colleagues find that light splits mixed iodide–bromide films into iodide-rich and bromide-rich regions. Wide-gap top cells have to be made stable under light.",
    x: 1404,
    y: 280,
    group: "limits",
  },
  {
    id: "first-tandems",
    year: "2015",
    title: "First monolithic tandem",
    body: "MIT and Stanford grow a perovskite cell directly on a silicon cell, joined by a tunnel junction: 13.7%. Two terminals, one stack.",
    x: 1404,
    y: 85,
    group: "tandem",
  },
  {
    id: "textured",
    year: "2018",
    title: "Fully textured tandem",
    body: "EPFL and CSEM coat the perovskite conformally over silicon's micron-sized pyramids: 25.2%, with no polishing of the wafer.",
    x: 1602,
    y: 85,
    group: "tandem",
  },
  {
    id: "sam",
    year: "2020",
    title: "Monolayer contacts",
    body: "HZB uses a self-assembled monolayer one molecule thick as the hole contact: 29.15%. Fewer interface losses, almost no parasitic absorption.",
    x: 1800,
    y: 85,
    group: "tandem",
  },
  {
    id: "record",
    year: "2023–26",
    title: "Past 35% in the lab",
    body: "LONGi's certified records go 33.9% (2023), 34.6%, 34.85% (2025) and 35.5% (2026). Silicon alone tops out near 29.4%.",
    x: 1998,
    y: 26,
    group: "tandem",
  },
  {
    id: "factory",
    year: "2024",
    title: "First commercial modules",
    body: "Oxford PV ships 24.5% tandem modules from its pilot line in Germany. The open questions become lifetime, yield and cost.",
    x: 1998,
    y: 162,
    group: "tandem",
  },
];

const TREE_EDGES: TechEdge[] = [
  { from: "becquerel", to: "selenium" },
  { from: "selenium", to: "bell" },
  { from: "bell", to: "space" },
  { from: "bell", to: "sq", label: "how far can one cell go?" },
  { from: "bell", to: "passivation" },
  { from: "passivation", to: "perc" },
  { from: "perc", to: "hjt-topcon" },
  { from: "dssc", to: "perovskite" },
  { from: "perovskite", to: "solid" },
  { from: "solid", to: "segregation" },
  { from: "sq", to: "first-tandems", label: "split the spectrum" },
  { from: "solid", to: "first-tandems" },
  { from: "hjt-topcon", to: "first-tandems" },
  { from: "first-tandems", to: "textured" },
  { from: "textured", to: "sam" },
  { from: "sam", to: "record" },
  { from: "sam", to: "factory" },
];

const NODE_COLORS: Record<NodeGroup, string> = {
  roots: "#aab4d4",
  silicon: "#7aa2ff",
  limits: "#ffb86b",
  perovskite: "#5fe0a8",
  tandem: "#e58cff",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

  const toolbar = document.createElement("div");
  toolbar.className = "solar-tree-toolbar";
  const legend = document.createElement("span");
  legend.className = "solar-tree-legend";
  for (const [group, label] of [
    ["roots", "early"],
    ["silicon", "silicon"],
    ["perovskite", "perovskite"],
    ["limits", "limits"],
    ["tandem", "tandem"],
  ] as const) {
    const item = document.createElement("span");
    item.style.setProperty("--node-color", NODE_COLORS[group]);
    item.textContent = label;
    legend.appendChild(item);
  }
  toolbar.appendChild(legend);
  const buttons = document.createElement("span");
  buttons.className = "solar-tree-buttons";
  const mk = (label: string, aria: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.className = "demo-button k-b";
    b.textContent = label;
    b.setAttribute("aria-label", aria);
    buttons.appendChild(b);
    return b;
  };
  const zoomOut = mk("−", "Zoom out");
  const zoomIn = mk("+", "Zoom in");
  const fitButton = mk("fit", "Fit the whole tree");
  toolbar.appendChild(buttons);
  container.appendChild(toolbar);

  const viewport = document.createElement("div");
  viewport.className = "solar-tree-viewport";
  container.appendChild(viewport);

  const diagram = svg("svg");
  diagram.setAttribute("role", "img");
  diagram.setAttribute("aria-label", "Technology tree of perovskite-on-silicon tandem solar cells, 1839 to 2026");
  viewport.appendChild(diagram);

  const edgeLayer = svg("g");
  const nodeLayer = svg("g");
  diagram.append(edgeLayer, nodeLayer);

  const detail = document.createElement("aside");
  detail.className = "solar-tree-detail";
  detail.setAttribute("aria-live", "polite");
  container.appendChild(detail);

  const xs = TREE_NODES.map((n) => n.x);
  const ys = TREE_NODES.map((n) => n.y);
  const bounds = {
    x0: Math.min(...xs) - 110,
    x1: Math.max(...xs) + 110,
    y0: Math.min(...ys) - 70,
    y1: Math.max(...ys) + 70,
  };

  let centerX = 0;
  let centerY = 0;
  let zoom = 1;
  let selected = TREE_NODES.find((node) => node.id === "first-tandems") ?? TREE_NODES[0];
  const nodeElements = new Map<string, SVGGElement>();
  const nodeById = new Map(TREE_NODES.map((node) => [node.id, node]));

  const size = (): { w: number; h: number } => ({
    w: viewport.clientWidth || 860,
    h: viewport.clientHeight || 420,
  });

  const updateViewBox = (): void => {
    const { w, h } = size();
    const viewW = w / zoom;
    const viewH = h / zoom;
    diagram.setAttribute("viewBox", `${centerX - viewW / 2} ${centerY - viewH / 2} ${viewW} ${viewH}`);
  };

  const fitZoom = (): number => {
    const { w, h } = size();
    return clamp(Math.min(w / (bounds.x1 - bounds.x0), h / (bounds.y1 - bounds.y0)), 0.25, 1.4);
  };

  const fit = (): void => {
    const { w } = size();
    if (w < 560) {
      // on a phone the whole tree is too small to read; start on the newest branch
      zoom = 0.72;
      centerX = selected.x - 60;
      centerY = (bounds.y0 + bounds.y1) / 2 + 20;
    } else {
      zoom = fitZoom();
      centerX = (bounds.x0 + bounds.x1) / 2;
      centerY = (bounds.y0 + bounds.y1) / 2;
    }
    updateViewBox();
  };

  // first view: readable cards around the point where the branches join;
  // "fit" shows the whole tree
  const start = (): void => {
    const { w } = size();
    if (w < 560) return fit();
    zoom = 0.78;
    const join = nodeById.get("first-tandems")!;
    centerX = join.x - 40;
    centerY = (bounds.y0 + bounds.y1) / 2;
    updateViewBox();
  };

  const setZoom = (z: number): void => {
    zoom = clamp(z, 0.25, 2.2);
    updateViewBox();
  };

  const updateDetail = (): void => {
    detail.innerHTML = "";
    const y = document.createElement("span");
    y.textContent = selected.year;
    const t = document.createElement("strong");
    t.textContent = selected.title;
    const b = document.createElement("p");
    b.textContent = selected.body;
    detail.append(y, t, b);
    for (const [id, el] of nodeElements) el.classList.toggle("is-selected", id === selected.id);
  };

  for (const edge of TREE_EDGES) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    const line = svg("path");
    const mx = (from.x + to.x) / 2;
    const d = `M ${from.x + 86} ${from.y} C ${mx} ${from.y}, ${mx} ${to.y}, ${to.x - 86} ${to.y}`;
    setAttrs(line, { d, class: "solar-tree-edge" });
    edgeLayer.appendChild(line);
    if (edge.label) {
      const label = svg("text");
      label.classList.add("solar-tree-edge-label");
      label.textContent = edge.label;
      setAttrs(label, { x: mx, y: (from.y + to.y) / 2 - 10, "text-anchor": "middle" });
      edgeLayer.appendChild(label);
    }
  }

  const select = (node: TechNode): void => {
    selected = node;
    updateDetail();
  };

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
    year.style.setProperty("--node-color", NODE_COLORS[node.group]);
    year.textContent = node.year;
    setAttrs(year, { x: 12, y: 24 });
    g.appendChild(year);

    // titles wrap onto two lines when they don't fit the card
    const words = node.title.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (test.length > 18 && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    lines.push(line);
    lines.forEach((l, i) => {
      const head = svg("text");
      head.classList.add("solar-tree-title");
      head.textContent = l;
      setAttrs(head, { x: 12, y: (lines.length > 1 ? 46 : 54) + i * 18 });
      g.appendChild(head);
    });

    g.addEventListener("click", () => select(node));
    g.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select(node);
      }
    });

    nodeLayer.appendChild(g);
    nodeElements.set(node.id, g);
  }

  // drag to pan; a drag that moves more than a few pixels doesn't count as a click
  let dragging = false;
  let moved = 0;
  let lastX = 0;
  let lastY = 0;
  viewport.addEventListener("pointerdown", (event) => {
    dragging = true;
    moved = 0;
    lastX = event.clientX;
    lastY = event.clientY;
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved > 4 && !viewport.hasPointerCapture(event.pointerId)) viewport.setPointerCapture(event.pointerId);
    centerX -= dx / zoom;
    centerY -= dy / zoom;
    lastX = event.clientX;
    lastY = event.clientY;
    updateViewBox();
  });
  const end = (): void => {
    dragging = false;
  };
  viewport.addEventListener("pointerup", end);
  viewport.addEventListener("pointercancel", end);
  viewport.addEventListener(
    "click",
    (event) => {
      if (moved > 6) event.stopPropagation();
    },
    true,
  );
  // pinch on a trackpad (ctrl + wheel) zooms; plain scrolling scrolls the page
  viewport.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom(zoom * Math.exp(-event.deltaY * 0.01));
    },
    { passive: false },
  );

  zoomIn.addEventListener("click", () => setZoom(zoom * 1.25));
  zoomOut.addEventListener("click", () => setZoom(zoom / 1.25));
  fitButton.addEventListener("click", fit);

  const onResize = (): void => updateViewBox();
  window.addEventListener("resize", onResize);
  start();
  updateDetail();

  return {
    frame: () => {},
    dispose: () => window.removeEventListener("resize", onResize),
  };
}
