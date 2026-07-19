// js/model.js
// ---------------------------------------------------------------------------
// Single source of truth CONSUMER. Implements the formulas defined in
// formula.md and reads every coefficient, label, and color from the data
// files at runtime:
//   - schema.json        → labels, ranges, PERMA axes, color palette
//   - data/weights.json  → E_day coefficients (current + history)
//
// This module holds NO formula constants, label lists, or color literals of
// its own (design principle: "定義はデータファイルに、コードは読むだけ").
// Both the Book view (app.js) and the Stats view (stats.js) import from here.
// ---------------------------------------------------------------------------
"use strict";

let _schema = null;
let _weights = null;

// Load schema.json + weights.json once. Safe to call from both views.
export async function initModel() {
  if (_schema && _weights) return { schema: _schema, weights: _weights };
  const [s, w] = await Promise.all([
    fetch("schema.json", { cache: "no-cache" }).then((r) => r.json()),
    fetch("data/weights.json", { cache: "no-cache" }).then((r) => r.json()),
  ]);
  _schema = s;
  _weights = w;
  return { schema: _schema, weights: _weights };
}

export function schema() { return _schema; }
export function weights() { return _weights.current; }
export function weightsHistory() { return _weights.history || []; }
export function schemaVersion() { return _schema.schema_version; }

// ---- Palette (schema-derived; this module owns no color literals) ---------
export function activityLabels() { return _schema.activity_labels.slice(); }
export function permaAxes() { return _schema.perma_daily.axes.slice(); }
export function permaRange() { return _schema.perma_daily.range.slice(); } // [min,max]
export function permaLabels() { return (_schema.perma_daily.labels) || {}; }

export function colorFor(label) {
  const p = _schema.palette && _schema.palette.activity;
  if (p && p[label]) return p[label];
  // Hashed fallback for unknown / legacy labels (e.g. retired "Happy").
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) % 360;
  return `hsl(${h}, 42%, 58%)`;
}
export function highlightColor() {
  return (_schema.palette && _schema.palette.highlights) || "#c96a8e";
}
export function permaColor(axis) {
  const p = _schema.palette && _schema.palette.perma;
  return (p && p[axis]) || "var(--ink-soft)";
}

// ---- Date helpers (YYYYMMDD string <-> Date) ------------------------------
export function ymdToDate(ymd) {
  return new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8));
}
export function dateToYmd(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
export function shiftYmd(ymd, days) {
  const d = ymdToDate(ymd);
  d.setDate(d.getDate() + days);
  return dateToYmd(d);
}
export function todayYmd() { return dateToYmd(new Date()); }

// ---- Entry loading (cached; null = confirmed missing) ---------------------
const _cache = new Map();
export async function loadEntry(ymd) {
  if (_cache.has(ymd)) return _cache.get(ymd);
  let data = null;
  try {
    const res = await fetch(`data/${ymd}.json`, { cache: "no-cache" });
    if (res.ok) data = await res.json();
  } catch (_) { /* network error — treat as missing */ }
  _cache.set(ymd, data);
  return data;
}

// ---- Activity parsing (END-semantics) -------------------------------------
const END_OF_DAY = 24 * 60; // minutes

function toMinutes(t) {
  const [h, m] = String(t).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Canonical field is `value` (Work/Code: 0–2; highlights: ±1..±5).
// Tolerate a legacy `valence` alias defensively (retired field name).
export function readValue(item) {
  const v = item && (item.value != null ? item.value : item.valence);
  return v == null ? null : Number(v);
}

// Parse the activity list into time blocks: each `time` is the END of its
// block; the first block starts at 0:00. A time <= the previous end means the
// clock crossed midnight (minutes carry +24h so bedtime can be >= 24).
export function parseBlocks(activity = []) {
  const acts = (activity || []).filter((a) => a && a.time != null);
  const blocks = [];
  let prevEnd = 0;
  acts.forEach((item) => {
    let end = toMinutes(item.time);
    if (end <= prevEnd) end += END_OF_DAY;
    blocks.push({
      label: item.label,
      startMin: prevEnd,
      endMin: end,
      hours: (end - prevEnd) / 60,
      value: readValue(item),
    });
    prevEnd = end;
  });
  return blocks;
}

export function sumHours(blocks, label) {
  return blocks.filter((b) => b.label === label).reduce((s, b) => s + b.hours, 0);
}

// Summed hours for every activity label present (used by the stats composition
// panel). Returns { label: hours, ... }.
export function hoursByLabel(blocks) {
  const out = {};
  blocks.forEach((b) => { out[b.label] = (out[b.label] || 0) + b.hours; });
  return out;
}

// bedtime(d): start hour of the qualifying nocturnal Sleep block (formula.md).
// Adjacent Sleep blocks are merged. A block qualifies if length >= 3h, its
// start falls in [12:00, 36:00), and its wake (end) lands in 5:00–11:00. If
// several qualify, take the longest. If none qualifies, fall back to the
// longest in-window block and flag it low-confidence.
// Returns { hours, confident } or null when there is no in-window sleep.
export function bedtimeOf(blocks) {
  const merged = [];
  blocks.forEach((b) => {
    if (b.label !== "Sleep") return;
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.endMin - b.startMin) < 1e-6) {
      last.endMin = b.endMin;
      last.hours = (last.endMin - last.startMin) / 60;
    } else {
      merged.push({ startMin: b.startMin, endMin: b.endMin, hours: b.hours });
    }
  });

  const inWindow = merged.filter((b) => {
    const s = b.startMin / 60;
    return s >= 12 && s < 36;
  });
  if (inWindow.length === 0) return null;

  const longest = (arr) =>
    arr.reduce((best, b) => (!best || b.hours > best.hours ? b : best), null);

  const qualifies = inWindow.filter((b) => {
    const wake = (b.endMin / 60) % 24;
    return b.hours >= 3 && wake >= 5 && wake <= 11;
  });
  if (qualifies.length) return { hours: longest(qualifies).startMin / 60, confident: true };
  return { hours: longest(inWindow).startMin / 60, confident: false };
}

export function circDistance(a, b) {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

// ω lookup: missing value -> schema default; clamp to the table domain {0,1,2}.
function omega(table, value) {
  const def = _schema.value_field.default;
  const v = value == null ? def : value;
  const k = Math.max(0, Math.min(2, Math.round(v)));
  return Number(table[String(k)] ?? table[k] ?? 0);
}

// ---- E_day (formula.md, coefficients from weights.json) -------------------
// `w` defaults to the current weights; the retune tool passes an override so a
// candidate coefficient can be evaluated without touching weights.json.
export function computeEudaimon(blocks, highlights, prevBedtime, w = weights()) {
  const sleep = sumHours(blocks, "Sleep");
  const life = sumHours(blocks, "Life");
  const hobby = sumHours(blocks, "Hobby");
  const goout = sumHours(blocks, "Go-out");
  const transit = sumHours(blocks, "Transit");
  const none = sumHours(blocks, "None");

  const workTerm = blocks.filter((b) => b.label === "Work")
    .reduce((s, b) => s + b.hours * omega(w.omega_work, b.value), 0);
  const codeTerm = blocks.filter((b) => b.label === "Code")
    .reduce((s, b) => s + b.hours * omega(w.omega_code, b.value), 0);

  const hobbyTerm = w.k_hobby * Math.min(hobby, w.hobby_opt)
                  - w.k_hobby_excess * Math.max(0, hobby - w.hobby_opt);

  const hi = (highlights || []).map(readValue).filter((v) => v != null)
    .reduce((s, v) => s + v, 0);

  const bt = bedtimeOf(blocks);
  let phase = 0;
  if (bt && prevBedtime != null) {
    phase = -w.k_phase * Math.max(0, circDistance(bt.hours, prevBedtime) - w.phase_free);
  }

  const terms = [
    { key: "base",       color: "var(--ink-soft)",   value: w.baseline },
    { key: "Sleep",      color: colorFor("Sleep"),   value: -w.k_sleep * Math.abs(sleep - w.sleep_opt) },
    { key: "Work",       color: colorFor("Work"),    value: workTerm },
    { key: "Code",       color: colorFor("Code"),    value: codeTerm },
    { key: "Life",       color: colorFor("Life"),    value: -w.k_life * life },
    { key: "Hobby",      color: colorFor("Hobby"),   value: hobbyTerm },
    { key: "Go-out",     color: colorFor("Go-out"),  value: w.k_goout * goout },
    { key: "Transit",    color: colorFor("Transit"), value: -w.k_transit * transit },
    { key: "None",       color: colorFor("None"),    value: -w.k_none * none },
    { key: "Phase",      color: colorFor("Sleep"),   value: phase },
    { key: "Highlights", color: highlightColor(),    value: w.k_highlight * hi },
  ];
  const total = terms.reduce((s, t) => s + t.value, 0);
  return { terms, total, bedtime: bt };
}

// Convenience: compute E_day for a dated entry, pulling the previous calendar
// day's bedtime for the phase-shift term. `w` optional (retune override).
export async function eudaimonForDate(ymd, data, w = weights()) {
  const blocks = parseBlocks(data.activity);
  const prev = await loadEntry(shiftYmd(ymd, -1));
  const prevBt = prev ? bedtimeOf(parseBlocks(prev.activity)) : null;
  return computeEudaimon(blocks, data.highlights, prevBt ? prevBt.hours : null, w);
}

// ---- PERMA ----------------------------------------------------------------
// Read the day's PERMA self-rating. Returns { P,E,R,M,A } (numbers, missing
// axes as null), or null when the entry has no `perma` block at all.
export function readPerma(data) {
  const p = data && data.perma;
  if (!p || typeof p !== "object") return null;
  const out = {};
  let any = false;
  permaAxes().forEach((a) => {
    if (p[a] != null) { out[a] = Number(p[a]); any = true; }
    else out[a] = null;
  });
  return any ? out : null;
}

// Which PERMA axes are cited by today's highlights (via `perma` / `perma_tag`).
export function highlightPermaAxes(highlights = []) {
  const set = new Set();
  (highlights || []).forEach((h) => {
    const tag = h && (h.perma || h.perma_tag);
    if (tag && permaAxes().includes(tag)) set.add(tag);
  });
  return set;
}

// condition string -> 1..5 (Poor..Excellent). Returns null if unrecognised.
export function conditionToNumber(cond) {
  const scale = _schema.condition; // ordered Poor..Excellent
  const c = String(cond || "").toLowerCase().trim();
  const idx = scale.findIndex((s) => s.toLowerCase() === c);
  return idx < 0 ? null : idx + 1;
}

// ---- Formula text for the Book-view modal --------------------------------
// Rendered from the CURRENT weights so the modal always matches what E_day
// actually computes (single source of truth — no second copy of the numbers).
export function formulaText() {
  const w = weights();
  const ow = w.omega_work, oc = w.omega_code;
  return `E_day = ${w.baseline}
      − ${w.k_sleep} · |sleep_hours − ${w.sleep_opt}|
      + Σ_work hours · ω_work[value]
      + Σ_code hours · ω_code[value]
      − ${w.k_life} · life_hours
      + ${w.k_hobby} · min(hobby, ${w.hobby_opt}) − ${w.k_hobby_excess} · max(0, hobby − ${w.hobby_opt})
      + ${w.k_goout} · goout_hours
      − ${w.k_transit} · transit_hours
      − ${w.k_none} · none_hours
      − ${w.k_phase} · max(0, circ_dist(bedtime(d), bedtime(d−1)) − ${w.phase_free})
      + ${w.k_highlight} · Σ highlights[i].value

ω_work = { 0: ${ow["0"]}, 1: ${ow["1"]}, 2: ${ow["2"]} }
ω_code = { 0: ${oc["0"]}, 1: ${oc["1"]}, 2: ${oc["2"]} }   (missing → ${w.hobby_opt != null ? _schema.value_field.default : 1})

bedtime(d): start of the nocturnal Sleep block — length ≥ 3h, start in
            [12:00, 36:00), wake 5:00–11:00. Longest if several; otherwise
            the longest in-window block, flagged low-confidence.
circ_dist(a, b) = min(|a − b|, 24 − |a − b|)   (phase-free ≤ ${w.phase_free}h)

PERMA (P/E/R/M/A) は毎晩の自己評定 0–4 をそのまま使用（行動から算出しない）。
weights v${w.version} · updated ${w.updated}`;
}
