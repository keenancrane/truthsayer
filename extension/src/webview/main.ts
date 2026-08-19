// Truthsayer webview client.  Renders an InspectionReport into a richly
// styled, interactive DOM with cross-references, image thumbnails, search,
// and per-section toggles.
//
// No frameworks.  Just typed DOM helpers + the report shape from the host.

import type {
  InspectionReport,
  MeshInfo,
  MaterialInfo,
  PrimitiveInfo,
  TextureRef,
  ImageInfo,
  AnimationInfo,
  SkinInfo,
  CameraInfo,
  AccessorInfo,
  BufferInfo,
  BufferViewInfo,
  SamplerInfo,
  GltfNode,
  ExtensionEntry,
} from "../inspector.js";
import { ALL_SECTIONS, SECTION_TITLES, SectionId } from "../constants.js";
import { createViewer, Viewer } from "./viewer.js";

// ─── VS Code webview API ─────────────────────────────────────────────────

declare global {
  interface Window {
    acquireVsCodeApi: () => {
      postMessage: (msg: unknown) => void;
      getState: () => unknown;
      setState: (s: unknown) => void;
    };
  }
}
const vscode = window.acquireVsCodeApi();

// ─── DOM helpers ─────────────────────────────────────────────────────────

type Child = Node | string | null | undefined | false | Child[];

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, unknown> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v === null || v === undefined) continue;
      if (k === "class" || k === "className") el.className = String(v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v as object);
      else if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === "dataset" && typeof v === "object") {
        for (const [dk, dv] of Object.entries(v as object)) {
          el.dataset[dk] = String(dv);
        }
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el: HTMLElement, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

function tk(cls: string, text: string | number): HTMLSpanElement {
  return h("span", { class: `tk tk-${cls}` }, String(text));
}

function dim(text: string | number): HTMLSpanElement {
  return tk("dim", text);
}

function none(label: string = "—"): HTMLSpanElement {
  return tk("none", label);
}

// ─── Formatting helpers ──────────────────────────────────────────────────

function humanSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  if (exp === 0) return `${bytes} B`;
  return `${(bytes / Math.pow(1024, exp)).toFixed(2)} ${units[exp]}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtFloat(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  // 4 sig digits, like Python's :.4g
  return Number(n.toPrecision(4)).toString();
}

function fmtVector(v: number[] | null | undefined): string {
  if (!v || v.length === 0) return "—";
  return "[" + v.map((x) => (Number.isInteger(x) ? String(x) : fmtFloat(x))).join(", ") + "]";
}

function fmtRange(mn: number[] | null, mx: number[] | null): string {
  if (mn === null && mx === null) return "—";
  return `${fmtVector(mn)} → ${fmtVector(mx)}`;
}

function isIdentityMatrix(m: number[]): boolean {
  const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let i = 0; i < 16; i++) if (Math.abs(m[i] - id[i]) > 1e-6) return false;
  return true;
}

function fmtMatrix(m: number[]): string {
  if (m.length !== 16) return fmtVector(m);
  if (isIdentityMatrix(m)) return "(identity)";
  const rows: string[] = [];
  for (let r = 0; r < 4; r++) {
    rows.push("[" + m.slice(r * 4, r * 4 + 4).map(fmtFloat).join(", ") + "]");
  }
  return rows.join(" ");
}

// ─── Cross-references ────────────────────────────────────────────────────
//
// Every "thing" we render gets an id like `mesh-3` / `accessor-12`, so we can
// scroll/highlight on click.

function refId(kind: string, idx: number): string {
  return `ref-${kind}-${idx}`;
}

function xref(kind: string, idx: number, label?: Node | string): HTMLAnchorElement {
  const link = h("a", {
    class: "xref",
    href: "#",
    title: `Jump to ${kind} ${idx}`,
    onClick: (e: Event) => {
      e.preventDefault();
      jumpTo(kind, idx);
    },
  });
  if (label === undefined) {
    link.appendChild(document.createTextNode(String(idx)));
  } else if (typeof label === "string") {
    link.appendChild(document.createTextNode(label));
  } else {
    link.appendChild(label);
  }
  return link;
}

function jumpTo(kind: string, idx: number): void {
  const viewerKind = kind === "mesh" || kind === "node" || kind === "animation";
  // If the user clicks something that should affect the 3D viewport while it's
  // hidden, restore the split layout so they can see the result.
  if (viewerKind && state.layout === "inspector") {
    setLayout("both");
  }
  if (state.viewer) {
    if (kind === "mesh") state.viewer.frameMesh(idx);
    else if (kind === "node") state.viewer.frameNode(idx);
    else if (kind === "animation") state.viewer.playAnimation(idx);
  }
  const el = document.getElementById(refId(kind, idx));
  if (!el) return;
  const section = el.closest(".section") as HTMLElement | null;
  if (section) {
    section.classList.remove("hidden", "collapsed", "search-empty");
    const sid = section.dataset.section as SectionId | undefined;
    if (sid && !state.visibleSections.has(sid)) {
      state.visibleSections.add(sid);
      syncSectionsMenu();
      syncSectionNavHidden();
    }
  }
  let cur: HTMLElement | null = el;
  while (cur) {
    if (cur.tagName === "LI" && cur.classList.contains("collapsed")) {
      cur.classList.remove("collapsed");
    }
    cur = cur.parentElement;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("flash");
  void (el as HTMLElement).offsetWidth;
  el.classList.add("flash");
}

function refLabel(kind: string, idx: number, name: string | null): DocumentFragment {
  const f = document.createDocumentFragment();
  f.appendChild(dim(`${kind} `));
  f.appendChild(xref(kind.toLowerCase(), idx, tk("index", String(idx))));
  if (name) {
    f.appendChild(dim(' "'));
    f.appendChild(tk("name", name));
    f.appendChild(dim('"'));
  }
  return f;
}

// ─── Tree builder ────────────────────────────────────────────────────────
//
// Each node is <li> > <div.row> > content; children go into <ul>.
// Twisty appears for li with .has-children.

interface TreeNodeOptions {
  collapsed?: boolean;
  id?: string;
}

function treeNode(
  rowContent: Node | Child[],
  children?: HTMLLIElement[],
  opts: TreeNodeOptions = {}
): HTMLLIElement {
  const li = h("li", { id: opts.id });
  const row = h("div", { class: "row" });
  const hasChildren = !!children && children.length > 0;
  const twisty = h("span", { class: hasChildren ? "twisty" : "twisty-empty" });
  row.appendChild(twisty);
  if (Array.isArray(rowContent)) appendChildren(row, rowContent);
  else row.appendChild(rowContent);
  li.appendChild(row);
  if (hasChildren) {
    row.classList.add("collapsible");
    row.addEventListener("click", (e) => {
      // Don't fire when clicking xrefs/buttons/inputs/thumbs.
      const target = e.target as HTMLElement;
      if (target.closest("a, button, input, .thumb")) return;
      li.classList.toggle("collapsed");
    });
    const ul = h("ul");
    for (const c of children!) ul.appendChild(c);
    li.appendChild(ul);
  }
  if (opts.collapsed && hasChildren) li.classList.add("collapsed");
  return li;
}

function makeTree(label: Node | Child[], children: HTMLLIElement[], opts: TreeNodeOptions = {}): HTMLUListElement {
  const root = h("ul", { class: "tree" });
  root.appendChild(treeNode(label, children, opts));
  return root;
}

// ─── State ───────────────────────────────────────────────────────────────

interface InitPayload {
  fileUri: string;
  libBaseUri: string;
  docBaseUri: string;
  fileName: string;
  fileSize: number;
  autoLoad3D: boolean;
}

type LayoutMode = "both" | "viewer" | "inspector";

interface UiState {
  report: InspectionReport | null;
  visibleSections: Set<SectionId>;
  compact: boolean;
  search: string;
  initPayload: InitPayload | null;
  viewer: Viewer | null;
  splitRatio: number;
  layout: LayoutMode;
  inspectorPhase: "waiting" | "inspecting" | "ready" | "error";
  errorMessage: string | null;
}

const SPLIT_KEY = "truthsayer.split";
const LAYOUT_KEY = "truthsayer.layout";
const SAVED_SPLIT = (() => {
  try {
    const raw = (vscode.getState() as any)?.[SPLIT_KEY];
    if (typeof raw === "number" && raw > 0.1 && raw < 0.9) return raw;
  } catch { /* noop */ }
  return 0.5;
})();
const SAVED_LAYOUT: LayoutMode = (() => {
  try {
    const raw = (vscode.getState() as any)?.[LAYOUT_KEY];
    if (raw === "both" || raw === "viewer" || raw === "inspector") return raw;
  } catch { /* noop */ }
  return "both";
})();

function persistState(patch: Record<string, unknown>): void {
  try {
    const cur = (vscode.getState() as Record<string, unknown> | undefined) ?? {};
    vscode.setState({ ...cur, ...patch });
  } catch { /* noop */ }
}

const state: UiState = {
  report: null,
  visibleSections: new Set<SectionId>(ALL_SECTIONS),
  compact: false,
  search: "",
  initPayload: null,
  viewer: null,
  splitRatio: SAVED_SPLIT,
  layout: SAVED_LAYOUT,
  inspectorPhase: "waiting",
  errorMessage: null,
};

// ─── Top-level layout ────────────────────────────────────────────────────

function ensureLayout(): { viewerPane: HTMLElement; splitter: HTMLElement; inspectorPane: HTMLElement } {
  const app = document.getElementById("app")!;
  let viewerPane = document.getElementById("viewer-pane");
  let splitter = document.getElementById("splitter");
  let inspectorPane = document.getElementById("inspector-pane");
  if (!viewerPane || !splitter || !inspectorPane) {
    app.innerHTML = "";
    app.classList.add("split");
    viewerPane = h("div", { id: "viewer-pane" },
      h("div", { class: "viewer-toolbar", id: "viewer-toolbar" }),
      h("div", { class: "viewer-canvas-host", id: "viewer-canvas-host" }),
      h("div", { class: "viewer-status", id: "viewer-status" }, "Initializing 3D viewer…")
    );
    splitter = h(
      "div",
      { id: "splitter" },
      h("div", { class: "splitter-grip" }),
      h(
        "button",
        {
          class: "splitter-chev splitter-chev-left",
          title: "Hide 3D viewer (or restore inspector)",
          "aria-label": "Hide 3D viewer",
        },
        "‹"
      ),
      h(
        "button",
        {
          class: "splitter-chev splitter-chev-right",
          title: "Hide inspector (or restore 3D viewer)",
          "aria-label": "Hide inspector",
        },
        "›"
      )
    );
    inspectorPane = h("div", { id: "inspector-pane" });
    app.appendChild(viewerPane);
    app.appendChild(splitter);
    app.appendChild(inspectorPane);
    wireSplitter(splitter);
    wireSplitterChevrons(splitter);
    applyLayout();
  }
  return { viewerPane, splitter, inspectorPane };
}

function setViewerStatus(text: string): void {
  const el = document.getElementById("viewer-status");
  if (el) el.textContent = text;
}

function humanSizeShort(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "?";
  const units = ["B", "KB", "MB", "GB"];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const v = bytes / Math.pow(1024, exp);
  return `${exp === 0 ? bytes : v.toFixed(2)} ${units[exp]}`;
}

function renderInspectorStatus(): void {
  const pane = document.getElementById("inspector-pane");
  if (!pane) return;
  pane.innerHTML = "";
  if (state.inspectorPhase === "error") {
    pane.appendChild(h("div", { class: "error" }, `Failed to load file:\n\n${state.errorMessage ?? ""}`));
    return;
  }
  const init = state.initPayload;
  const subtitle = init
    ? `${init.fileName}  ·  ${humanSizeShort(init.fileSize)}`
    : "";
  pane.appendChild(
    h(
      "div",
      { class: "inspector-status" },
      h("div", { class: "inspector-status-spinner" }),
      h(
        "div",
        { class: "inspector-status-text" },
        h("div", { class: "inspector-status-line" },
          state.inspectorPhase === "inspecting" ? "Inspecting glTF structure…" : "Waiting for inspector…"),
        subtitle && h("div", { class: "inspector-status-sub" }, subtitle),
      )
    )
  );
}

function applyLayout(): void {
  const app = document.getElementById("app");
  if (!app) return;
  app.classList.remove("layout-both", "layout-viewer", "layout-inspector");
  app.classList.add(`layout-${state.layout}`);
  if (state.layout === "both") {
    app.style.gridTemplateColumns = `${state.splitRatio * 100}% 6px 1fr`;
  } else if (state.layout === "viewer") {
    app.style.gridTemplateColumns = `1fr 6px 0`;
  } else {
    app.style.gridTemplateColumns = `0 6px 1fr`;
  }
  refreshLayoutSwitch();
  refreshSplitterChevronTitles();
  // Pause/resume the WebGL render loop when the viewer pane is offscreen.
  state.viewer?.setPaused(state.layout === "inspector");
  // Tell the viewer to recompute its canvas size after the grid changes.
  requestAnimationFrame(() => state.viewer?.resize());
  persistState({ [LAYOUT_KEY]: state.layout });
}

function setLayout(mode: LayoutMode): void {
  if (state.layout === mode) return;
  state.layout = mode;
  applyLayout();
}

function refreshSplitterChevronTitles(): void {
  const left = document.querySelector<HTMLButtonElement>(".splitter-chev-left");
  const right = document.querySelector<HTMLButtonElement>(".splitter-chev-right");
  if (left) {
    if (state.layout === "viewer") {
      left.title = "Restore inspector";
      left.setAttribute("aria-label", "Restore inspector");
    } else {
      left.title = "Hide 3D viewer";
      left.setAttribute("aria-label", "Hide 3D viewer");
    }
  }
  if (right) {
    if (state.layout === "inspector") {
      right.title = "Restore 3D viewer";
      right.setAttribute("aria-label", "Restore 3D viewer");
    } else {
      right.title = "Hide inspector";
      right.setAttribute("aria-label", "Hide inspector");
    }
  }
}

function wireSplitter(splitter: HTMLElement): void {
  let dragging = false;
  splitter.addEventListener("pointerdown", (e) => {
    // Don't drag when clicking a chevron button, or when in single-pane mode.
    if ((e.target as HTMLElement).closest(".splitter-chev")) return;
    if (state.layout !== "both") return;
    dragging = true;
    splitter.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
  });
  splitter.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const app = document.getElementById("app")!;
    const rect = app.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    state.splitRatio = Math.max(0.15, Math.min(0.85, ratio));
    applyLayout();
  });
  const stop = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    splitter.releasePointerCapture(e.pointerId);
    document.body.style.cursor = "";
    persistState({ [SPLIT_KEY]: state.splitRatio });
  };
  splitter.addEventListener("pointerup", stop);
  splitter.addEventListener("pointercancel", stop);
}

function wireSplitterChevrons(splitter: HTMLElement): void {
  const left = splitter.querySelector<HTMLButtonElement>(".splitter-chev-left");
  const right = splitter.querySelector<HTMLButtonElement>(".splitter-chev-right");
  // The "‹" chevron always moves the splitter LEFT:
  //   both     → inspector-only (collapse the viewer)
  //   viewer   → both          (restore the inspector to the right)
  left?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (state.layout === "viewer") setLayout("both");
    else if (state.layout === "both") setLayout("inspector");
  });
  // The "›" chevron always moves the splitter RIGHT:
  //   both       → viewer-only  (collapse the inspector)
  //   inspector  → both         (restore the viewer to the left)
  right?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (state.layout === "inspector") setLayout("both");
    else if (state.layout === "both") setLayout("viewer");
  });
}

function renderRoot(): void {
  // We render the layout as soon as we have *anything* to show — either the
  // init payload (so the 3D viewer can start) or the inspector report.
  if (!state.initPayload && !state.report) {
    const app = document.getElementById("app");
    if (app && !document.getElementById("inspector-pane")) {
      app.innerHTML = "";
      app.appendChild(h("div", { class: "loading" }, "Activating Truthsayer…"));
    }
    return;
  }

  ensureLayout();
  if (state.initPayload) {
    maybeStartViewer();
  }

  if (state.report) {
    renderInspector(state.report);
  } else {
    renderInspectorStatus();
  }
  refreshViewerToolbar();
}

function renderInspector(r: InspectionReport): void {
  const pane = document.getElementById("inspector-pane");
  if (!pane) return;
  pane.innerHTML = "";
  pane.appendChild(renderBanner(r));
  pane.appendChild(renderToolbar());
  for (const sid of ALL_SECTIONS) {
    pane.appendChild(renderSection(sid, r));
  }
  applyVisibility();
  applySearch();
  setupSectionObserver();
}

function maybeStartViewer(): void {
  if (state.viewer || !state.initPayload) return;
  const init = state.initPayload;
  const host = document.getElementById("viewer-canvas-host");
  if (!host) return;
  if (!init.autoLoad3D) {
    showLoad3DButton();
    return;
  }
  startViewer();
}

function startViewer(): void {
  if (state.viewer || !state.initPayload) return;
  const init = state.initPayload;
  const host = document.getElementById("viewer-canvas-host");
  if (!host) return;
  // Clear any "Load 3D" placeholder.
  const placeholder = document.getElementById("viewer-placeholder");
  placeholder?.remove();
  setViewerStatus(`Loading 3D model… (${humanSizeShort(init.fileSize)})`);
  try {
    state.viewer = createViewer(
      host,
      { fileUri: init.fileUri, libBaseUri: init.libBaseUri },
      {
        onObjectClicked: ({ meshIndex, nodeIndex }) => {
          if (meshIndex !== null) jumpTo("mesh", meshIndex);
          else if (nodeIndex !== null) jumpTo("node", nodeIndex);
        },
      }
    );
    // Wait for the first successful render, then clear the status line.
    requestAnimationFrame(() => requestAnimationFrame(() => setViewerStatus("")));
    host.addEventListener("ts-viewer-error", (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      setViewerStatus(`3D viewer failed: ${detail}`);
    });
  } catch (err) {
    setViewerStatus(`3D viewer init failed: ${(err as Error).message}`);
  }
}

function showLoad3DButton(): void {
  if (document.getElementById("viewer-placeholder")) return;
  const host = document.getElementById("viewer-canvas-host");
  if (!host) return;
  const init = state.initPayload!;
  const sizeText = humanSizeShort(init.fileSize);
  const placeholder = h(
    "div",
    { id: "viewer-placeholder", class: "viewer-placeholder" },
    h("div", { class: "viewer-placeholder-title" }, "3D preview deferred"),
    h(
      "div",
      { class: "viewer-placeholder-sub" },
      `This file is ${sizeText}, larger than the auto-load threshold. Loading large GLBs over a remote workspace can take a while; the structural inspector on the right is unaffected.`
    ),
    h(
      "button",
      {
        class: "primary",
        onClick: () => startViewer(),
      },
      `Load 3D model (${sizeText})`
    )
  );
  host.appendChild(placeholder);
  setViewerStatus("");
}

interface ViewerOptionState {
  wireframe: boolean;
  doubleSided: boolean;
  normalsOverride: boolean;
  normalsHelpers: boolean;
  originArrows: boolean;
  background: "studio" | "dark" | "light" | "transparent";
  selectedAnimation: number | null;
  speed: number;
}
const viewerOpts: ViewerOptionState = {
  wireframe: false, doubleSided: false, normalsOverride: false,
  normalsHelpers: false, originArrows: false, background: "studio",
  selectedAnimation: null, speed: 1,
};

// Description of every visualization toggle, in the order shown in the menu.
type VizKey = "wireframe" | "doubleSided" | "normalsOverride" | "normalsHelpers" | "originArrows";
const VIZ_TOGGLES: { key: VizKey; label: string; hint: string; apply: (on: boolean) => void }[] = [
  { key: "wireframe",       label: "Wireframe",            hint: "Render polygons as wireframe", apply: (on) => state.viewer?.setWireframe(on) },
  { key: "doubleSided",     label: "Double-sided",         hint: "Render both sides of every face", apply: (on) => state.viewer?.setDoubleSided(on) },
  { key: "normalsOverride", label: "Normals (color)",      hint: "Override materials with normal-coloured shading", apply: (on) => state.viewer?.setNormalsOverride(on) },
  { key: "normalsHelpers",  label: "Vertex normal vectors", hint: "Draw a green line at every vertex normal", apply: (on) => state.viewer?.setNormalsHelpers(on) },
  { key: "originArrows",    label: "World origin arrows",  hint: "Show R/G/B XYZ axis at world origin", apply: (on) => state.viewer?.setOriginArrows(on) },
];

const BG_OPTIONS: { value: ViewerOptionState["background"]; label: string }[] = [
  { value: "studio",      label: "Studio" },
  { value: "dark",        label: "Dark" },
  { value: "light",       label: "Light" },
  { value: "transparent", label: "Transparent" },
];

function refreshViewerToolbar(): void {
  const bar = document.getElementById("viewer-toolbar");
  if (!bar) return;
  bar.innerHTML = "";

  // ─── Camera actions ─────────────────────────────────────────────────
  bar.appendChild(
    h("button", {
      title: "Frame the entire model in the camera view",
      onClick: () => state.viewer?.frameAll(),
    }, "Frame all")
  );

  bar.appendChild(h("span", { class: "divider" }));

  // ─── Visualize dropdown (checkbox toggles) ──────────────────────────
  const activeViz = VIZ_TOGGLES.filter((v) => viewerOpts[v.key] === true).length;
  const vizLabel = activeViz > 0 ? `Visualize (${activeViz}) ` : "Visualize ";
  bar.appendChild(makeCheckboxDropdown({
    label: vizLabel,
    title: "Show or hide visualization overlays",
    items: VIZ_TOGGLES.map((v) => ({
      label: v.label,
      hint: v.hint,
      checked: viewerOpts[v.key] === true,
      onToggle: (on: boolean) => {
        (viewerOpts as any)[v.key] = on;
        v.apply(on);
        // Re-render to update the "(N)" count badge in the dropdown label.
        refreshViewerToolbar();
      },
    })),
    actions: activeViz > 0 ? [
      {
        label: "Turn all off",
        onClick: () => {
          for (const v of VIZ_TOGGLES) {
            if (viewerOpts[v.key] === true) {
              (viewerOpts as any)[v.key] = false;
              v.apply(false);
            }
          }
          refreshViewerToolbar();
        },
      },
    ] : [],
  }));

  // ─── Background dropdown ────────────────────────────────────────────
  bar.appendChild(makeRadioDropdown({
    label: `Background: ${labelFor(BG_OPTIONS, viewerOpts.background)} `,
    title: "Viewport background colour",
    options: BG_OPTIONS.map((o) => ({
      value: o.value,
      label: o.label,
      checked: o.value === viewerOpts.background,
    })),
    onSelect: (v) => {
      viewerOpts.background = v as ViewerOptionState["background"];
      state.viewer?.setBackground(viewerOpts.background);
      refreshViewerToolbar();
    },
  }));

  // ─── Animation controls (only when the file has animations) ─────────
  const anims = state.viewer?.getAnimations() ?? [];
  if (anims.length) {
    bar.appendChild(h("span", { class: "divider" }));
    const sel = h("select", {
      class: "viewer-select",
      title: "Animation clip",
      onChange: (e: Event) => {
        const v = (e.target as HTMLSelectElement).value;
        viewerOpts.selectedAnimation = v === "" ? null : Number(v);
        state.viewer?.playAnimation(viewerOpts.selectedAnimation);
      },
    }) as HTMLSelectElement;
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "(no animation)";
    sel.appendChild(blank);
    for (const a of anims) {
      const o = document.createElement("option");
      o.value = String(a.index);
      o.textContent = `${a.name}  (${a.duration.toFixed(2)}s)`;
      if (viewerOpts.selectedAnimation === a.index) o.selected = true;
      sel.appendChild(o);
    }
    bar.appendChild(sel);
    bar.appendChild(h("span", { class: "viewer-label" }, "Speed"));
    const speed = h("input", {
      type: "number",
      min: "0.1",
      max: "5",
      step: "0.1",
      value: String(viewerOpts.speed),
      title: "Playback speed multiplier",
      style: { width: "4.5em" },
      onChange: (e: Event) => {
        const v = parseFloat((e.target as HTMLInputElement).value);
        if (Number.isFinite(v) && v > 0) {
          viewerOpts.speed = v;
          state.viewer?.setAnimationSpeed(v);
        }
      },
    }) as HTMLInputElement;
    bar.appendChild(speed);
  }
}

function labelFor<T extends string>(opts: { value: T; label: string }[], value: T): string {
  return opts.find((o) => o.value === value)?.label ?? String(value);
}

// Open / close a dropdown menu and auto-flip its anchor side if the menu
// would overflow the right edge of its containing pane.  Also closes any
// other dropdowns so only one is open at a time.
function toggleDropdown(menu: HTMLElement): void {
  const wasOpen = menu.classList.contains("open");
  document.querySelectorAll(".dropdown-menu.open").forEach((m) => {
    if (m !== menu) m.classList.remove("open");
  });
  if (wasOpen) {
    menu.classList.remove("open");
    return;
  }
  // Reset anchor before measuring (in case it was flipped on a previous open).
  // A menu marked dropdown-menu-right in markup stays right-anchored regardless.
  const isExplicitRight = menu.classList.contains("dropdown-menu-right");
  if (!isExplicitRight) menu.classList.remove("dropdown-menu-right");
  menu.classList.add("open");
  // After layout, check if the menu overflows on the right of its scroll
  // container (or the viewport) and flip if so.
  requestAnimationFrame(() => {
    if (!menu.classList.contains("open")) return;
    const menuRect = menu.getBoundingClientRect();
    const container =
      menu.closest<HTMLElement>("#viewer-pane, #inspector-pane") ?? document.body;
    const containerRect = container.getBoundingClientRect();
    const rightLimit = Math.min(containerRect.right, window.innerWidth);
    const leftLimit = Math.max(containerRect.left, 0);
    if (menuRect.right > rightLimit - 4 && !isExplicitRight) {
      menu.classList.add("dropdown-menu-right");
    } else if (menuRect.left < leftLimit + 4 && isExplicitRight) {
      // Right-anchored but overflowing left? Flip to left-anchor instead.
      menu.classList.remove("dropdown-menu-right");
    }
  });
}

interface CheckboxDropdownItem {
  label: string;
  hint?: string;
  checked: boolean;
  onToggle: (on: boolean) => void;
}
interface CheckboxDropdownAction {
  label: string;
  onClick: () => void;
}
function makeCheckboxDropdown(opts: {
  label: string;
  title: string;
  items: CheckboxDropdownItem[];
  actions?: CheckboxDropdownAction[];
}): HTMLElement {
  const wrap = h("div", { class: "dropdown-wrap" });
  const btn = h("button", {
    class: "dropdown-btn",
    title: opts.title,
    onClick: (e: Event) => {
      e.stopPropagation();
      toggleDropdown(menu);
    },
  }, opts.label, h("span", { class: "caret" }, "▾"));
  const menu = h("div", { class: "dropdown-menu" });
  for (const item of opts.items) {
    const cb = h("input", {
      type: "checkbox",
      checked: item.checked,
      onChange: () => item.onToggle((cb as HTMLInputElement).checked),
    }) as HTMLInputElement;
    menu.appendChild(
      h("label", { class: "dropdown-item", title: item.hint ?? "" },
        cb,
        h("span", { class: "dropdown-label" }, item.label),
      )
    );
  }
  if (opts.actions && opts.actions.length) {
    menu.appendChild(h("div", { class: "dropdown-sep" }));
    for (const action of opts.actions) {
      menu.appendChild(
        h("button", {
          class: "dropdown-action",
          onClick: () => action.onClick(),
        }, action.label)
      );
    }
  }
  document.addEventListener("click", () => menu.classList.remove("open"));
  menu.addEventListener("click", (e) => e.stopPropagation());
  wrap.appendChild(btn);
  wrap.appendChild(menu);
  return wrap;
}

interface RadioDropdownOption {
  value: string;
  label: string;
  checked: boolean;
}
function makeRadioDropdown(opts: {
  label: string;
  title: string;
  options: RadioDropdownOption[];
  onSelect: (value: string) => void;
}): HTMLElement {
  const wrap = h("div", { class: "dropdown-wrap" });
  const btn = h("button", {
    class: "dropdown-btn",
    title: opts.title,
    onClick: (e: Event) => {
      e.stopPropagation();
      toggleDropdown(menu);
    },
  }, opts.label, h("span", { class: "caret" }, "▾"));
  const menu = h("div", { class: "dropdown-menu" });
  for (const o of opts.options) {
    menu.appendChild(
      h("button", {
        class: "dropdown-action" + (o.checked ? " checked" : ""),
        onClick: () => {
          opts.onSelect(o.value);
          menu.classList.remove("open");
        },
      },
        h("span", { class: "radio-mark" }, o.checked ? "●" : "○"),
        h("span", { class: "dropdown-label" }, o.label),
      )
    );
  }
  document.addEventListener("click", () => menu.classList.remove("open"));
  menu.addEventListener("click", (e) => e.stopPropagation());
  wrap.appendChild(btn);
  wrap.appendChild(menu);
  return wrap;
}

function renderBanner(r: InspectionReport): HTMLElement {
  return h(
    "header",
    { class: "banner" },
    h(
      "div",
      { class: "banner-title" },
      "TRUTHSAYER",
      h("span", { class: "subtitle" }, "— glTF / GLB Inspector"),
      h("span", { class: "banner-file" }, r.file.name)
    ),
    h("div", { class: "banner-actions" })
  );
}

function renderToolbar(): HTMLElement {
  const search = h("input", {
    type: "search",
    placeholder: "Search names, indices, types…",
    value: state.search,
  }) as HTMLInputElement;
  search.addEventListener("input", () => {
    state.search = search.value.trim();
    applySearch();
  });

  const compactBtn = h(
    "button",
    {
      class: state.compact ? "active" : "",
      title: "Hide empty sections and default-valued fields",
      onClick: () => {
        state.compact = !state.compact;
        renderRoot();
      },
    },
    "Compact"
  );

  const layoutSwitch = renderLayoutSwitch();

  // Section nav buttons: clicking a button scrolls to that section.
  // Active highlight tracks the section currently in the viewport.
  // Hidden sections appear dimmed; clicking re-shows + scrolls.
  const sectionBtns: HTMLButtonElement[] = [];
  for (const sid of ALL_SECTIONS) {
    const isHidden = !state.visibleSections.has(sid);
    const btn = h(
      "button",
      {
        class: "section-nav" + (isHidden ? " hidden-section" : ""),
        title: isHidden ? `Show ${SECTION_TITLES[sid]}` : `Jump to ${SECTION_TITLES[sid]}`,
        dataset: { sid },
        onClick: () => {
          if (!state.visibleSections.has(sid)) {
            state.visibleSections.add(sid);
            applyVisibility();
            syncSectionsMenu();
            syncSectionNavHidden();
          }
          scrollToSection(sid);
        },
      },
      cap(sid)
    ) as HTMLButtonElement;
    sectionBtns.push(btn);
  }

  const sectionsMenu = renderSectionsDropdown();

  const refresh = h(
    "button",
    {
      title: "Re-inspect file",
      onClick: () => vscode.postMessage({ type: "refresh" }),
    },
    "↻ Refresh"
  );

  const openDefault = h(
    "button",
    {
      title: "Open with default editor instead",
      onClick: () => vscode.postMessage({ type: "openWithDefault" }),
    },
    "Open as raw"
  );

  return h(
    "div",
    { class: "toolbar" },
    search,
    h("span", { class: "divider" }),
    compactBtn,
    layoutSwitch,
    h("span", { class: "divider" }),
    ...sectionBtns,
    sectionsMenu,
    h("span", { class: "divider" }),
    refresh,
    openDefault
  );
}

function renderLayoutSwitch(): HTMLElement {
  const wrap = h("div", { class: "layout-switch", role: "group", "aria-label": "Layout" });
  const opt = (mode: LayoutMode, glyph: string, label: string): HTMLButtonElement => {
    const btn = h(
      "button",
      {
        class: "layout-btn" + (state.layout === mode ? " active" : ""),
        title: label,
        "aria-label": label,
        "aria-pressed": state.layout === mode ? "true" : "false",
        dataset: { layoutMode: mode },
        onClick: () => setLayout(mode),
      },
      h("span", { class: "layout-glyph", "aria-hidden": "true" }, glyph)
    ) as HTMLButtonElement;
    return btn;
  };
  wrap.appendChild(opt("viewer",    "◧", "3D viewer only"));
  wrap.appendChild(opt("both",      "◫", "Both panes"));
  wrap.appendChild(opt("inspector", "◨", "Inspector only"));
  return wrap;
}

function refreshLayoutSwitch(): void {
  document.querySelectorAll<HTMLButtonElement>(".layout-btn").forEach((btn) => {
    const mode = btn.dataset.layoutMode as LayoutMode | undefined;
    const active = mode === state.layout;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function scrollToSection(sid: SectionId): void {
  const el = document.querySelector<HTMLElement>(`.section[data-section="${sid}"]`);
  if (!el) return;
  // Expand if collapsed, so the user lands on actual content.
  el.classList.remove("collapsed", "search-empty");
  // Highlight the clicked button immediately and suppress the scroll-driven
  // picker until the smooth-scroll settles (otherwise the highlight briefly
  // tracks the section being scrolled through).
  syncActiveSectionNav(sid);
  suppressScrollPickUntil = performance.now() + 700;
  const pane = document.getElementById("inspector-pane");
  if (pane) {
    // The toolbar+banner are sticky, leave a little headroom.
    const headroom = (pane.querySelector(".toolbar") as HTMLElement | null)?.offsetHeight ?? 0;
    const banner = (pane.querySelector(".banner") as HTMLElement | null)?.offsetHeight ?? 0;
    pane.scrollTo({ top: el.offsetTop - headroom - banner - 8, behavior: "smooth" });
  } else {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderSectionsDropdown(): HTMLElement {
  const wrap = h("div", { class: "dropdown-wrap" });
  const menuBtn = h(
    "button",
    {
      class: "dropdown-btn",
      title: "Show or hide sections",
      onClick: (e: Event) => {
        e.stopPropagation();
        toggleDropdown(menu);
      },
    },
    "Sections ",
    h("span", { class: "caret" }, "▾")
  ) as HTMLButtonElement;

  const menu = h("div", { class: "dropdown-menu dropdown-menu-right", id: "sections-menu" });

  const buildItems = () => {
    menu.innerHTML = "";
    for (const sid of ALL_SECTIONS) {
      const cb = h("input", {
        type: "checkbox",
        checked: state.visibleSections.has(sid),
        onChange: () => {
          if ((cb as HTMLInputElement).checked) state.visibleSections.add(sid);
          else state.visibleSections.delete(sid);
          applyVisibility();
          syncSectionNavHidden();
        },
      }) as HTMLInputElement;
      menu.appendChild(
        h("label", { class: "dropdown-item" },
          cb,
          h("span", { class: "dropdown-label" }, SECTION_TITLES[sid])
        )
      );
    }
    menu.appendChild(h("div", { class: "dropdown-sep" }));
    menu.appendChild(
      h(
        "button",
        {
          class: "dropdown-action",
          onClick: () => {
            for (const sid of ALL_SECTIONS) state.visibleSections.add(sid);
            buildItems();
            applyVisibility();
            syncSectionNavHidden();
          },
        },
        "Show all"
      )
    );
    menu.appendChild(
      h(
        "button",
        {
          class: "dropdown-action",
          onClick: () => {
            state.visibleSections.clear();
            buildItems();
            applyVisibility();
            syncSectionNavHidden();
          },
        },
        "Hide all"
      )
    );
  };
  buildItems();
  // Click anywhere outside closes.
  document.addEventListener("click", () => menu.classList.remove("open"));
  menu.addEventListener("click", (e) => e.stopPropagation());
  wrap.appendChild(menuBtn);
  wrap.appendChild(menu);
  return wrap;
}

function syncSectionsMenu(): void {
  const menu = document.getElementById("sections-menu");
  if (!menu) return;
  const labels = menu.querySelectorAll<HTMLLabelElement>(".dropdown-item");
  labels.forEach((label, i) => {
    const sid = ALL_SECTIONS[i];
    if (!sid) return;
    const cb = label.querySelector("input") as HTMLInputElement | null;
    if (cb) cb.checked = state.visibleSections.has(sid);
  });
}

function syncSectionNavHidden(): void {
  document.querySelectorAll<HTMLButtonElement>(".section-nav[data-sid]").forEach((btn) => {
    const sid = btn.dataset.sid as SectionId | undefined;
    if (!sid) return;
    const hidden = !state.visibleSections.has(sid);
    btn.classList.toggle("hidden-section", hidden);
    btn.title = hidden ? `Show ${SECTION_TITLES[sid]}` : `Jump to ${SECTION_TITLES[sid]}`;
  });
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function applyVisibility(): void {
  for (const sid of ALL_SECTIONS) {
    const el = document.querySelector<HTMLElement>(`.section[data-section="${sid}"]`);
    if (el) el.classList.toggle("hidden", !state.visibleSections.has(sid));
  }
}

// Track which section is currently "in view" and highlight the corresponding
// nav button.
//
// We don't use IntersectionObserver here because "first section that's still
// intersecting the viewport" is the wrong question — when you've scrolled
// halfway through Textures, the previous section (Materials) is often still
// peeking in at the top, which would make Materials win.  The right question
// is: "which section contains the user's reading line?"  We define the
// reading line as a fixed offset just below the sticky toolbar; the active
// section is whichever one straddles it.

let sectionScrollHandler: (() => void) | null = null;
let suppressScrollPickUntil = 0;

function setupSectionObserver(): void {
  const pane = document.getElementById("inspector-pane");
  if (!pane) return;
  if (sectionScrollHandler) {
    pane.removeEventListener("scroll", sectionScrollHandler);
  }
  let raf = 0;
  sectionScrollHandler = () => {
    if (raf !== 0) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (performance.now() < suppressScrollPickUntil) return;
      const sid = pickActiveSection();
      if (sid) syncActiveSectionNav(sid);
    });
  };
  pane.addEventListener("scroll", sectionScrollHandler, { passive: true });
  // Initial pick after layout settles.
  requestAnimationFrame(() => {
    const sid = pickActiveSection();
    if (sid) syncActiveSectionNav(sid);
  });
}

function pickActiveSection(): string | null {
  const pane = document.getElementById("inspector-pane");
  if (!pane) return null;
  const paneRect = pane.getBoundingClientRect();
  // Reading line: just below the sticky toolbar+banner so the section the
  // user is actually reading wins.
  const stickyHeight =
    ((pane.querySelector(".banner") as HTMLElement | null)?.offsetHeight ?? 0) +
    ((pane.querySelector(".toolbar") as HTMLElement | null)?.offsetHeight ?? 0);
  const readingY = paneRect.top + stickyHeight + 12;

  const sections = Array.from(
    pane.querySelectorAll<HTMLElement>(".section:not(.hidden)")
  );
  if (sections.length === 0) return null;

  // Prefer the section that *contains* the reading line.
  for (const sec of sections) {
    const r = sec.getBoundingClientRect();
    if (r.top <= readingY && r.bottom > readingY) {
      return sec.dataset.section ?? null;
    }
  }
  // Fallback A: scrolled above the first section.
  if (sections[0].getBoundingClientRect().top > readingY) {
    return sections[0].dataset.section ?? null;
  }
  // Fallback B: scrolled past the last section.
  return sections[sections.length - 1].dataset.section ?? null;
}

function syncActiveSectionNav(activeSid: string): void {
  document.querySelectorAll<HTMLButtonElement>(".section-nav[data-sid]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.sid === activeSid);
  });
}

// ─── Search ──────────────────────────────────────────────────────────────

function applySearch(): void {
  const term = state.search.toLowerCase();
  const sections = document.querySelectorAll<HTMLElement>(".section");
  if (term.length === 0) {
    sections.forEach((s) => {
      s.classList.remove("search-empty");
      s.querySelectorAll(".match").forEach((el) => el.classList.remove("match"));
    });
    return;
  }
  sections.forEach((section) => {
    let any = false;
    // Tree rows
    section.querySelectorAll<HTMLElement>("li > .row").forEach((row) => {
      const txt = row.textContent?.toLowerCase() ?? "";
      const isMatch = txt.includes(term);
      row.classList.toggle("match", isMatch);
      if (isMatch) {
        any = true;
        // Expand all ancestors so the match is visible.
        let li = row.parentElement;
        while (li) {
          if (li.tagName === "LI") li.classList.remove("collapsed");
          li = li.parentElement;
        }
      }
    });
    // Table rows
    section.querySelectorAll<HTMLTableRowElement>("table.tbl tbody tr").forEach((tr) => {
      const txt = tr.textContent?.toLowerCase() ?? "";
      const isMatch = txt.includes(term);
      tr.classList.toggle("match", isMatch);
      if (isMatch) any = true;
    });
    section.classList.toggle("search-empty", !any);
  });
}

// ─── Section wrappers ────────────────────────────────────────────────────

function sectionWrap(sid: SectionId, body: HTMLElement | HTMLElement[], isEmpty: boolean): HTMLElement {
  const title = h(
    "div",
    { class: "section-title", onClick: () => sec.classList.toggle("collapsed") },
    h("span", { class: "chev" }),
    h("h2", null, SECTION_TITLES[sid]),
    h("span", { class: "rule" })
  );
  const sec = h(
    "section",
    { class: "section" + (isEmpty ? " empty" : ""), dataset: { section: sid } },
    title,
    h(
      "div",
      { class: "section-body" },
      Array.isArray(body) ? body : [body],
      h("div", { class: "search-empty-msg" }, "No matches in this section")
    )
  );
  return sec;
}

function emptyNotice(text: string = "(none)"): HTMLElement {
  return h("div", { class: "section-empty" }, text);
}

// ─── Section dispatcher ──────────────────────────────────────────────────

function renderSection(sid: SectionId, r: InspectionReport): HTMLElement {
  switch (sid) {
    case "overview":   return renderOverview(r);
    case "scene":      return renderScenes(r);
    case "meshes":     return renderMeshes(r);
    case "materials":  return renderMaterials(r);
    case "textures":   return renderTextures(r);
    case "animations": return renderAnimations(r);
    case "skins":      return renderSkins(r);
    case "cameras":    return renderCameras(r);
    case "buffers":    return renderBuffers(r);
    case "extensions": return renderExtensions(r);
  }
}

// ─── 1. Overview ─────────────────────────────────────────────────────────

function renderOverview(r: InspectionReport): HTMLElement {
  const meta = h("div", { class: "overview-meta" });
  const addMeta = (label: string, value: string | null) => {
    meta.appendChild(h("div", { class: "label" }, label));
    if (value) meta.appendChild(h("div", { class: "value" }, value));
    else meta.appendChild(h("div", { class: "none" }, "—"));
  };
  addMeta("File", r.file.name);
  addMeta("Format", r.file.format === "GLB" ? "GLB (Binary)" : "GLTF (JSON)");
  addMeta("Size", humanSize(r.file.size));
  addMeta("glTF Version", r.asset.version);
  addMeta("Generator", r.asset.generator);
  addMeta("Copyright", r.asset.copyright);
  if (r.asset.minVersion || !state.compact) addMeta("Min Version", r.asset.minVersion);

  const grid = h("div", { class: "counts-grid" });
  for (const [name, count] of Object.entries(r.counts)) {
    const padding = "·".repeat(Math.max(0, 14 - name.length));
    grid.appendChild(
      h(
        "div",
        { class: "counts-cell" },
        h("span", { class: "name" }, name),
        h("span", { class: "dots" }, padding),
        h("span", { class: "count" }, fmtNum(count))
      )
    );
  }

  const exts = h("div", { class: "overview-extensions" });
  if (r.extensionsUsed.length > 0) {
    exts.appendChild(h("div", { class: "label" }, "Extensions Used"));
    exts.appendChild(h("div", { class: "value" }, r.extensionsUsed.join(", ")));
  }
  if (r.extensionsRequired.length > 0) {
    exts.appendChild(h("div", { class: "label" }, "Extensions Required"));
    exts.appendChild(h("div", { class: "value" }, r.extensionsRequired.join(", ")));
  }

  const panel = h("div", { class: "overview-panel" }, meta, grid, exts.children.length > 0 ? exts : null);
  return sectionWrap("overview", panel, false);
}

// ─── 2. Scene Graph ──────────────────────────────────────────────────────

function nodeLabel(n: GltfNode, r: InspectionReport): DocumentFragment {
  const f = document.createDocumentFragment();
  f.appendChild(dim("Node "));
  f.appendChild(xref("node", n.index, tk("index", n.index)));
  if (n.name) {
    f.appendChild(dim(': "'));
    f.appendChild(tk("name", n.name));
    f.appendChild(dim('"'));
  }
  if (n.mesh !== null) {
    const mesh = r.meshes[n.mesh];
    f.appendChild(dim(" ⯈ "));
    f.appendChild(refLabel("Mesh", n.mesh, mesh?.name ?? null));
  }
  if (n.camera !== null) {
    f.appendChild(dim(" ◎ "));
    f.appendChild(refLabel("Camera", n.camera, r.cameras[n.camera]?.name ?? null));
  }
  if (n.skin !== null) {
    f.appendChild(dim(" ◈ "));
    f.appendChild(refLabel("Skin", n.skin, r.skins[n.skin]?.name ?? null));
  }
  return f;
}

function transformChildren(n: GltfNode): HTMLLIElement[] {
  const out: HTMLLIElement[] = [];
  if (n.matrix && n.matrix.length === 16 && !isIdentityMatrix(n.matrix)) {
    out.push(treeNode([dim("⊞ matrix "), tk("value", fmtMatrix(n.matrix))]));
    return out;
  }
  if (n.translation && n.translation.length === 3 && n.translation.some((v) => Math.abs(v) > 1e-6)) {
    out.push(treeNode([dim("↹ translation "), tk("value", fmtVector(n.translation))]));
  }
  if (
    n.rotation &&
    n.rotation.length === 4 &&
    !(
      Math.abs(n.rotation[0]) < 1e-6 &&
      Math.abs(n.rotation[1]) < 1e-6 &&
      Math.abs(n.rotation[2]) < 1e-6 &&
      Math.abs(n.rotation[3] - 1.0) < 1e-6
    )
  ) {
    out.push(treeNode([dim("↻ rotation    "), tk("value", fmtVector(n.rotation))]));
  }
  if (n.scale && n.scale.length === 3 && n.scale.some((v) => Math.abs(v - 1.0) > 1e-6)) {
    out.push(treeNode([dim("⇔ scale       "), tk("value", fmtVector(n.scale))]));
  }
  return out;
}

function buildNodeSubtree(idx: number, r: InspectionReport, visited: Set<number>): HTMLLIElement {
  const node = r.nodes[idx];
  if (!node) {
    return treeNode([dim("Node "), tk("index", idx), tk("warn", " (missing)")]);
  }
  if (visited.has(idx)) {
    return treeNode([dim("Node "), tk("index", idx), tk("warn", " (cycle)")]);
  }
  visited.add(idx);
  const children: HTMLLIElement[] = [...transformChildren(node)];
  for (const c of node.children) {
    children.push(buildNodeSubtree(c, r, visited));
  }
  visited.delete(idx);
  return treeNode(nodeLabel(node, r), children, { id: refId("node", idx) });
}

function renderScenes(r: InspectionReport): HTMLElement {
  const isEmpty = r.scenes.length === 0;
  if (state.compact && isEmpty) return sectionWrap("scene", h("div"), true);
  if (isEmpty) return sectionWrap("scene", emptyNotice("(no scenes)"), true);

  const trees: HTMLElement[] = [];
  for (const scene of r.scenes) {
    const label = document.createDocumentFragment();
    label.appendChild(dim("Scene "));
    label.appendChild(tk("index", scene.index));
    if (scene.name) {
      label.appendChild(dim(': "'));
      label.appendChild(tk("name", scene.name));
      label.appendChild(dim('"'));
    }
    if (scene.isDefault) label.appendChild(tk("keyword", " ★ default"));

    const visited = new Set<number>();
    const children = scene.rootNodeIndices.map((i) => buildNodeSubtree(i, r, visited));
    trees.push(makeTree(label, children));
  }
  return sectionWrap("scene", trees, false);
}

// ─── 3. Meshes ───────────────────────────────────────────────────────────

function accessorSummary(r: InspectionReport, accIdx: number | null, showRange = false): DocumentFragment {
  const f = document.createDocumentFragment();
  if (accIdx === null) {
    f.appendChild(none());
    return f;
  }
  const acc = r.accessors[accIdx];
  if (!acc) {
    f.appendChild(dim("Accessor "));
    f.appendChild(xref("accessor", accIdx, tk("index", accIdx)));
    f.appendChild(tk("warn", " (missing)"));
    return f;
  }
  f.appendChild(dim("Accessor "));
  f.appendChild(xref("accessor", accIdx, tk("index", accIdx)));
  f.appendChild(dim("  "));
  f.appendChild(tk("type", acc.type ?? "?"));
  f.appendChild(dim(" × "));
  f.appendChild(tk("type", acc.componentTypeName));
  if (showRange && (acc.min !== null || acc.max !== null)) {
    f.appendChild(dim("  "));
    f.appendChild(tk("value", fmtRange(acc.min, acc.max)));
  }
  return f;
}

function primitiveSubtree(prim: PrimitiveInfo, r: InspectionReport): HTMLLIElement {
  const label = document.createDocumentFragment();
  label.appendChild(dim(`Primitive ${prim.index}`));
  label.appendChild(dim(" ▸ "));
  label.appendChild(tk("type", prim.modeName));
  if (prim.material !== null) {
    label.appendChild(dim(" ▸ "));
    label.appendChild(refLabel("Material", prim.material, r.materials[prim.material]?.name ?? null));
  }
  if (prim.vertexCount !== null) {
    label.appendChild(dim(" ▸ "));
    label.appendChild(tk("value", `${fmtNum(prim.vertexCount)} vertices`));
  }
  if (prim.triangleCount > 0) {
    label.appendChild(dim(" ▸ "));
    label.appendChild(tk("value", `${fmtNum(prim.triangleCount)} triangles`));
  }

  const children: HTMLLIElement[] = [];
  for (const a of prim.attributes) {
    const showRange = a.name === "POSITION";
    const row = document.createDocumentFragment();
    row.appendChild(h("span", { class: "tk-attr" }, a.name));
    row.appendChild(accessorSummary(r, a.accessor, showRange));
    children.push(treeNode(row));
  }
  if (prim.indices !== null) {
    const acc = r.accessors[prim.indices];
    const row = document.createDocumentFragment();
    row.appendChild(h("span", { class: "tk-attr" }, "Indices"));
    row.appendChild(accessorSummary(r, prim.indices));
    if (acc) {
      row.appendChild(tk("value", `  ${fmtNum(acc.count)} indices`));
    }
    children.push(treeNode(row));
  }
  if (prim.morphTargets.length > 0) {
    const targetChildren: HTMLLIElement[] = [];
    prim.morphTargets.forEach((target, ti) => {
      const tn: HTMLLIElement[] = target.map((a) => {
        const row = document.createDocumentFragment();
        row.appendChild(h("span", { class: "tk-attr" }, a.name));
        row.appendChild(accessorSummary(r, a.accessor));
        return treeNode(row);
      });
      targetChildren.push(treeNode([dim(`Target ${ti}`)], tn));
    });
    children.push(treeNode([dim(`Morph Targets: ${prim.morphTargets.length}`)], targetChildren));
  } else if (!state.compact) {
    children.push(treeNode([dim("Morph Targets: (none)")]));
  }
  if (prim.extensions) {
    children.push(extensionDictNode("extensions", prim.extensions));
  }
  return treeNode(label, children);
}

function meshTree(mesh: MeshInfo, r: InspectionReport): HTMLUListElement {
  const label = document.createDocumentFragment();
  label.appendChild(dim("Mesh "));
  label.appendChild(tk("index", mesh.index));
  if (mesh.name) {
    label.appendChild(dim(': "'));
    label.appendChild(tk("name", mesh.name));
    label.appendChild(dim('"'));
  }
  if (mesh.totalTriangles > 0 && mesh.primitives.length > 1) {
    label.appendChild(dim(" ▸ "));
    label.appendChild(tk("value", `${fmtNum(mesh.totalTriangles)} triangles total`));
  }

  const children: HTMLLIElement[] = mesh.primitives.map((p) => primitiveSubtree(p, r));
  if (mesh.weights && mesh.weights.length > 0) {
    children.push(propRow("Weights", fmtVector(mesh.weights)));
  }
  if (mesh.extensions) {
    children.push(extensionDictNode("extensions", mesh.extensions));
  }
  return makeTree(label, children, { id: refId("mesh", mesh.index) } as TreeNodeOptions);
}

function renderMeshes(r: InspectionReport): HTMLElement {
  const isEmpty = r.meshes.length === 0;
  if (state.compact && isEmpty) return sectionWrap("meshes", h("div"), true);
  if (isEmpty) return sectionWrap("meshes", emptyNotice(), true);
  return sectionWrap(
    "meshes",
    r.meshes.map((m) => meshTree(m, r)),
    false
  );
}

// ─── 4. Materials ────────────────────────────────────────────────────────

function propRow(label: string, value: string | Node | null): HTMLLIElement {
  const row = document.createDocumentFragment();
  row.appendChild(h("span", { class: "label-pad" }, label));
  if (value === null || value === "" || value === "—") {
    row.appendChild(none());
  } else if (typeof value === "string") {
    row.appendChild(tk("value", value));
  } else {
    row.appendChild(value);
  }
  return treeNode(row);
}

function textureRefRow(label: string, ref: TextureRef | null, extra?: { scale?: number; strength?: number }): HTMLLIElement {
  const row = document.createDocumentFragment();
  row.appendChild(h("span", { class: "label-pad" }, label));
  if (!ref) {
    row.appendChild(none());
    return treeNode(row);
  }
  row.appendChild(dim("Texture "));
  row.appendChild(xref("texture", ref.index, tk("index", ref.index)));
  if (ref.texCoord !== null && ref.texCoord !== 0) {
    row.appendChild(dim(` (texCoord: ${ref.texCoord})`));
  }
  if (extra) {
    if (extra.scale !== undefined && (ref as any).scale !== undefined) {
      row.appendChild(dim(` (scale: ${(ref as any).scale})`));
    }
    if (extra.strength !== undefined && (ref as any).strength !== undefined) {
      row.appendChild(dim(` (strength: ${(ref as any).strength})`));
    }
  }
  return treeNode(row);
}

function materialTree(mat: MaterialInfo): HTMLUListElement {
  const label = document.createDocumentFragment();
  label.appendChild(dim("Material "));
  label.appendChild(tk("index", mat.index));
  if (mat.name) {
    label.appendChild(dim(': "'));
    label.appendChild(tk("name", mat.name));
    label.appendChild(dim('"'));
  }

  const children: HTMLLIElement[] = [];
  const alpha = mat.alphaMode ?? "OPAQUE";
  children.push(propRow("Alpha Mode", tk("type", alpha)));
  if (alpha === "MASK") {
    children.push(propRow("Alpha Cutoff", String(mat.alphaCutoff ?? 0.5)));
  }
  children.push(propRow("Double Sided", mat.doubleSided ? "yes" : "no"));

  if (mat.pbr) {
    const pbrChildren: HTMLLIElement[] = [];
    pbrChildren.push(propRow("Base Color Factor", fmtVector(mat.pbr.baseColorFactor)));
    pbrChildren.push(textureRefRow("Base Color Texture", mat.pbr.baseColorTexture));
    pbrChildren.push(propRow("Metallic Factor", String(mat.pbr.metallicFactor ?? 1.0)));
    pbrChildren.push(propRow("Roughness Factor", String(mat.pbr.roughnessFactor ?? 1.0)));
    pbrChildren.push(textureRefRow("Metal/Rough Texture", mat.pbr.metallicRoughnessTexture));
    children.push(treeNode([tk("keyword", "PBR Metallic-Roughness")], pbrChildren));
  }

  children.push(textureRefRow("Normal Texture", mat.normalTexture, { scale: 1 }));
  children.push(textureRefRow("Occlusion Texture", mat.occlusionTexture, { strength: 1 }));
  children.push(propRow("Emissive Factor", fmtVector(mat.emissiveFactor)));
  children.push(textureRefRow("Emissive Texture", mat.emissiveTexture));

  if (mat.extensions) {
    children.push(extensionDictNode("extensions", mat.extensions));
  }
  return makeTree(label, children, { id: refId("material", mat.index) });
}

function renderMaterials(r: InspectionReport): HTMLElement {
  const isEmpty = r.materials.length === 0;
  if (state.compact && isEmpty) return sectionWrap("materials", h("div"), true);
  if (isEmpty) return sectionWrap("materials", emptyNotice(), true);
  return sectionWrap(
    "materials",
    r.materials.map((m) => materialTree(m)),
    false
  );
}

// ─── 5. Textures, Samplers & Images ─────────────────────────────────────

function thumb(img: ImageInfo): HTMLElement {
  if (!img.thumbnailDataUrl) return h("span", { class: "tk-dim" }, "—");
  const el = h("img", {
    class: "thumb",
    src: img.thumbnailDataUrl,
    alt: img.name ?? `image ${img.index}`,
    title: "Click to enlarge",
    onClick: () => openLightbox(img),
  }) as HTMLImageElement;
  return el;
}

function openLightbox(img: ImageInfo): void {
  let dlg = document.getElementById("ts-lightbox") as HTMLDialogElement | null;
  if (!dlg) {
    dlg = h("dialog", { id: "ts-lightbox", class: "lightbox" }) as HTMLDialogElement;
    document.body.appendChild(dlg);
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg!.close();
    });
  }
  dlg.innerHTML = "";
  const meta: string[] = [];
  if (img.resolution) meta.push(`${img.resolution.width}×${img.resolution.height}`);
  if (img.mimeType) meta.push(img.mimeType);
  meta.push(`Image ${img.index}` + (img.name ? ` "${img.name}"` : ""));
  dlg.appendChild(h("img", { src: img.thumbnailDataUrl ?? "" }));
  dlg.appendChild(h("div", { class: "meta" }, meta.join("  ·  ")));
  dlg.showModal();
}

function texturesTable(r: InspectionReport): HTMLElement {
  const tbl = h("table", { class: "tbl" });
  tbl.appendChild(h("caption", null, "Textures"));
  const thead = h("thead", null,
    h("tr", null,
      h("th", { class: "right" }, "Texture"),
      h("th", null, "Name"),
      h("th", { class: "right" }, "Sampler"),
      h("th", { class: "right" }, "Image"),
      h("th", null, "Preview")));
  tbl.appendChild(thead);
  const tbody = h("tbody");
  r.textures.forEach((t) => {
    const tr = h("tr", { class: "row-hover", id: refId("texture", t.index) });
    tr.appendChild(h("td", { class: "right" }, tk("index", t.index)));
    tr.appendChild(h("td", null, t.name ? tk("name", t.name) : none()));
    tr.appendChild(
      h(
        "td",
        { class: "right" },
        t.sampler !== null ? xref("sampler", t.sampler, tk("index", t.sampler)) : none()
      )
    );
    tr.appendChild(
      h(
        "td",
        { class: "right" },
        t.source !== null ? xref("image", t.source, tk("index", t.source)) : none()
      )
    );
    const previewCell = h("td");
    if (t.source !== null && r.images[t.source]?.thumbnailDataUrl) {
      previewCell.appendChild(thumb(r.images[t.source]));
    } else previewCell.appendChild(dim("—"));
    tr.appendChild(previewCell);
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  return h("div", { class: "tbl-wrap" }, tbl);
}

function samplersTable(samplers: SamplerInfo[]): HTMLElement {
  const tbl = h("table", { class: "tbl" });
  tbl.appendChild(h("caption", null, "Samplers"));
  tbl.appendChild(h("thead", null,
    h("tr", null,
      h("th", { class: "right" }, "Sampler"),
      h("th", null, "Mag Filter"),
      h("th", null, "Min Filter"),
      h("th", null, "Wrap S"),
      h("th", null, "Wrap T"))));
  const tbody = h("tbody");
  samplers.forEach((s) => {
    const tr = h("tr", { id: refId("sampler", s.index) });
    tr.appendChild(h("td", { class: "right" }, tk("index", s.index)));
    tr.appendChild(h("td", null, s.magFilterName ? tk("type", s.magFilterName) : dim("—")));
    tr.appendChild(h("td", null, s.minFilterName ? tk("type", s.minFilterName) : dim("—")));
    tr.appendChild(h("td", null, tk("type", s.wrapSName)));
    tr.appendChild(h("td", null, tk("type", s.wrapTName)));
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  return h("div", { class: "tbl-wrap" }, tbl);
}

function imagesTable(images: ImageInfo[]): HTMLElement {
  const tbl = h("table", { class: "tbl" });
  tbl.appendChild(h("caption", null, "Images"));
  tbl.appendChild(h("thead", null,
    h("tr", null,
      h("th", { class: "right" }, "Image"),
      h("th", null, "Preview"),
      h("th", null, "Name"),
      h("th", { class: "right" }, "Resolution"),
      h("th", null, "MIME Type"),
      h("th", null, "Source"))));
  const tbody = h("tbody");
  images.forEach((img) => {
    const tr = h("tr", { id: refId("image", img.index) });
    tr.appendChild(h("td", { class: "right" }, tk("index", img.index)));
    tr.appendChild(h("td", null, h("div", { class: "thumb-row" }, thumb(img))));
    tr.appendChild(h("td", null, img.name ? tk("name", img.name) : none()));
    tr.appendChild(
      h("td", { class: "right" },
        img.resolution ? `${img.resolution.width}×${img.resolution.height}` : dim("—"))
    );
    tr.appendChild(h("td", null, img.mimeType ? tk("type", img.mimeType) : dim("—")));
    let source: Node;
    if (img.bufferView !== null) {
      const f = document.createDocumentFragment();
      f.appendChild(dim("BufferView "));
      f.appendChild(xref("bufferview", img.bufferView, tk("index", img.bufferView)));
      if (img.bufferViewByteLength !== null) f.appendChild(dim(` (${humanSize(img.bufferViewByteLength)})`));
      source = f;
    } else if (img.uriIsDataUrl && img.uriDataLength !== null) {
      source = document.createTextNode(`Data URI (${humanSize(img.uriDataLength)})`);
    } else if (img.uri) {
      source = document.createTextNode(img.uri);
    } else {
      source = dim("—");
    }
    tr.appendChild(h("td", null, source));
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  return h("div", { class: "tbl-wrap" }, tbl);
}

function renderTextures(r: InspectionReport): HTMLElement {
  const isEmpty = r.textures.length === 0 && r.samplers.length === 0 && r.images.length === 0;
  if (state.compact && isEmpty) return sectionWrap("textures", h("div"), true);
  if (isEmpty) return sectionWrap("textures", emptyNotice(), true);
  const parts: HTMLElement[] = [];
  if (r.textures.length) parts.push(texturesTable(r));
  if (r.samplers.length) parts.push(samplersTable(r.samplers));
  if (r.images.length) parts.push(imagesTable(r.images));
  return sectionWrap("textures", parts, false);
}

// ─── 6. Animations ───────────────────────────────────────────────────────

function animationTree(anim: AnimationInfo, r: InspectionReport): HTMLUListElement {
  const label = document.createDocumentFragment();
  label.appendChild(dim("Animation "));
  label.appendChild(tk("index", anim.index));
  if (anim.name) {
    label.appendChild(dim(': "'));
    label.appendChild(tk("name", anim.name));
    label.appendChild(dim('"'));
  }
  if (anim.duration !== null) {
    label.appendChild(dim(" ▸ "));
    label.appendChild(tk("value", `~${anim.duration.toFixed(2)}s`));
  }

  const children: HTMLLIElement[] = anim.channels.map((ch) => {
    const chLabel = document.createDocumentFragment();
    chLabel.appendChild(dim(`Channel ${ch.index}`));
    chLabel.appendChild(dim(" → "));
    if (ch.targetNode !== null) {
      chLabel.appendChild(refLabel("Node", ch.targetNode, r.nodes[ch.targetNode]?.name ?? null));
    } else {
      chLabel.appendChild(dim("(no target)"));
    }
    chLabel.appendChild(dim(" / "));
    chLabel.appendChild(tk("keyword", ch.targetPath ?? "?"));

    const samplerLabel = document.createDocumentFragment();
    samplerLabel.appendChild(dim(`Sampler ${ch.samplerIndex}: `));
    samplerLabel.appendChild(tk("type", ch.interpolation));
    if (ch.keyframeCount !== null) {
      samplerLabel.appendChild(tk("value", `, ${fmtNum(ch.keyframeCount)} keyframes`));
    }
    if (ch.inputAccessor !== null) {
      samplerLabel.appendChild(dim(", input: "));
      samplerLabel.appendChild(xref("accessor", ch.inputAccessor, tk("index", ch.inputAccessor)));
    }
    if (ch.outputAccessor !== null) {
      samplerLabel.appendChild(dim(", output: "));
      samplerLabel.appendChild(xref("accessor", ch.outputAccessor, tk("index", ch.outputAccessor)));
    }

    return treeNode(chLabel, [treeNode(samplerLabel)]);
  });

  return makeTree(label, children, { id: refId("animation", anim.index) });
}

function renderAnimations(r: InspectionReport): HTMLElement {
  const isEmpty = r.animations.length === 0;
  if (state.compact && isEmpty) return sectionWrap("animations", h("div"), true);
  if (isEmpty) return sectionWrap("animations", emptyNotice(), true);
  return sectionWrap("animations", r.animations.map((a) => animationTree(a, r)), false);
}

// ─── 7. Skins ────────────────────────────────────────────────────────────

function skinTree(skin: SkinInfo): HTMLUListElement {
  const label = document.createDocumentFragment();
  label.appendChild(dim("Skin "));
  label.appendChild(tk("index", skin.index));
  if (skin.name) {
    label.appendChild(dim(': "'));
    label.appendChild(tk("name", skin.name));
    label.appendChild(dim('"'));
  }
  const children: HTMLLIElement[] = [];
  if (skin.skeleton !== null) {
    const row = document.createDocumentFragment();
    row.appendChild(h("span", { class: "label-pad" }, "Skeleton Root"));
    row.appendChild(refLabel("Node", skin.skeleton, skin.skeletonName));
    children.push(treeNode(row));
  }
  if (skin.inverseBindMatrices !== null) {
    const row = document.createDocumentFragment();
    row.appendChild(h("span", { class: "label-pad" }, "Inv. Bind Matrices"));
    row.appendChild(dim("Accessor "));
    row.appendChild(xref("accessor", skin.inverseBindMatrices, tk("index", skin.inverseBindMatrices)));
    children.push(treeNode(row));
  }
  const jointChildren: HTMLLIElement[] = skin.joints.map((j) => {
    const r = document.createDocumentFragment();
    r.appendChild(refLabel("Node", j.index, j.name));
    return treeNode(r);
  });
  children.push(treeNode([tk("keyword", `Joints (${skin.joints.length})`)], jointChildren));
  return makeTree(label, children, { id: refId("skin", skin.index) });
}

function renderSkins(r: InspectionReport): HTMLElement {
  const isEmpty = r.skins.length === 0;
  if (state.compact && isEmpty) return sectionWrap("skins", h("div"), true);
  if (isEmpty) return sectionWrap("skins", emptyNotice(), true);
  return sectionWrap("skins", r.skins.map((s) => skinTree(s)), false);
}

// ─── 8. Cameras ──────────────────────────────────────────────────────────

function cameraTree(cam: CameraInfo): HTMLUListElement {
  const label = document.createDocumentFragment();
  label.appendChild(dim("Camera "));
  label.appendChild(tk("index", cam.index));
  if (cam.name) {
    label.appendChild(dim(': "'));
    label.appendChild(tk("name", cam.name));
    label.appendChild(dim('"'));
  }
  label.appendChild(dim(" ("));
  label.appendChild(tk("type", cam.type ?? "?"));
  label.appendChild(dim(")"));

  const children: HTMLLIElement[] = [];
  if (cam.type === "perspective" && cam.perspective) {
    const p = cam.perspective;
    if (p.yfov !== null) {
      const deg = (p.yfov * 180) / Math.PI;
      children.push(propRow("Y-FOV", `${p.yfov.toFixed(4)} rad (${deg.toFixed(1)}°)`));
    }
    children.push(propRow("Aspect Ratio", p.aspectRatio === null ? null : String(p.aspectRatio)));
    children.push(propRow("Z-Near", p.znear === null ? null : String(p.znear)));
    children.push(propRow("Z-Far", p.zfar === null ? null : String(p.zfar)));
  } else if (cam.type === "orthographic" && cam.orthographic) {
    const o = cam.orthographic;
    children.push(propRow("X-Mag", o.xmag === null ? null : String(o.xmag)));
    children.push(propRow("Y-Mag", o.ymag === null ? null : String(o.ymag)));
    children.push(propRow("Z-Near", o.znear === null ? null : String(o.znear)));
    children.push(propRow("Z-Far", o.zfar === null ? null : String(o.zfar)));
  }
  return makeTree(label, children, { id: refId("camera", cam.index) });
}

function renderCameras(r: InspectionReport): HTMLElement {
  const isEmpty = r.cameras.length === 0;
  if (state.compact && isEmpty) return sectionWrap("cameras", h("div"), true);
  if (isEmpty) return sectionWrap("cameras", emptyNotice(), true);
  return sectionWrap("cameras", r.cameras.map((c) => cameraTree(c)), false);
}

// ─── 9. Buffers / BufferViews / Accessors ───────────────────────────────

function buffersTable(buffers: BufferInfo[]): HTMLElement {
  const tbl = h("table", { class: "tbl" });
  tbl.appendChild(h("caption", null, "Buffers"));
  tbl.appendChild(h("thead", null,
    h("tr", null,
      h("th", { class: "right" }, "Buffer"),
      h("th", { class: "right" }, "Size"),
      h("th", null, "URI"))));
  const tbody = h("tbody");
  buffers.forEach((b) => {
    const tr = h("tr", { id: refId("buffer", b.index) });
    tr.appendChild(h("td", { class: "right" }, tk("index", b.index)));
    tr.appendChild(h("td", { class: "right" }, humanSize(b.byteLength)));
    let uriCell: Node;
    if (b.uri === null) uriCell = dim("(embedded GLB blob)");
    else if (b.uriIsDataUrl && b.uriDataLength !== null) uriCell = document.createTextNode(`Data URI (${humanSize(b.uriDataLength)})`);
    else uriCell = document.createTextNode(b.uri);
    tr.appendChild(h("td", null, uriCell));
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  return h("div", { class: "tbl-wrap" }, tbl);
}

function bufferViewsTable(views: BufferViewInfo[]): HTMLElement {
  const tbl = h("table", { class: "tbl" });
  tbl.appendChild(h("caption", null, "Buffer Views"));
  tbl.appendChild(h("thead", null,
    h("tr", null,
      h("th", { class: "right" }, "View"),
      h("th", { class: "right" }, "Buffer"),
      h("th", { class: "right" }, "Offset"),
      h("th", { class: "right" }, "Length"),
      h("th", { class: "right" }, "Stride"),
      h("th", null, "Target"))));
  const tbody = h("tbody");
  views.forEach((bv) => {
    const tr = h("tr", { id: refId("bufferview", bv.index) });
    tr.appendChild(h("td", { class: "right" }, tk("index", bv.index)));
    tr.appendChild(h("td", { class: "right" }, xref("buffer", bv.buffer, tk("index", bv.buffer))));
    tr.appendChild(h("td", { class: "right" }, fmtNum(bv.byteOffset)));
    tr.appendChild(h("td", { class: "right" }, humanSize(bv.byteLength)));
    tr.appendChild(h("td", { class: "right" }, bv.byteStride !== null ? String(bv.byteStride) : dim("—")));
    tr.appendChild(h("td", null, bv.targetName ? tk("type", bv.targetName) : dim("—")));
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  return h("div", { class: "tbl-wrap" }, tbl);
}

function accessorsTable(accessors: AccessorInfo[]): HTMLElement {
  const tbl = h("table", { class: "tbl" });
  tbl.appendChild(h("caption", null, "Accessors"));
  tbl.appendChild(h("thead", null,
    h("tr", null,
      h("th", { class: "right" }, "Acc"),
      h("th", { class: "right" }, "View"),
      h("th", { class: "right" }, "Offset"),
      h("th", null, "Type"),
      h("th", null, "Component"),
      h("th", { class: "right" }, "Count"),
      h("th", null, "Range"),
      h("th", { class: "center" }, "Nrm"))));
  const tbody = h("tbody");
  accessors.forEach((a) => {
    const tr = h("tr", { id: refId("accessor", a.index) });
    tr.appendChild(h("td", { class: "right" }, tk("index", a.index)));
    tr.appendChild(h("td", { class: "right" },
      a.bufferView !== null ? xref("bufferview", a.bufferView, tk("index", a.bufferView)) : dim("—")));
    tr.appendChild(h("td", { class: "right" }, fmtNum(a.byteOffset)));
    tr.appendChild(h("td", null, tk("type", a.type ?? "?")));
    tr.appendChild(h("td", null, tk("type", a.componentTypeName)));
    tr.appendChild(h("td", { class: "right" }, fmtNum(a.count) + (a.sparse ? " ⚡" : "")));
    tr.appendChild(h("td", null, fmtRange(a.min, a.max)));
    tr.appendChild(h("td", { class: "center" }, a.normalized ? "✓" : dim("—")));
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  return h("div", { class: "tbl-wrap" }, tbl);
}

function renderBuffers(r: InspectionReport): HTMLElement {
  const isEmpty =
    r.buffers.length === 0 && r.bufferViews.length === 0 && r.accessors.length === 0;
  if (state.compact && isEmpty) return sectionWrap("buffers", h("div"), true);
  const parts: HTMLElement[] = [];
  if (r.buffers.length) parts.push(buffersTable(r.buffers));
  if (r.bufferViews.length) parts.push(bufferViewsTable(r.bufferViews));
  if (r.accessors.length) parts.push(accessorsTable(r.accessors));
  if (!parts.length) return sectionWrap("buffers", emptyNotice(), true);
  return sectionWrap("buffers", parts, false);
}

// ─── 10. Extensions ─────────────────────────────────────────────────────

function extensionDictNode(label: string, ext: unknown): HTMLLIElement {
  const labelFrag = document.createDocumentFragment();
  labelFrag.appendChild(tk("keyword", label));
  return treeNode(labelFrag, extensionValueChildren(ext));
}

function extensionValueChildren(value: unknown): HTMLLIElement[] {
  if (value === null || value === undefined) {
    return [treeNode([none()])];
  }
  if (typeof value !== "object") {
    return [treeNode([tk("value", String(value))])];
  }
  if (Array.isArray(value)) {
    if (value.length <= 8 && value.every((v) => v === null || (typeof v !== "object"))) {
      return [treeNode([tk("value", JSON.stringify(value))])];
    }
    return value.slice(0, 64).map((item, i) => {
      if (item !== null && typeof item === "object") {
        return treeNode([tk("index", `[${i}]`)], extensionValueChildren(item));
      }
      return treeNode([tk("index", `[${i}]`), document.createTextNode(" "), tk("value", JSON.stringify(item))]);
    });
  }
  const out: HTMLLIElement[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== null && typeof v === "object") {
      const sub = h("span");
      sub.appendChild(tk("keyword", k));
      out.push(treeNode([sub], extensionValueChildren(v)));
    } else {
      const row = document.createDocumentFragment();
      row.appendChild(tk("keyword", `${k}: `));
      row.appendChild(tk("value", v === null || v === undefined ? "—" : String(v)));
      out.push(treeNode(row));
    }
  }
  return out;
}

function extensionEntryTree(entry: ExtensionEntry): HTMLLIElement {
  const label = document.createDocumentFragment();
  label.appendChild(tk("index", entry.location));
  if (entry.name) {
    label.appendChild(dim(' "'));
    label.appendChild(tk("name", entry.name));
    label.appendChild(dim('"'));
  }
  return treeNode(label, extensionValueChildren(entry.data));
}

function renderExtensions(r: InspectionReport): HTMLElement {
  const isEmpty =
    r.extensionsUsed.length === 0 &&
    r.extensionsRequired.length === 0 &&
    r.extensions.length === 0 &&
    !r.topLevelExtensions;
  if (state.compact && isEmpty) return sectionWrap("extensions", h("div"), true);
  if (isEmpty) return sectionWrap("extensions", emptyNotice("(no extensions)"), true);

  const root: HTMLLIElement[] = [];
  if (r.extensionsUsed.length) {
    const row = document.createDocumentFragment();
    row.appendChild(h("span", { class: "label-pad" }, "Used:"));
    row.appendChild(tk("type", r.extensionsUsed.join(", ")));
    root.push(treeNode(row));
  }
  if (r.extensionsRequired.length) {
    const row = document.createDocumentFragment();
    row.appendChild(h("span", { class: "label-pad" }, "Required:"));
    row.appendChild(tk("type", r.extensionsRequired.join(", ")));
    root.push(treeNode(row));
  }
  if (r.topLevelExtensions) {
    root.push(extensionDictNode("Root (top-level)", r.topLevelExtensions));
  }
  if (r.extensions.length) {
    root.push(treeNode([tk("keyword", "Extension Data Found:")], r.extensions.map(extensionEntryTree)));
  }
  return sectionWrap("extensions", makeTree([tk("keyword", "Extensions")], root), false);
}

// ─── Wire up to extension host ───────────────────────────────────────────

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "init") {
    const isReload = state.initPayload && state.initPayload.fileUri !== msg.fileUri;
    state.initPayload = {
      fileUri: msg.fileUri,
      libBaseUri: msg.libBaseUri,
      docBaseUri: msg.docBaseUri,
      fileName: msg.fileName ?? "",
      fileSize: typeof msg.fileSize === "number" ? msg.fileSize : 0,
      autoLoad3D: msg.autoLoad3D !== false,
    };
    renderRoot();
    if (isReload && state.viewer) {
      state.viewer.loadFromUri(msg.fileUri).catch((err) => console.error(err));
    }
  } else if (msg.type === "status") {
    if (msg.phase === "inspecting") state.inspectorPhase = "inspecting";
    if (!state.report) renderRoot();
  } else if (msg.type === "report") {
    state.inspectorPhase = "ready";
    state.report = msg.report as InspectionReport;
    renderRoot();
  } else if (msg.type === "error") {
    state.inspectorPhase = "error";
    state.errorMessage = String(msg.message ?? "");
    renderRoot();
  }
});

vscode.postMessage({ type: "ready" });
