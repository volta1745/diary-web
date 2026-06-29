# Diary Website — Claude Code Instructions

## Project Overview

A static diary website for GitHub Pages with a book-like UI. Entries are
stored as individual JSON files per day and displayed in a full-screen
open-book spread layout. The data model is structured (not free-form text)
to support later quantitative analysis of daily life.

## Tech Stack

- Plain HTML / CSS / JS — no build step
- Hosted on GitHub Pages (static site)

## File Structure

```
diary/
├── CLAUDE.md
├── index.html
├── css/
│   └── style.css
├── js/
│   └── app.js
└── data/
    └── YYYYMMDD.json   # one file per written day, e.g. 20201010.json
```

## JSON Schema

Each entry lives at `data/YYYYMMDD.json`:

```json
{
  "date": "20260625",
  "activity": [
    { "time": "8:30",  "label": "Sleep" },
    { "time": "9:00",  "label": "Life" },
    { "time": "12:00", "label": "Work", "value": 1 },
    { "time": "17:30", "label": "Transit" },
    { "time": "18:00", "label": "Go-out" },
    { "time": "24:00", "label": "Code", "value": 2 }
  ],
  "highlights": [
    { "value": 2, "note": "saw the sunset clearly" }
  ],
  "condition": "Poor / Fair / Good / Very Good / Excellent"
}
```

### Fields

- **`date`** (string, required): `YYYYMMDD`.
- **`activity`** (array, required): Time-ordered blocks describing what was
  done. Each `time` is the END of that block; a block runs from the previous
  block's `time` (the first block starts at 0:00) up to its own `time`.
  - `time` (string, required): End time of the block, `H:MM` or `HH:MM`.
  - `label` (string, required): Activity category. See *Activity Labels*.
  - `value` (integer, optional): `0`, `1`, or `2` — how good the block felt
    (`0` = neutral, `1` = good, `2` = very good). **This field exists only
    when `label` is `Work` or `Code`; it must never be present on a block
    with any other label.** A `Work`/`Code` block with no `value` is
    treated as `1`.

    > **Field rename — `valence` → `value`:** an earlier draft of this
    > schema renamed this field to `valence` with a `-5`–`+5` range. That
    > rename was reverted: the field is `value`, and every JSON file uses
    > `value`. The `valence` name is retired and should never appear in a
    > data file.
- **`highlights`** (array, optional): Notable events of the day,
  independent of duration. A 3-minute event can be a highlight.
  - `value` (integer, required): one of `-2`, `-1`, `+1`, `+2` (four levels).
    `0` is not allowed — a neutral event is not a highlight by definition;
    record it as `activity.value` instead. The UI must nonetheless render
    `0` gracefully (see *UI / UX Rules*) so that legacy or mistyped entries
    do not break the page.
  - `note` (string, optional): Short free-form description. May be empty
    if you want to log the spike without writing about it yet.
- **`condition`** (string, required): Overall day rating.
  One of `Poor`, `Fair`, `Good`, `Very Good`, `Excellent`.

The previous top-level `diary` text field has been removed. Free-form
content moves into `highlights[].note` to keep the data model uniform and
analysable.

### Activity Labels

| Label     | Meaning                                                                 |
|-----------|-------------------------------------------------------------------------|
| `Sleep`   | Sleeping.                                                               |
| `Work`    | Job work. Carries a `value` (`0`–`2`).                                  |
| `Code`    | Personal coding / side projects. Carries a `value` (`0`–`2`).           |
| `Life`    | Daily upkeep: meals, hygiene, chores.                                   |
| `Hobby`   | Personal pastimes including gaming (renamed from `Game`).               |
| `Go-out`  | Outside the home with a destination or purpose (not transit).           |
| `Transit` | Time spent moving between places: walking, train, bike, car.            |
| `None`    | Unaccounted / unclear. Aim to minimize over time.                       |

The previous `Happy` label is removed. Log enjoyable moments as a
`highlights` entry with positive `value` — this decouples emotional
peaks from duration, since a short event can matter more than a long one.

**Label history — `Game` → `Hobby`**: The `Game` label was renamed to
`Hobby` to cover personal pastimes more broadly. All existing JSON files
have been rewritten to use `Hobby`; no loader-side normalisation is
required. New entries must use `Hobby`. The `Game` label is retired and
should never appear in any file.

## Eudaimon Calculation

Each day produces a single scalar **Eudaimon score** `E_day` derived from
the entry. The current formula is **v0.1** and will be revised as more
entries accumulate.

```
E_day = 3.0
      − 0.20 · |sleep_hours − 7.5|
      + Σ_work_blocks hours · ω_work[value]
      + Σ_code_blocks hours · ω_code[value]
      − 0.08 · life_hours
      + 1.00 · min(hobby_hours, 1) − 0.40 · max(0, hobby_hours − 1)
      + 0.15 · goout_hours
      − 0.05 · transit_hours
      − 0.35 · none_hours
      − 0.15 · max(0, circ_distance(bedtime(d), bedtime(d−1)) − 1.0)
      + Σ highlights[i].value
```

Where:
- `sleep_hours`, `life_hours`, `hobby_hours`, `goout_hours`,
  `transit_hours`, `none_hours` are summed durations (hours) of each label
  for day `d`.
- `ω_work = { 0: −0.20, 1: 0.00, 2: +0.15 }` and
  `ω_code = { 0: +0.08, 1: +0.15, 2: +0.30 }`.
  An activity block with no `value` field is treated as `value = 1`.
- `bedtime(d)` is the start time (in hours, possibly ≥ 24 to denote past
  midnight) of the longest contiguous `Sleep` block whose start falls
  within `[d 12:00, d+1 12:00]`.
- `circ_distance(a, b) = min(|a − b|, 24 − |a − b|)` on a 24-hour clock.
- The phase-shift term uses a **threshold of 1.0h**: shifts up to 1h are
  free, only excess incurs penalty.
- `highlights[i].value` is summed directly with no per-event coefficient.

If `bedtime(d−1)` is unavailable (first ever entry, or previous file
missing), the phase-shift term is treated as `0`.

These weights are anchored to the user's stated preferences and to the
range of `condition` (1–5) seen so far; expect refits as data grows.

## UI / UX Rules

- Full-screen open-book spread (two-page layout on PC).
- Left page: date header + `activity` timeline.
- Right page is split into two stacked regions:
  - **Top region (~⅔ height): Highlights & condition.**
    Renders the `highlights` list and the day's `condition` rating.
  - **Bottom region (~⅓ height): Eudaimon panel.**
    Shows the per-term calculation breakdown for `E_day` (each contributing
    term with its computed value) and the final `E_day` total. The
    breakdown is data-only — no value-laden labels. Use the activity
    color palette so each term is visually traceable to its source
    (Sleep green, Work red, Code purple, Life amber, Hobby blue,
    Go-out teal, Transit and None gray, Highlights pink; the bedtime
    phase-shift term uses Sleep green since it is sleep-related).
- **Formula info icon (inline, immediately right of the "Eudaimon"
  heading in the bottom region):**
  A small "i" inside a circle. On click (desktop) or tap (mobile) it
  opens a lightweight modal/tooltip displaying the full Eudaimon formula
  (see *Eudaimon Calculation*) so a first-time viewer can understand
  what the bottom region is showing. The modal closes on click-outside
  or Escape. Body scroll is not locked.
- **Highlights rendering** (top region of right page):
  - Sorted by `value` in **signed descending order** (most positive
    first, most negative last). `+2, +1, -1, -2` is the correct order.
  - Each item is prefixed with a single-character sign marker:
    - `value > 0` → `+`
    - `value < 0` → `-`
    - `value == 0` → `●` (standard black bullet; defensive case only —
      `0` is not expected in valid highlights, see *JSON Schema*)
  - Magnitude is not shown numerically; only sign + sort order convey it.
- PC: left/right arrow buttons on the sides of the spread to navigate
  between entries.
- Mobile: swipe or scroll to navigate.
- On load: display the most recent entry.
- Left button → previous date (older); right button → next date (newer).
- Only dates with existing JSON files are shown; dates without files
  are skipped.

## Development Workflow

Follow these steps **in order**, confirming with the user before advancing:

1. Present the steps
2. Present the file structure
3. Present a UI mockup (confirm before coding)
4. Code the UI and confirm
5. Implement the logic and confirm

**Do not proceed to the next step without explicit user confirmation.**

After each step is confirmed and complete:
1. Update the `Current Status` section below to mark the finished step
   and note the next one.
2. Prompt the user to start a new session before continuing (to keep
   token usage low and context clean).

## Current Status

- [x] Step 1: Present steps
- [x] Step 2: Present file structure
- [ ] Step 3: Present UI mockup
- [ ] Step 4: Code the UI
- [ ] Step 5: Implement the logic

**Next:** Step 3 — Present UI mockup (must reflect the new schema:
no `diary` field, `highlights` shown on the right page).

## Publishing

When the user says **「公開して」** (or "publish" / "deploy"), run the
`publish` skill: commit all changes and push to the GitHub remote so
GitHub Pages updates. The site is static with no build step — adding
`data/YYYYMMDD.json` files and pushing is enough; the app discovers
entries by probing dates (no manifest).

## Out of Scope (for now)

- JSON data loading and display logic — skeleton/navigation only for now
- Admin panel or login functionality
- Data entry UI
- Migration of legacy entries (entries with the old `diary` field) —
  the loader should tolerate and ignore unknown fields so old files
  continue to render until manually migrated.

## Testing

Include dummy JSON files under `data/` to verify page navigation
behavior. At least one dummy file should exercise each of:
`activity.value`, `highlights` with positive and negative value,
and an empty `highlights` array.
