// js/app.js — Book view. Navigation + rendering; all formulas/labels/colors
// come from js/model.js (which reads schema.json + weights.json).
import * as M from "./model.js";

const el = {
  book: document.getElementById("book"),
  date: document.getElementById("date"),
  condition: document.getElementById("condition"),
  activity: document.getElementById("activity"),
  highlights: document.getElementById("highlights"),
  perma: document.getElementById("perma"),
  euScore: document.getElementById("euScore"),
  euTerms: document.getElementById("euTerms"),
  prev: document.getElementById("prevBtn"),
  next: document.getElementById("nextBtn"),
  infoBtn: document.getElementById("infoBtn"),
  modal: document.getElementById("formulaModal"),
  modalClose: document.getElementById("modalClose"),
  modalTitle: document.getElementById("modalTitle"),
  formulaBody: document.getElementById("formulaBody"),
};

const SCAN_LIMIT = 366; // stop after ~1 year of empty days in one direction
let currentYmd = null;

// ---- Date formatting ------------------------------------------------------
function formatDate(ymd) {
  const pad = (n) => String(n).padStart(2, "0");
  const d = M.ymdToDate(ymd);
  const dow = d.toLocaleDateString("en-US", { weekday: "short" });
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} (${dow})`;
}

// Walk day-by-day from `fromYmd` in `step` direction until a file is found.
async function findEntry(fromYmd, step, { inclusive = false } = {}) {
  let ymd = inclusive ? fromYmd : M.shiftYmd(fromYmd, step);
  const today = M.todayYmd();
  for (let i = 0; i < SCAN_LIMIT; i++) {
    if (step > 0 && ymd > today) return null; // never navigate into the future
    const data = await M.loadEntry(ymd);
    if (data) return { ymd, data };
    ymd = M.shiftYmd(ymd, step);
  }
  return null;
}

// ---- Activity timeline (left page) ----------------------------------------
// Block heights are faithful to real duration: flex-grow ∝ minutes, flex-basis
// 0, and no minimum floor, so a 4h block is exactly 4× a 1h block. Blocks too
// short to show their label/time have that text dropped (see fitActivityLabels)
// — the height stays truthful either way.
function renderActivity(activity = []) {
  el.activity.innerHTML = "";
  const blocks = M.parseBlocks(activity);
  let startLabel = "0:00";

  blocks.forEach((b) => {
    const mins = b.endMin - b.startMin;
    const li = document.createElement("li");
    li.className = "slot";
    li.dataset.min = String(mins);
    li.style.flex = `${mins} 1 0`; // grow ∝ duration, basis 0
    li.style.setProperty("--slot-color", M.colorFor(b.label));
    // Blocks of 30 min or less hide their label (set now to avoid a flash).
    if (mins <= 30) li.classList.add("slot--tiny");

    const time = document.createElement("span");
    time.className = "slot-time";
    time.textContent = startLabel;

    const block = document.createElement("span");
    block.className = "slot-block";
    const valTag = b.value != null && (b.label === "Work" || b.label === "Code")
      ? ` · ${b.value}` : "";
    block.textContent = (b.label ?? "") + valTag;

    li.append(time, block);
    el.activity.appendChild(li);

    const endH = Math.floor(b.endMin / 60);
    const endM = b.endMin % 60;
    startLabel = `${endH}:${String(endM).padStart(2, "0")}`;
  });

  requestAnimationFrame(fitActivityLabels);
}

// Hide a block's label + start-time when it is too short to carry them:
// duration ≤ 30 min (explicit rule), or the text simply doesn't fit the block's
// height. Faithful heights are never altered — only the text is dropped.
function fitActivityLabels() {
  el.activity.querySelectorAll(".slot").forEach((li) => {
    const block = li.querySelector(".slot-block");
    const mins = Number(li.dataset.min || 0);
    const tooShort = mins <= 30 || (block && block.clientHeight < block.scrollHeight - 1);
    li.classList.toggle("slot--tiny", !!tooShort);
  });
}

// ---- Highlights (right page, top-left) ------------------------------------
// Signed-descending sort (+5 … −5). Sign + order convey magnitude; a `perma`
// tag renders as a small colored badge. `0` is defensive only (see schema).
function renderHighlights(highlights = []) {
  el.highlights.innerHTML = "";
  const items = (highlights || [])
    .map((h) => ({ value: M.readValue(h), note: h && h.note, perma: h && (h.perma || h.perma_tag) }))
    .filter((h) => h.value != null);

  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "highlight highlight--empty";
    li.textContent = "No highlights.";
    el.highlights.appendChild(li);
    return;
  }

  items.sort((a, b) => b.value - a.value);

  items.forEach((h) => {
    const v = h.value || 0;
    const sign = v > 0 ? "pos" : v < 0 ? "neg" : "zero";

    const li = document.createElement("li");
    li.className = "highlight highlight--" + sign;

    const mark = document.createElement("span");
    mark.className = "highlight-mark";
    mark.textContent = v > 0 ? "+" : v < 0 ? "−" : "●";

    const note = document.createElement("span");
    note.className = "highlight-note";
    note.textContent = h.note ?? "";

    li.append(mark, note);

    if (h.perma && M.permaAxes().includes(h.perma)) {
      const badge = document.createElement("span");
      badge.className = "perma-badge";
      badge.textContent = h.perma;
      badge.style.setProperty("--badge-color", M.permaColor(h.perma));
      badge.title = (M.permaLabels()[h.perma]) || h.perma;
      li.appendChild(badge);
    }

    el.highlights.appendChild(li);
  });
}

// ---- PERMA radar (right page, top-right) ----------------------------------
// Daily self-rating on a 0–4 scale (0 = center, 4 = outer ring). Axes cited by
// today's highlights are emphasized. Renders a "not rated" note when absent.
function renderPerma(data) {
  el.perma.innerHTML = "";
  const axes = M.permaAxes();
  const [lo, hi] = M.permaRange();
  const perma = M.readPerma(data);

  if (!perma) {
    const p = document.createElement("p");
    p.className = "perma-empty";
    p.textContent = "Not yet rated.";
    el.perma.appendChild(p);
    return;
  }

  const cited = M.highlightPermaAxes(data.highlights);
  const N = axes.length;
  const size = 200, cx = size / 2, cy = size / 2, R = size * 0.36;
  const rings = hi - lo; // 4 rings for 0..4

  // angle for axis i (start at top, clockwise)
  const ang = (i) => -Math.PI / 2 + (2 * Math.PI * i) / N;
  const pt = (i, frac) => [cx + R * frac * Math.cos(ang(i)), cy + R * frac * Math.sin(ang(i))];

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("class", "perma-radar");

  const mk = (tag, attrs) => {
    const e = document.createElementNS(svgNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };

  // concentric rings (grid) — each ring = one scale step
  for (let r = 1; r <= rings; r++) {
    const frac = r / rings;
    const pts = axes.map((_, i) => pt(i, frac).join(",")).join(" ");
    svg.appendChild(mk("polygon", {
      points: pts, class: "radar-ring",
      "fill": "none",
    }));
  }
  // spokes
  axes.forEach((_, i) => {
    const [x, y] = pt(i, 1);
    svg.appendChild(mk("line", { x1: cx, y1: cy, x2: x, y2: y, class: "radar-spoke" }));
  });

  // data polygon (missing axis treated as 0)
  const dpts = axes.map((a, i) => {
    const v = perma[a] == null ? lo : perma[a];
    const frac = (v - lo) / (hi - lo);
    return pt(i, frac).join(",");
  }).join(" ");
  svg.appendChild(mk("polygon", { points: dpts, class: "radar-data" }));

  // per-axis vertices + labels
  axes.forEach((a, i) => {
    const v = perma[a];
    const frac = v == null ? 0 : (v - lo) / (hi - lo);
    const [vx, vy] = pt(i, frac);
    svg.appendChild(mk("circle", {
      cx: vx, cy: vy, r: 3.2, fill: M.permaColor(a), class: "radar-dot",
    }));
    const [lx, ly] = pt(i, 1.2);
    const label = mk("text", {
      x: lx, y: ly, class: "radar-label" + (cited.has(a) ? " is-cited" : ""),
      "text-anchor": "middle", "dominant-baseline": "middle",
      fill: M.permaColor(a),
    });
    label.textContent = `${a} ${v == null ? "–" : v}/${hi}`;
    svg.appendChild(label);
  });

  el.perma.appendChild(svg);
}

// ---- Eudaimon breakdown (right page, bottom) ------------------------------
function fmtSigned(v) {
  return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(2);
}

async function renderEudaimon(ymd, data) {
  const blocks = M.parseBlocks(data.activity);
  const prev = await M.loadEntry(M.shiftYmd(ymd, -1));
  if (ymd !== currentYmd) return; // navigated away while awaiting
  const prevBt = prev ? M.bedtimeOf(M.parseBlocks(prev.activity)) : null;

  const { terms, total, bedtime } = M.computeEudaimon(
    blocks, data.highlights, prevBt ? prevBt.hours : null
  );

  el.euScore.textContent = total.toFixed(2);

  // Diverging bars: contributions plotted left (−) / right (+) of a 0 axis.
  // Fixed scale — |value| = 5 fills a full half-track — so bar lengths are
  // comparable across days (not rescaled to each day's largest term). Terms
  // beyond ±5 (e.g. a big highlights sum) clamp to full length.
  const MAX_ABS = 5;
  const contrib = terms.filter((t) => t.key !== "base" && Math.abs(t.value) >= 0.005);

  const list = el.euTerms;
  list.innerHTML = "";

  // base offset shown as a plain lead-in row
  const baseTerm = terms.find((t) => t.key === "base");
  const baseRow = document.createElement("div");
  baseRow.className = "eu-bar eu-bar--base";
  baseRow.innerHTML =
    `<span class="eu-bar-name">baseline</span>` +
    `<span class="eu-bar-track"></span>` +
    `<span class="eu-bar-val">${baseTerm.value.toFixed(2)}</span>`;
  list.appendChild(baseRow);

  contrib.forEach((t) => {
    const row = document.createElement("div");
    row.className = "eu-bar";

    const name = document.createElement("span");
    name.className = "eu-bar-name";
    name.style.color = t.color;
    name.textContent = t.key + (t.key === "Phase" && bedtime && !bedtime.confident ? " ⚠" : "");
    if (t.key === "Phase" && bedtime && !bedtime.confident) {
      name.title = "bedtime low-confidence: no nocturnal sleep block matched";
    }

    const track = document.createElement("span");
    track.className = "eu-bar-track";
    const fill = document.createElement("span");
    const pos = t.value >= 0;
    fill.className = "eu-bar-fill " + (pos ? "eu-bar-fill--pos" : "eu-bar-fill--neg");
    fill.style.width = Math.min(Math.abs(t.value) / MAX_ABS, 1) * 50 + "%";
    fill.style.background = t.color;
    track.appendChild(fill);

    const val = document.createElement("span");
    val.className = "eu-bar-val";
    val.textContent = fmtSigned(t.value);

    row.append(name, track, val);
    list.appendChild(row);
  });
}

// ---- condition ------------------------------------------------------------
function conditionClass(cond) {
  const c = String(cond || "").toLowerCase().trim();
  if (["excellent", "very good", "good"].includes(c)) return "good";
  if (["fair"].includes(c)) return "fair";
  if (["poor", "bad"].includes(c)) return "bad";
  return "normal";
}

// ---- Render one entry -----------------------------------------------------
function render(ymd, data) {
  currentYmd = ymd;
  el.date.textContent = formatDate(ymd);
  el.condition.textContent = data.condition ?? "";
  el.condition.className = "condition-value " + conditionClass(data.condition);
  renderActivity(data.activity);
  renderHighlights(data.highlights);
  renderPerma(data);
  renderEudaimon(ymd, data);
  window.scrollTo({ top: 0 });
  refreshNav();
}

async function refreshNav() {
  el.prev.disabled = el.next.disabled = true;
  const [older, newer] = await Promise.all([
    findEntry(currentYmd, -1),
    findEntry(currentYmd, +1),
  ]);
  el.prev.disabled = !older;
  el.next.disabled = !newer;
}

let busy = false;
async function step(direction) {
  if (busy || !currentYmd) return;
  busy = true;
  el.book.classList.add("is-changing");
  try {
    const found = await findEntry(currentYmd, direction);
    if (found) render(found.ymd, found.data);
  } finally {
    el.book.classList.remove("is-changing");
    busy = false;
  }
}
const older = () => step(-1);
const newer = () => step(+1);

// ---- Formula modal --------------------------------------------------------
function openModal() { el.modal.hidden = false; }
function closeModal() { el.modal.hidden = true; }
function bindModal() {
  el.formulaBody.textContent = M.formulaText();
  el.modalTitle.textContent = `Eudaimon formula — v${M.weights().version}`;
  el.infoBtn.addEventListener("click", openModal);
  el.modalClose.addEventListener("click", closeModal);
  el.modal.addEventListener("click", (e) => { if (e.target === el.modal) closeModal(); });
}

function bindEvents() {
  el.prev.addEventListener("click", older);
  el.next.addEventListener("click", newer);
  bindModal();

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeModal(); return; }
    if (!el.modal.hidden) return;
    if (e.key === "ArrowLeft") older();
    else if (e.key === "ArrowRight") newer();
  });

  // Re-evaluate which labels fit when the book is resized (heights change).
  let resizeT;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(fitActivityLabels, 120);
  });

  let startX = 0, startY = 0, tracking = false;
  const THRESHOLD = 50;
  window.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    startX = t.clientX; startY = t.clientY; tracking = true;
  }, { passive: true });
  window.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX, dy = t.clientY - startY;
    if (Math.abs(dx) < THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
    if (dx > 0) older(); else newer();
  }, { passive: true });
}

async function init() {
  await M.initModel();
  bindEvents();
  el.prev.disabled = el.next.disabled = true;

  // Optional ?date=YYYYMMDD override (useful for viewing test fixtures).
  const param = new URLSearchParams(location.search).get("date");
  let found = null;
  if (param) {
    const data = await M.loadEntry(param);
    if (data) found = { ymd: param, data };
  }
  if (!found) found = await findEntry(M.todayYmd(), -1, { inclusive: true });

  if (found) {
    render(found.ymd, found.data);
  } else {
    el.highlights.textContent = "No diary entries yet.";
  }
}

init();
