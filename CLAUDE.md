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
    { "value": 4, "note": "saw the sunset clearly" }
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
  - `value` (integer, optional): `0` to `2`. How good the block felt
    (`0` = neutral, `1` = good, `2` = very good). **Only `Work` and `Code`
    blocks carry a `value`; omit it for every other label.**
- **`highlights`** (array, optional): Notable events of the day,
  independent of duration. A 3-minute event can be a highlight.
  - `value` (integer, required): `-5` to `-1`, or `+1` to `+5`.
    `0` should not be written — a neutral event is not a highlight by
    definition; record it as `activity.value` instead. The UI must
    nonetheless render `0` gracefully (see *UI / UX Rules*) so that
    legacy or mistyped entries do not break the page.
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
| `Work`    | Job work. Carries a `value` (`0`–`2`).                                 |
| `Code`    | Personal coding / side projects. Carries a `value` (`0`–`2`).           |
| `Life`    | Daily upkeep: meals, hygiene, chores.                                   |
| `Game`    | Gaming.                                                                 |
| `Go-out`  | Outside the home with a destination or purpose (not transit).           |
| `Transit` | Time spent moving between places: walking, train, bike, car.            |
| `None`    | Unaccounted / unclear. Aim to minimize over time.                       |

The previous `Happy` label is removed. Log enjoyable moments as a
`highlights` entry with positive `value` — this decouples emotional
peaks from duration, since a short event can matter more than a long one.

## UI / UX Rules

- Full-screen open-book spread (two-page layout on PC).
- Left page: date header + `activity` timeline.
- Right page: `highlights` list + `condition`.
- **Highlights rendering** (right page):
  - Sorted by `value` in **signed descending order** (most positive
    first, most negative last). `+5, +2, -1, -3` is the correct order.
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
