# Design: Column Visibility Toggle + Jira ID Display

Date: 2026-06-19

## Overview

Two independent features for the PR Dashboard:
1. Allow users to hide and restore table columns via a "Columns" dropdown in the header
2. Display the Jira ID extracted from PR titles inline below the PR title, as a clickable link

---

## Feature 1: Column Visibility Toggle

### UI

A `Columns ▾` button is added to the `header .controls` area (alongside Theme, Me toggle, Days, Refresh, Notify, Mark read). Clicking it opens a dropdown with the same visual style as the existing `state-dropdown` and `author-dropdown`.

The dropdown lists all **hideable columns** with a checkbox each:

| Checkbox label | Column index |
|---|---|
| State | 1 |
| PR# | 2 |
| Author | 3 |
| Participation | 4 |
| Review | 5 |
| CI | 6 |
| Created | 7 |
| Updated | 8 |

The dot column (0) and PR title column (9) are never listed — they are always visible.

### Hiding behavior

When a column is unchecked:
- The corresponding `<th>` in `<thead>` receives class `col-hidden` → `display: none`
- All `<td>` cells at the same column index receive class `col-hidden` → `display: none`
- The `<col>` element in `#colgroup` has its width set to `0`

`col-hidden` CSS: `display: none !important`

When a column is re-checked, the class is removed and the saved width (from `pr-dashboard:col-widths`) is restored.

### Persistence

New localStorage key: `pr-dashboard:col-visibility`

Format: `{ "1": false, "6": false }` — only stores columns that are hidden (absence = visible).

Loaded and applied on page init, before the col-resize init so widths are consistent.

### Column resize interaction

The col-resize init skips `<th>` elements whose column is hidden (no mousedown listener attached while hidden; restored when column is shown again). Alternatively, the simpler approach: the resize handle simply has no visible effect when the column is hidden since `col.style.width = 0` wins.

---

## Feature 2: Jira ID Inline Display

### Extraction

Regex: `/\[([A-Z]+-\d+)\]/` applied to `pr.title`.

Matches patterns like `[ID-17157]`, `[INFRA-42]`, `[PLAT-1234]`.

If no match, nothing is rendered.

### Rendering

Inside the `render()` function, in the PR title `<td>`, after the repo `<div>`:

```html
<div class="repo">${escapeHtml(pr.repo)}</div>
<div class="jira-id"><a href="https://compass-tech.atlassian.net/browse/ID-17157" target="_blank" rel="noopener">🎫 ID-17157</a></div>
```

### Styling

```css
.jira-id { font-size: .75rem; margin-top: .1rem; }
.jira-id a { color: var(--color-muted); text-decoration: none; }
.jira-id a:hover { text-decoration: underline; }
```

Color inherits `--color-muted` to stay visually subordinate to the PR title, consistent with `.repo`.

---

## Files Changed

- `public/index.html` — add `Columns ▾` button HTML, `.col-hidden` CSS, `.jira-id` CSS
- `public/dashboard.js` — column visibility init/load/save logic, dropdown setup, `render()` Jira ID injection

No server-side changes required.
