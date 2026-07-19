// js/stats.js — Stats view. Four panels, all driven by js/model.js.
// A mirror, not a game: trends and deltas only; no streaks, goals, or scores.
import * as M from "./model.js";

const SVG = "http://www.w3.org/2000/svg";
const GAP_LIMIT = 45;   // stop scanning after this many consecutive empty days
const HARD_CAP = 800;   // absolute ceiling on the backward scan
const COMP_TILES = 168; // 24h × 7 — one week
const COMP_COLS = 24;   // 24 × 7 = 168 (one column per hour, one row per day)
const FAMINE_THRESHOLD = 1.5; // 0–4 scale; below this a PERMA axis is flagged

const $ = (id) => document.getElementById(id);

let entries = [];             // ascending by ymd, precomputed
let compWeekStart = null;     // Monday YYYYMMDD (composition week)
let selectedWeekday = null;   // 0=Mon … 6=Sun
let ptWeekStart = null;       // Monday YYYYMMDD
let eGlobal = { min: 0, max: 1 };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const mondayIdx = (d) => (d.getDay() + 6) % 7; // Mon=0 … Sun=6

function mkSvg(tag, attrs) {
  const e = document.createElementNS(SVG, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

// ---- Data collection ------------------------------------------------------
async function collectEntries() {
  const list = [];
  let ymd = M.todayYmd();
  let miss = 0;
  for (let i = 0; i < HARD_CAP && miss < GAP_LIMIT; i++) {
    const data = await M.loadEntry(ymd);
    if (data) { list.push({ ymd, data }); miss = 0; } else { miss++; }
    ymd = M.shiftYmd(ymd, -1);
  }
  list.reverse();

  const out = [];
  for (const { ymd, data } of list) {
    const blocks = M.parseBlocks(data.activity);
    const prev = await M.loadEntry(M.shiftYmd(ymd, -1));
    const prevBt = prev ? M.bedtimeOf(M.parseBlocks(prev.activity)) : null;
    const prevBtHours = prevBt ? prevBt.hours : null;
    const eu = M.computeEudaimon(blocks, data.highlights, prevBtHours);
    out.push({
      ymd, data, blocks,
      date: M.ymdToDate(ymd),
      dow: mondayIdx(M.ymdToDate(ymd)),
      E: eu.total,
      prevBtHours,
      cond: M.conditionToNumber(data.condition),
      perma: M.readPerma(data),
      hours: M.hoursByLabel(blocks),
    });
  }
  return out;
}

// ===========================================================================
// (1) Monthly composition — Othello tiles (1 tile ≈ 1h of a 168h week)
// ===========================================================================
function apportion(totals) {
  const grand = Object.values(totals).reduce((s, v) => s + v, 0);
  if (grand <= 0) return [];
  const labels = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
  const raw = labels.map((l) => {
    const exact = (totals[l] / grand) * COMP_TILES;
    const n = Math.floor(exact);
    return { l, exact, n, frac: exact - n, hours: totals[l] };
  });
  let rem = COMP_TILES - raw.reduce((s, r) => s + r.n, 0);
  raw.slice().sort((a, b) => b.frac - a.frac).forEach((r) => { if (rem > 0) { r.n++; rem--; } });
  return raw;
}

function renderComposition() {
  const start = M.ymdToDate(compWeekStart);
  const end = new Date(start); end.setDate(end.getDate() + 6);
  const inWeek = entries.filter((e) => e.date >= start && e.date <= end);
  const totals = {};
  inWeek.forEach((e) => { for (const k in e.hours) totals[k] = (totals[k] || 0) + e.hours[k]; });

  $("compWeek").textContent = `wk of ${start.getMonth() + 1}/${start.getDate()}`;

  // disable forward nav beyond the current week
  $("compNext").disabled = compWeekStart >= mondayOf(M.todayYmd());

  const grid = $("compGrid");
  const legend = $("compLegend");
  grid.innerHTML = "";
  legend.innerHTML = "";
  grid.style.setProperty("--comp-cols", COMP_COLS);

  const parts = apportion(totals);
  if (parts.length === 0) {
    const p = document.createElement("p");
    p.className = "panel-empty";
    p.textContent = "No data this week.";
    grid.appendChild(p);
    return;
  }

  const cells = [];
  parts.forEach((r) => { for (let i = 0; i < r.n; i++) cells.push(M.colorFor(r.l)); });
  while (cells.length < COMP_TILES) cells.push(null);
  cells.forEach((c) => {
    const tile = document.createElement("span");
    tile.className = "comp-tile" + (c ? "" : " comp-tile--empty");
    if (c) tile.style.background = c;
    grid.appendChild(tile);
  });

  parts.forEach((r) => {
    const li = document.createElement("li");
    li.className = "comp-legend-item";
    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = M.colorFor(r.l);
    const name = document.createElement("span");
    name.className = "legend-name";
    name.textContent = r.l;
    const val = document.createElement("span");
    val.className = "legend-val";
    val.textContent = `${r.hours.toFixed(0)}h`;
    li.append(dot, name, val);
    legend.appendChild(li);
  });
}

// ===========================================================================
// (2)+(3) E_day by weekday — line chart + weekday table
// ===========================================================================
function renderWeekdayTable() {
  const table = $("wdTable");
  table.innerHTML = "";
  const head = document.createElement("tr");
  head.innerHTML = `<th>Day</th><th>E&#772;</th><th>Cond</th><th>n</th>`;
  table.appendChild(head);

  for (let wd = 0; wd < 7; wd++) {
    const rows = entries.filter((e) => e.dow === wd);
    const eVals = rows.map((e) => e.E);
    const cVals = rows.map((e) => e.cond).filter((c) => c != null);
    const eAvg = eVals.length ? eVals.reduce((s, v) => s + v, 0) / eVals.length : null;
    const cAvg = cVals.length ? cVals.reduce((s, v) => s + v, 0) / cVals.length : null;

    const tr = document.createElement("tr");
    tr.className = "wd-row" + (wd === selectedWeekday ? " is-selected" : "");
    tr.innerHTML =
      `<td>${WEEKDAYS[wd]}</td>` +
      `<td>${eAvg == null ? "–" : eAvg.toFixed(2)}</td>` +
      `<td>${cAvg == null ? "–" : cAvg.toFixed(1)}</td>` +
      `<td>${rows.length}</td>`;
    tr.addEventListener("click", () => { selectedWeekday = wd; renderWeekday(); });
    table.appendChild(tr);
  }
}

function renderWeekdayChart() {
  const host = $("wdChart");
  host.innerHTML = "";
  $("wdSel").textContent = `· ${WEEKDAYS[selectedWeekday]}`;

  const rows = entries.filter((e) => e.dow === selectedWeekday);
  if (rows.length === 0) {
    const p = document.createElement("p");
    p.className = "panel-empty";
    p.textContent = "No entries on this weekday.";
    host.appendChild(p);
    return;
  }

  const W = 300, H = 150, pad = 22;
  const lo = Math.min(0, eGlobal.min), hi = Math.max(0, eGlobal.max);
  const x = (i) => pad + (rows.length === 1 ? (W - 2 * pad) / 2 : (i / (rows.length - 1)) * (W - 2 * pad));
  const y = (v) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - 2 * pad);

  const svg = mkSvg("svg", { viewBox: `0 0 ${W} ${H}`, class: "wd-svg" });

  // zero line
  const yz = y(0);
  svg.appendChild(mkSvg("line", { x1: pad, y1: yz, x2: W - pad, y2: yz, class: "axis-zero" }));
  const zlab = mkSvg("text", { x: pad - 4, y: yz, class: "axis-label", "text-anchor": "end", "dominant-baseline": "middle" });
  zlab.textContent = "0";
  svg.appendChild(zlab);

  // polyline
  const pts = rows.map((e, i) => `${x(i)},${y(e.E)}`).join(" ");
  svg.appendChild(mkSvg("polyline", { points: pts, class: "wd-line" }));
  rows.forEach((e, i) => {
    const c = mkSvg("circle", { cx: x(i), cy: y(e.E), r: 3, class: "wd-pt" });
    const t = mkSvg("title", {});
    t.textContent = `${e.ymd}  E=${e.E.toFixed(2)}`;
    c.appendChild(t);
    svg.appendChild(c);
  });

  host.appendChild(svg);
}

function renderWeekday() {
  renderWeekdayTable();
  renderWeekdayChart();
}

// ===========================================================================
// (4) PERMA trend — weekly, Monday-start
// ===========================================================================
function mondayOf(ymd) {
  const d = M.ymdToDate(ymd);
  d.setDate(d.getDate() - mondayIdx(d));
  return M.dateToYmd(d);
}

function weekAverages(weekStartYmd) {
  const start = M.ymdToDate(weekStartYmd);
  const end = new Date(start); end.setDate(end.getDate() + 6);
  const inWeek = entries.filter((e) => e.perma && e.date >= start && e.date <= end);
  const out = {};
  M.permaAxes().forEach((a) => {
    const vals = inWeek.filter((e) => e.perma[a] != null).map((e) => e.perma[a]);
    out[a] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  });
  out._n = inWeek.length;
  return out;
}

function movingAvg(axis, endYmd, days = 14) {
  const end = M.ymdToDate(endYmd);
  const start = new Date(end); start.setDate(start.getDate() - (days - 1));
  const vals = entries
    .filter((e) => e.perma && e.perma[axis] != null && e.date >= start && e.date <= end)
    .map((e) => e.perma[axis]);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

function renderPermaTrend() {
  const body = $("ptBody");
  const nudge = $("ptNudge");
  body.innerHTML = "";
  nudge.innerHTML = "";

  const start = M.ymdToDate(ptWeekStart);
  $("ptWeek").textContent = `· wk of ${start.getMonth() + 1}/${start.getDate()}`;

  // forward nav not past the current week
  $("ptNext").disabled = ptWeekStart >= mondayOf(M.todayYmd());

  const cur = weekAverages(ptWeekStart);
  const prev = weekAverages(M.shiftYmd(ptWeekStart, -7));
  const [lo, hi] = M.permaRange();
  const weekEnd = M.shiftYmd(ptWeekStart, 6);

  if (cur._n === 0) {
    const p = document.createElement("p");
    p.className = "panel-empty";
    p.textContent = "No PERMA ratings this week.";
    body.appendChild(p);
    return;
  }

  M.permaAxes().forEach((a) => {
    const v = cur[a];
    const pv = prev[a];
    const ma = movingAvg(a, weekEnd);
    const famine = ma != null && ma < FAMINE_THRESHOLD;

    const row = document.createElement("div");
    row.className = "pt-row" + (famine ? " is-famine" : "");

    const label = document.createElement("span");
    label.className = "pt-axis";
    label.style.color = M.permaColor(a);
    label.textContent = a;
    label.title = (M.permaLabels()[a]) || a;

    const track = document.createElement("span");
    track.className = "pt-track";
    const fill = document.createElement("span");
    fill.className = "pt-fill";
    fill.style.width = v == null ? "0%" : ((v - lo) / (hi - lo)) * 100 + "%";
    fill.style.background = M.permaColor(a);
    track.appendChild(fill);

    const val = document.createElement("span");
    val.className = "pt-val";
    let delta = "";
    if (v != null && pv != null) {
      const d = v - pv;
      delta = d > 0.05 ? ` ▲${d.toFixed(1)}` : d < -0.05 ? ` ▼${Math.abs(d).toFixed(1)}` : " ·";
    }
    val.innerHTML = `${v == null ? "–" : v.toFixed(1)}/${hi}<span class="pt-delta">${delta}</span>`;

    row.append(label, track, val);
    body.appendChild(row);
  });

  // famine nudge — action-oriented, minimal. R gets a "reach out" line.
  const rMa = movingAvg("R", weekEnd);
  if (rMa != null && rMa < FAMINE_THRESHOLD) {
    nudge.textContent = "R has run low lately — a good moment to reach out to someone.";
  }
}

// ===========================================================================
// (5) Weight re-tuning tool — deterministic, in-browser, no auto-write
// ===========================================================================
function coeffPaths() {
  const w = M.weights();
  const paths = [];
  for (const k in w) {
    if (k === "version" || k === "updated") continue;
    if (k === "omega_work" || k === "omega_code") {
      ["0", "1", "2"].forEach((v) => paths.push(`${k}.${v}`));
    } else if (typeof w[k] === "number") {
      paths.push(k);
    }
  }
  return paths;
}
function getPath(obj, path) { return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj); }
function cloneWeights() { return JSON.parse(JSON.stringify(M.weights())); }
function withOverride(path, val) {
  const w = cloneWeights();
  const ks = path.split(".");
  let o = w;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = val;
  return w;
}
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}
function bumpVersion(v) {
  const m = String(v).match(/^(\d+)\.(\d+)$/);
  return m ? `${m[1]}.${+m[2] + 1}` : `${v}+1`;
}

function initRetune() {
  const sel = $("rtCoeff");
  coeffPaths().forEach((p) => {
    const o = document.createElement("option");
    o.value = p; o.textContent = p;
    sel.appendChild(o);
  });

  const prefill = () => {
    const cur = Number(getPath(M.weights(), sel.value));
    const span = Math.max(0.5, Math.abs(cur) || 0.5);
    $("rtFrom").value = (cur - span).toFixed(2);
    $("rtTo").value = (cur + span).toFixed(2);
    $("rtStep").value = "0.02";
  };
  sel.addEventListener("change", prefill);
  prefill();

  // default date range = full data span
  if (entries.length) {
    $("rtRange").value = `${entries[0].ymd}-${entries[entries.length - 1].ymd}`;
  }

  // "N days since last change" caution (soft; never blocks)
  const hist = M.weightsHistory();
  if (hist.length) {
    const last = hist.map((h) => h.date).sort().pop();
    const days = Math.round((M.ymdToDate(M.todayYmd()) - M.ymdToDate(last)) / 86400000);
    if (days < 28) {
      $("rtCaution").textContent = `${days}d since last change (guideline: ≤1×/month)`;
    }
  }

  $("rtRun").addEventListener("click", runSweep);
}

function subsetForRange() {
  const raw = $("rtRange").value.trim();
  const m = raw.match(/^(\d{8})\s*-\s*(\d{8})$/);
  const from = m ? m[1] : (entries[0] && entries[0].ymd);
  const to = m ? m[2] : (entries[entries.length - 1] && entries[entries.length - 1].ymd);
  const excl = new Set($("rtExclude").value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean));
  const subset = entries.filter(
    (e) => e.ymd >= from && e.ymd <= to && !excl.has(e.ymd) && e.cond != null
  );
  return { subset, from, to };
}

function runSweep() {
  const out = $("rtOut");
  const path = $("rtCoeff").value;
  const { subset, from, to } = subsetForRange();

  if (subset.length < 3) {
    out.innerHTML = `<p class="rt-msg">Need ≥3 rated days in range (have ${subset.length}).</p>`;
    return;
  }

  const conds = subset.map((e) => e.cond);
  const eAt = (w) => subset.map((e) => M.computeEudaimon(e.blocks, e.data.highlights, e.prevBtHours, w).total);

  const cur = Number(getPath(M.weights(), path));
  const rBefore = pearson(eAt(M.weights()), conds);

  const from0 = Number($("rtFrom").value);
  const to0 = Number($("rtTo").value);
  const step = Math.abs(Number($("rtStep").value)) || 0.02;
  const lo = Math.min(from0, to0), hi = Math.max(from0, to0);

  let best = { val: cur, r: rBefore == null ? -Infinity : rBefore };
  for (let v = lo; v <= hi + 1e-9; v += step) {
    const val = Math.round(v * 1e6) / 1e6;
    const r = pearson(eAt(withOverride(path, val)), conds);
    if (r != null && r > best.r) best = { val, r };
  }

  const rBest = best.r;
  const eBest = eAt(withOverride(path, best.val));

  // paste-ready snippet (weights.json is NEVER auto-written)
  const newCurrent = withOverride(path, best.val);
  newCurrent.version = bumpVersion(M.weights().version);
  newCurrent.updated = M.todayYmd();
  const draft = {
    date: M.todayYmd(),
    changed: `${path}: ${cur} -> ${best.val}`,
    rationale: `grid search vs condition, r ${fmtR(rBefore)} -> ${fmtR(rBest)}. n=${subset.length}. FILL IN rationale.`,
    data_range: `${from}-${to}`,
  };
  const snippet = JSON.stringify({ current: newCurrent, history_prepend: draft }, null, 2);

  out.innerHTML = "";
  const summary = document.createElement("div");
  summary.className = "rt-summary";
  summary.innerHTML =
    `<div><span>coeff</span><b>${path}</b></div>` +
    `<div><span>current</span><b>${cur}</b> (r ${fmtR(rBefore)})</div>` +
    `<div><span>best</span><b>${best.val}</b> (r ${fmtR(rBest)})</div>` +
    `<div><span>n</span><b>${subset.length}</b></div>`;
  out.appendChild(summary);

  out.appendChild(scatter(eBest, conds));

  const note = document.createElement("p");
  note.className = "rt-note";
  note.textContent = "weights.json は自動更新しません。下の JSON を手動で反映してください（変更は月1回まで・rationale 必須）。";
  out.appendChild(note);

  const pre = document.createElement("textarea");
  pre.className = "rt-snippet";
  pre.readOnly = true;
  pre.value = snippet;
  out.appendChild(pre);
}

function fmtR(r) { return r == null ? "n/a" : r.toFixed(2); }

function scatter(eVals, conds) {
  const W = 240, H = 150, pad = 26;
  const exMin = Math.min(...eVals), exMax = Math.max(...eVals);
  const svg = mkSvg("svg", { viewBox: `0 0 ${W} ${H}`, class: "rt-scatter" });
  const x = (e) => pad + ((e - exMin) / (exMax - exMin || 1)) * (W - 2 * pad);
  const y = (c) => H - pad - ((c - 1) / 4) * (H - 2 * pad); // condition 1..5

  // axes
  svg.appendChild(mkSvg("line", { x1: pad, y1: H - pad, x2: W - pad, y2: H - pad, class: "axis-line" }));
  svg.appendChild(mkSvg("line", { x1: pad, y1: pad, x2: pad, y2: H - pad, class: "axis-line" }));
  const xl = mkSvg("text", { x: W - pad, y: H - pad + 12, class: "axis-label", "text-anchor": "end" });
  xl.textContent = "E_day";
  svg.appendChild(xl);
  const yl = mkSvg("text", { x: pad - 6, y: pad, class: "axis-label", "text-anchor": "end" });
  yl.textContent = "cond";
  svg.appendChild(yl);

  eVals.forEach((e, i) => {
    svg.appendChild(mkSvg("circle", { cx: x(e), cy: y(conds[i]), r: 3, class: "rt-dot" }));
  });
  return svg;
}

// ===========================================================================
// Wiring
// ===========================================================================
function bindNav() {
  $("compPrev").addEventListener("click", () => { compWeekStart = M.shiftYmd(compWeekStart, -7); renderComposition(); });
  $("compNext").addEventListener("click", () => { compWeekStart = M.shiftYmd(compWeekStart, +7); renderComposition(); });
  $("ptPrev").addEventListener("click", () => { ptWeekStart = M.shiftYmd(ptWeekStart, -7); renderPermaTrend(); });
  $("ptNext").addEventListener("click", () => { ptWeekStart = M.shiftYmd(ptWeekStart, +7); renderPermaTrend(); });
}

async function init() {
  await M.initModel();
  entries = await collectEntries();
  $("loading").textContent = `${entries.length} entries`;

  if (entries.length) {
    const es = entries.map((e) => e.E);
    eGlobal = { min: Math.min(...es), max: Math.max(...es) };
  }

  // defaults: composition + PERMA = this week; weekday = today
  compWeekStart = mondayOf(M.todayYmd());
  selectedWeekday = mondayIdx(new Date());
  ptWeekStart = mondayOf(M.todayYmd());

  bindNav();
  initRetune();
  renderComposition();
  renderWeekday();
  renderPermaTrend();
}

init();
