(() => {
  "use strict";

  const el = {
    book: document.getElementById("book"),
    date: document.getElementById("date"),
    condition: document.getElementById("condition"),
    activity: document.getElementById("activity"),
    highlights: document.getElementById("highlights"),
    prev: document.getElementById("prevBtn"),
    next: document.getElementById("nextBtn"),
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
  // Palette matches the canonical Activity Labels in CLAUDE.md; any other
  // label (e.g. legacy "Happy") falls back to a hashed hue.
  const LABEL_COLORS = {
    Sleep: "#5b6bb5",
    Work: "#e07a5f",
    Code: "#2f9e8f",
    Life: "#c9a26b",
    Game: "#9b6bb5",
    "Go-out": "#e8995e",
    Transit: "#7ba0c4",
    None: "#cdc4b4",
  };
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

  // Vertical day timeline. Each `time` is the END of that activity; the
  // activity starts where the previous one ended (the first starts at 0:00).
  //   { "1:00", Life }  -> 0:00–1:00 Life
  //   { "11:00", Sleep } -> 1:00–11:00 Sleep   ... etc.
  function renderActivity(activity = []) {
    el.activity.innerHTML = "";
    const acts = activity.filter((a) => a && a.time != null);

    let prevEnd = 0;       // start of day, 0:00 (minutes)
    let startLabel = "0:00";

    acts.forEach((item) => {
      let end = toMinutes(item.time);
      if (end <= prevEnd) end += END_OF_DAY; // crossed midnight
      const duration = Math.max(end - prevEnd, MIN_BLOCK);

      const li = document.createElement("li");
      li.className = "slot";
      li.style.flexGrow = String(duration);
      li.style.setProperty("--slot-color", colorFor(item.label));

      const time = document.createElement("span");
      time.className = "slot-time";
      time.textContent = startLabel; // start time of this block

      const block = document.createElement("span");
      block.className = "slot-block";
      block.textContent = item.label ?? "";

      li.append(time, block);
      el.activity.appendChild(li);

      prevEnd = end;
      startLabel = item.time; // next block starts where this one ended
    });
  }

  // Highlights (right page). Sorted by value in signed-descending order
  // (most positive first, most negative last). Magnitude is conveyed only by
  // sign + sort order; each item gets a single-character sign marker.
  function renderHighlights(highlights = []) {
    el.highlights.innerHTML = "";
    const items = (highlights || []).filter((h) => h && h.value != null);

    if (items.length === 0) {
      const li = document.createElement("li");
      li.className = "highlight highlight--empty";
      li.textContent = "No highlights.";
      el.highlights.appendChild(li);
      return;
    }

    items.sort((a, b) => Number(b.value) - Number(a.value));

    items.forEach((h) => {
      const v = Number(h.value) || 0;
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

  function bindEvents() {
    el.prev.addEventListener("click", older);
    el.next.addEventListener("click", newer);

    document.addEventListener("keydown", (e) => {
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
