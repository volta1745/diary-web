# Diary Website — Claude Code Instructions

## Project Overview

A static diary website for GitHub Pages with a book-like UI. Diary entries are stored as individual JSON files per day and displayed in a full-screen open-book spread layout.

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

Each diary entry lives at `data/YYYYMMDD.json`:

```json
  {
  "date": "20260614",
  "activity": [
    { "time": "9:00", "label": "Sleep" },
    { "time": "1:30", "label": "Code" },
    { "time": "10:00", "label": "Life" },
    { "time": "13:00", "label": "Code" },
    { "time": "14:00", "label": "Life" },
    { "time": "16:00", "label": "Go-out" },
    { "time": "16:30", "label": "Life" },
    { "time": "18:00", "label": "Work" },
    { "time": "18:30", "label": "None" },
    { "time": "19:30", "label": "Game" },
    { "time": "20:15", "label": "Life" },
    { "time": "22:30", "label": "Code" },
    { "time": "23:30", "label": "Sleep" }
  ],
  "diary": "Text",
  "condition": "good"
  }
```

## UI / UX Rules

- Full-screen open-book spread (two-page layout on PC)
- PC: left/right arrow buttons on the sides of the spread to navigate between entries
- Mobile: swipe or scroll to navigate
- On load: display the most recent diary entry
- Left button → previous date (older); right button → next date (newer)
- Only dates with existing JSON files are shown; dates without files are skipped

## Development Workflow

Follow these steps **in order**, confirming with the user before advancing:

1. Present the steps
2. Present the file structure
3. Present a UI mockup (confirm before coding)
4. Code the UI and confirm
5. Implement the logic and confirm

**Do not proceed to the next step without explicit user confirmation.**

After each step is confirmed and complete:
1. Update the `Current Status` section below to mark the finished step and note the next one.
2. Prompt the user to start a new session before continuing (to keep token usage low and context clean).

## Current Status

- [x] Step 1: Present steps
- [x] Step 2: Present file structure
- [ ] Step 3: Present UI mockup
- [ ] Step 4: Code the UI
- [ ] Step 5: Implement the logic

**Next:** Step 3 — Present UI mockup

## Out of Scope (for now)

- JSON data loading and display logic — skeleton/navigation only for now
- Admin panel or login functionality
- Data entry UI

## Testing

Include dummy JSON files under `data/` to verify page navigation behavior.
