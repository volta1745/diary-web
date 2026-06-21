---
name: publish
description: Publish/deploy the diary site to GitHub Pages. Use when the user says "公開して", "公開", "publish", "deploy", or otherwise asks to push the diary live. Commits all changes and pushes to the GitHub remote.
---

# Publish the diary to GitHub Pages

Triggered when the user asks to publish (e.g. says **「公開して」**). Goal: get the
current working tree committed and pushed to GitHub so GitHub Pages updates.

Run these steps in order. Report clearly at the end with the live URL.

## 1. Check there is something to publish

```
git status --short
```

If the working tree is clean **and** the branch is not ahead of its upstream,
tell the user there is nothing to publish and stop.

## 2. Ensure a GitHub remote exists

```
git remote -v
```

If there is **no remote**, the repo has never been published. Do not guess —
tell the user and offer to create it with the `gh` CLI:

```
gh repo create <name> --public --source=. --remote=origin --push
```

Confirm the repo name with the user before creating. If `gh` is not available,
give them the manual steps (`git remote add origin <url>`).

## 3. Commit the changes

Stage everything and commit with a concise message summarizing what changed
(e.g. new diary entries by date, or UI tweaks):

```
git add -A
git commit -m "<summary>"
```

End the commit message with:

```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

## 4. Push

```
git push          # or: git push -u origin main   (first push)
```

## 5. Confirm GitHub Pages is enabled

GitHub Pages must be turned on once. Check / report:

```
gh api repos/{owner}/{repo}/pages 2>/dev/null
```

- If Pages is **not** enabled, instruct the user to enable it:
  repo **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**,
  or offer to enable it via:
  `gh api -X POST repos/{owner}/{repo}/pages -f "source[branch]=main" -f "source[path]=/"`
- If enabled, report the live URL (typically `https://<owner>.github.io/<repo>/`).

## Notes

- This is a static site (no build step). Adding `data/YYYYMMDD.json` files and
  pushing is all that is needed — the app discovers entries by probing dates,
  so no manifest/index update is required.
- Pushing publishes publicly. The diary content becomes world-readable. The first
  time, make sure the user actually wants a public repo.
