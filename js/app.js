(() => {
  "use strict";

  const el = {
    book: document.getElementById("book"),
    date: document.getElementById("date"),
    condition: document.getElementById("condition"),
    activity: document.getElementById("activity"),
    highlights: document.getElementById("highlights"),
    euScore: document.getElementById("euScore"),
    euTerms: document.getElementById("euTerms"),
    prev: document.getElementById("prevBtn"),
    next: document.getElementById("nextBtn"),
    infoBtn: document.getElementById("infoBtn"),
    modal: document.getElementById("formulaModal"),
    modalClose: document.getElementById("modalClose"),
  };

  const SCAN_LIMIT = 366; // stop after ~1 year of empty days in one direction
  let currentYmd = null;      // YYYYMMDD of the displayed entry
  const cache = new Map();    // ymd -> data | null (null = confirmed missing)

  // ---- Date helpers (YYYYMMDD string <-> Date) ----
  function ymdToDate(ymd) {
    return new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8));
  }
  function dateToYmd(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  }
  function shiftYmd(ymd, days) {
    const d = ymdToDate(ymd);
    d.setDate(d.getDate() + days);
    return dateToYmd(d);
  }
  function todayYmd() {
    return dateToYmd(new Date());
  }

  // YYYYMMDD -> "YYYY.MM.DD (Sat)"
  function formatDate(ymd) {
    const pad = (n) => String(n).padStart(2, "0");
    const d = ymdToDate(ymd);
    const dow = d.toLocaleDateString("en-US", { weekday: "short" });
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} (${dow})`;
  }

  // Fetch one entry. Returns data, or null if the file doesn't exist.
  async function loadEntry(ymd) {
    if (cache.has(ymd)) return cache.get(ymd);
    let data = null;
    try {
      const res = await fetch(`data/${ymd}.json`, { cache: "no-cache" });
      if (res.ok) data = await res.json();
    } catch (_) {
      /* network error — treat as missing */
    }
    cache.set(ymd, data);
    return data;
  }

  // Walk day-by-day from `fromYmd` (inclusive optional) in `step` direction
  // until a JSON file is found. No future dates. Returns the entry or null.
  async function findEntry(fromYmd, step, { inclusive = false } = {}) {
    let ymd = inclusive ? fromYmd : shiftYmd(fromYmd, step);
    const today = todayYmd();
    for (let i = 0; i < SCAN_LIMIT; i++) {
      if (step > 0 && ymd > today) return null; // don't navigate into the future
      const data = await loadEntry(ymd);
      if (data) return { ymd, data };
      ymd = shiftYmd(ymd, step);
    }
    return null;
  }

  const END_OF_DAY = 24 * 60; // minutes
  const MIN_BLOCK = 15;       // minutes — keeps tiny segments readable

  // Stable color per label (explicit palette + hashed fallback).
  // Canonical palette per CLAUDE.md: Sleep green, Work red, Code purple,
  // Life amber, Hobby blue, Go-out teal, Transit/None gray. Any other label
  // (e.g. legacy "Happy" / retired "Game") falls back to a hashed hue.
  const LABEL_COLORS = {
    Sleep: "#5f9e6e",
    Work: "#cf6450",
    Code: "#8a6bb5",
    Life: "#c79a3a",
    Hobby: "#4f7cc4",
    "Go-out": "#2f9e8f",
    Transit: "#9a9486",
    None: "#c2bbac",
  };
  const HIGHLIGHT_COLOR = "#c96a8e"; // pink — Eudaimon highlights term
  function colorFor(label) {
    if (LABEL_COLORS[label]) return LABEL_COLORS[label];
    let h = 0;
    for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) % 360;
    return `hsl(${h}, 42%, 58%)`;
  }

  function toMinutes(t) {
    const [h, m] = String(t).split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  // Canonical field is `value` (Work/Code blocks: 0–2; highlights: ±1/±2).
  // Tolerate a legacy `valence` alias defensively.
  function readValue(item) {
    const v = item && (item.value != null ? item.value : item.valence);
    return v == null ? null : Number(v);
  }

  // Parse the activity list into time blocks (END-semantics): each `time` is
  // the end of its block; the first block starts at 0:00. Crossing midnight is
  // detected when a time is <= the previous end.
  function parseBlocks(activity = []) {
    const acts = (activity || []).filter((a) => a && a.time != null);
    const blocks = [];
    let prevEnd = 0; // start of day, 0:00 (minutes)
    acts.forEach((item) => {
      let end = toMinutes(item.time);
      if (end <= prevEnd) end += END_OF_DAY; // crossed midnight
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

  // Vertical day timeline. Each block runs from the previous block's end up to
  // its own `time`; the first block starts at 0:00.
  function renderActivity(activity = []) {
    el.activity.innerHTML = "";
    const blocks = parseBlocks(activity);
    let startLabel = "0:00";

    blocks.forEach((b) => {
      const duration = Math.max(b.endMin - b.startMin, MIN_BLOCK);

      const li = document.createElement("li");
      li.className = "slot";
      li.style.flexGrow = String(duration);
      li.style.setProperty("--slot-color", colorFor(b.label));

      const time = document.createElement("span");
      time.className = "slot-time";
      time.textContent = startLabel; // start time of this block

      const block = document.createElement("span");
      block.className = "slot-block";
      block.textContent = b.label ?? "";

      li.append(time, block);
      el.activity.appendChild(li);

      // next block starts where this one ended (minutes -> H:MM)
      const endH = Math.floor(b.endMin / 60);
      const endM = b.endMin % 60;
      startLabel = `${endH}:${String(endM).padStart(2, "0")}`;
    });
  }

  // Highlights (top region of right page). Sorted by value in signed-
  // descending order (most positive first, most negative last). Magnitude is
  // conveyed only by sign + sort order; each item gets a sign marker.
  function renderHighlights(highlights = []) {
    el.highlights.innerHTML = "";
    const items = (highlights || [])
      .map((h) => ({ value: readValue(h), note: h && h.note }))
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
      // 0 is defensive only — neutral events belong in activity.value.
      mark.textContent = v > 0 ? "+" : v < 0 ? "−" : "●";

      const note = document.createElement("span");
      note.className = "highlight-note";
      note.textContent = h.note ?? "";

      li.append(mark, note);
      el.highlights.appendChild(li);
    });
  }

  // ---- Eudaimon score (v0.1) ----
  const OMEGA_WORK = { 0: -0.20, 1: 0.00, 2: 0.15 };
  const OMEGA_CODE = { 0: 0.08, 1: 0.15, 2: 0.30 };

  function sumHours(blocks, label) {
    return blocks
      .filter((b) => b.label === label)
      .reduce((s, b) => s + b.hours, 0);
  }

  // ω lookup: missing value -> 1; clamp to the table domain {0,1,2}.
  function omega(table, value) {
    const v = value == null ? 1 : value;
    const k = Math.max(0, Math.min(2, Math.round(v)));
    return table[k];
  }

  function workCodeTerm(blocks, label, table) {
    return blocks
      .filter((b) => b.label === label)
      .reduce((s, b) => s + b.hours * omega(table, b.value), 0);
  }

  // bedtime(d): start (hours, possibly >= 24) of the longest contiguous Sleep
  // block whose start falls within [12:00, 36:00). Returns null if none.
  function bedtimeOf(blocks) {
    let best = null;
    blocks.forEach((b) => {
      if (b.label !== "Sleep") return;
      const startH = b.startMin / 60;
      if (startH < 12 || startH >= 36) return;
      if (!best || b.hours > best.hours) best = b;
    });
    return best ? best.startMin / 60 : null;
  }

  function circDistance(a, b) {
    const d = Math.abs(a - b) % 24;
    return Math.min(d, 24 - d);
  }

  function computeEudaimon(blocks, highlights, prevBedtime) {
    const sleep = sumHours(blocks, "Sleep");
    const life = sumHours(blocks, "Life");
    const hobby = sumHours(blocks, "Hobby");
    const goout = sumHours(blocks, "Go-out");
    const transit = sumHours(blocks, "Transit");
    const none = sumHours(blocks, "None");

    const hobbyTerm = 1.0 * Math.min(hobby, 1) - 0.40 * Math.max(0, hobby - 1);

    const hi = (highlights || [])
      .map(readValue)
      .filter((v) => v != null)
      .reduce((s, v) => s + v, 0);

    const bedtime = bedtimeOf(blocks);
    let shift = 0;
    if (bedtime != null && prevBedtime != null) {
      shift = -0.15 * Math.max(0, circDistance(bedtime, prevBedtime) - 1.0);
    }

    const terms = [
      { key: "base",       color: "var(--ink-soft)",  value: 3.0 },
      { key: "Sleep",      color: colorFor("Sleep"),  value: -0.20 * Math.abs(sleep - 7.5) },
      { key: "Work",       color: colorFor("Work"),   value: workCodeTerm(blocks, "Work", OMEGA_WORK) },
      { key: "Code",       color: colorFor("Code"),   value: workCodeTerm(blocks, "Code", OMEGA_CODE) },
      { key: "Life",       color: colorFor("Life"),   value: -0.08 * life },
      { key: "Hobby",      color: colorFor("Hobby"),  value: hobbyTerm },
      { key: "Go-out",     color: colorFor("Go-out"), value: 0.15 * goout },
      { key: "Transit",    color: colorFor("Transit"),value: -0.05 * transit },
      { key: "None",       color: colorFor("None"),   value: -0.35 * none },
      { key: "shift",      color: colorFor("Sleep"),  value: shift },
      { key: "Highlights", color: HIGHLIGHT_COLOR,    value: hi },
    ];
    const total = terms.reduce((s, t) => s + t.value, 0);
    return { terms, total };
  }

  function fmtSigned(v) {
    const sign = v >= 0 ? "+" : "−";
    return sign + Math.abs(v).toFixed(2);
  }

  // Bottom region of the right page: per-term breakdown + final E_day.
  // Needs the previous calendar day's bedtime for the phase-shift term.
  async function renderEudaimon(ymd, data) {
    const blocks = parseBlocks(data.activity);
    const prev = await loadEntry(shiftYmd(ymd, -1));
    if (ymd !== currentYmd) return; // navigated away while awaiting
    const prevBedtime = prev ? bedtimeOf(parseBlocks(prev.activity)) : null;

    const { terms, total } = computeEudaimon(blocks, data.highlights, prevBedtime);

    el.euScore.textContent = total.toFixed(2);

    const list = el.euTerms;
    list.innerHTML = "";
    terms.forEach((t) => {
      // hide terms that contribute nothing (except the base offset)
      if (t.key !== "base" && Math.abs(t.value) < 0.005) return;

      const chip = document.createElement("span");
      chip.className = "eu-term";

      const dot = document.createElement("span");
      dot.className = "eu-dot";
      dot.style.background = t.color;

      const name = document.createElement("span");
      name.className = "eu-name";
      name.textContent = t.key;

      const val = document.createElement("span");
      val.className = "eu-val";
      val.textContent = t.key === "base" ? t.value.toFixed(2) : fmtSigned(t.value);

      chip.append(dot, name, val);
      list.appendChild(chip);
    });
  }

  // Map a condition value to a color class (handles the 5-level diary scale
  // plus loose values like "good" / "normal" / "bad").
  function conditionClass(cond) {
    const c = String(cond || "").toLowerCase().trim();
    if (["excellent", "very good", "good"].includes(c)) return "good";
    if (["fair"].includes(c)) return "fair";
    if (["poor", "bad"].includes(c)) return "bad";
    return "normal";
  }

  function render(ymd, data) {
    currentYmd = ymd;
    el.date.textContent = formatDate(ymd);
    el.condition.textContent = data.condition ?? "";
    el.condition.className = "condition-value " + conditionClass(data.condition);
    renderActivity(data.activity);
    renderHighlights(data.highlights);
    renderEudaimon(ymd, data); // async — settles the bottom panel
    window.scrollTo({ top: 0 });
    refreshNav();
  }

  // Probe neighbours to enable/disable the arrows (results are cached,
  // so a subsequent click is instant).
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

  // ---- Formula modal ----
  function openModal() { el.modal.hidden = false; }
  function closeModal() { el.modal.hidden = true; }
  function bindModal() {
    el.infoBtn.addEventListener("click", openModal);
    el.modalClose.addEventListener("click", closeModal);
    // click outside the dialog closes (body scroll is not locked)
    el.modal.addEventListener("click", (e) => {
      if (e.target === el.modal) closeModal();
    });
  }

  function bindEvents() {
    el.prev.addEventListener("click", older);
    el.next.addEventListener("click", newer);
    bindModal();

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeModal(); return; }
      if (!el.modal.hidden) return; // don't navigate while the modal is open
      if (e.key === "ArrowLeft") older();
      else if (e.key === "ArrowRight") newer();
    });

    // Touch swipe (mobile): swipe right -> older, swipe left -> newer
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
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) < THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
      if (dx > 0) older(); else newer();
    }, { passive: true });
  }

  async function init() {
    bindEvents();
    el.prev.disabled = el.next.disabled = true;
    // No manifest: scan backward from today for the most recent entry.
    // Days without a data/<date>.json file are skipped automatically.
    const found = await findEntry(todayYmd(), -1, { inclusive: true });
    if (found) {
      render(found.ymd, found.data);
    } else {
      el.highlights.textContent = "No diary entries yet.";
    }
  }

  init();
})();
