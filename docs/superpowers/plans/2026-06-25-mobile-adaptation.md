# Mobile Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the PR Dashboard usable on iPhone 15 (390px) via a card layout and simplified header, with no changes to the desktop experience.

**Architecture:** Single CSS `@media (max-width: 600px)` block added to `public/index.html` handles all layout changes. A minimal JS diff (5 lines) adds semantic class names to `<td>` elements so CSS selectors can target specific columns without relying on fragile `:nth-child` selectors.

**Tech Stack:** Vanilla HTML/CSS/JS; no build step; no framework.

## Global Constraints

- All mobile styles must be inside `@media (max-width: 600px)` — zero desktop impact.
- Do not add any new dependencies (no npm packages, no CDN scripts).
- The existing desktop table, column resize, column reorder, and settings dialog must remain fully functional on desktop.
- `public/dashboard.js` is an ES module served directly; no bundling step.

---

### Task 1: Add semantic CSS classes to `<td>` elements in dashboard.js

**Files:**
- Modify: `public/dashboard.js` (lines 98–104 `COL_RENDERERS`, line 1002–1003 dot cell in `render()`)

**Interfaces:**
- Produces: `td.td-state`, `td.td-participation`, `td.td-created`, `td.td-dot` class names in the rendered DOM — consumed by Tasks 2–4 CSS selectors.
- Note: `td.td-author`, `td.td-status`, `td.td-time` already exist; col 8 (Updated) needs `td-updated` added alongside `td-time`.

- [ ] **Step 1: Edit `COL_RENDERERS` in `public/dashboard.js`**

Find lines 97–104 and make the following changes (each renderer gets one new class):

```js
const COL_RENDERERS = {
  1: (pr) => `<td class="td-state"><span class="state state-${prState(pr)}">${STATE[prState(pr)]}</span></td>`,
  3: (pr) => `<td class="td-author">${escapeHtml(pr.author)}</td>`,
  4: (pr) => `<td class="td-participation">${pr.labels.map(l => `<span class="tag">${PARTICIPATION[l]}</span>`).join('')}</td>`,
  5: (pr) => `<td class="td-status">${statusLabel(pr)}${ownersTag(pr)}</td>`,
  7: (pr) => `<td class="td-time td-created">${timeCell(pr.createdAt)}</td>`,
  8: (pr) => `<td class="td-time td-updated">${timeCell(pr.updatedAt)}</td>`,
};
```

- [ ] **Step 2: Add `td-dot` class to the dot cell in `render()`**

In `render()`, find the line that renders the first `<td>` (around line 1003) and change:

```js
// Before:
`<td>${isNew ? '<span class="dot new" title="new activity"></span>' : ''}</td>`

// After:
`<td class="td-dot">${isNew ? '<span class="dot new" title="new activity"></span>' : ''}</td>`
```

- [ ] **Step 3: Manually verify the classes in browser DevTools**

Start the server: `node server.js`  
Open the app in a browser, inspect any PR row. Confirm:
- First `<td>` has class `td-dot`
- State cell has class `td-state`
- Participation cell has class `td-participation`
- Created cell has classes `td-time td-created`
- Updated cell has classes `td-time td-updated`

- [ ] **Step 4: Commit**

```bash
git add public/dashboard.js
git commit -m "feat(mobile): add semantic td classes for mobile CSS targeting"
```

---

### Task 2: Mobile header CSS

**Files:**
- Modify: `public/index.html` — add `@media (max-width: 600px)` block inside `<style>`

**Interfaces:**
- Consumes: existing `header`, `.controls`, `#me-seg`, `#days-select`, `#refresh`, `#settings-btn`, `#subtitle` selectors.

- [ ] **Step 1: Add the media query block to `index.html`**

Inside the `<style>` tag, after the last existing rule (after `.recent-events-expand:hover { text-decoration: underline; }`), add:

```css
/* ── Mobile (≤ 600px) ─────────────────────────────────────── */
@media (max-width: 600px) {
  body { padding: .75rem; }

  /* Header: two-row stack */
  header {
    flex-wrap: wrap;
    gap: .5rem;
  }
  header h1 { font-size: 1rem; }
  #subtitle { margin-left: 0; font-size: .75rem; }
  .controls { margin-left: 0; width: 100%; justify-content: flex-start; }
  #days-select, #refresh, #settings-btn { display: none; }
  #me-seg { width: 100%; }
  #me-seg .seg-btn { flex: 1; text-align: center; }
}
```

- [ ] **Step 2: Test in browser — simulate iPhone 15**

Open Chrome DevTools → Toggle device toolbar → set to iPhone 15 (390 × 844).  
Verify:
- Header shows two rows: title/subtitle on top, Author/Involved/All buttons below spanning full width.
- Days select, Refresh button, and ⚙️ button are not visible.
- No horizontal scroll on the header.

- [ ] **Step 3: Verify desktop is unchanged**

Remove device simulation (return to full-width desktop). Confirm all controls (days select, refresh, settings) are still visible and the header is a single row.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat(mobile): responsive header — two-row layout on small screens"
```

---

### Task 3: Mobile card layout CSS

**Files:**
- Modify: `public/index.html` — extend the `@media (max-width: 600px)` block

**Interfaces:**
- Consumes: `td-dot`, `td-state`, `td-author`, `td-participation`, `td-status`, `td-created`, `td-updated` classes from Task 1; `tr.pr`, `#main-table`, `#main-table thead` selectors.

- [ ] **Step 1: Add card-layout CSS inside the existing media query block**

Append to the `@media (max-width: 600px)` block (after the header rules):

```css
  /* Table → card list */
  #main-table { display: block; }
  #main-table thead { display: none; }
  #main-table tbody { display: block; }

  tr.pr {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: .3rem;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    margin-bottom: .6rem;
    padding: .65rem .75rem;
    cursor: default;
  }
  tr.pr:hover { background: none; }

  /* All td: block by default, then selectively show */
  #main-table td {
    display: none;
    overflow: visible;
    white-space: normal;
    text-overflow: unset;
    padding: 0;
    border: none;
  }

  /* PR title td (last child) — full width, on top */
  #main-table td:last-child {
    display: block;
    width: 100%;
    order: 0;
    margin-bottom: .25rem;
  }

  /* Meta row: state · status · author · updated */
  #main-table .td-state,
  #main-table .td-status,
  #main-table .td-author,
  #main-table .td-updated {
    display: inline-flex;
    align-items: center;
    order: 1;
  }
  #main-table .td-author { font-size: .8rem; color: var(--color-muted); }
  #main-table .td-updated { font-size: .75rem; color: var(--color-muted); }

  /* Column resizer: hidden on mobile */
  .col-resizer { display: none; }

  /* Filter bar */
  .filter-bar-wrap { flex-direction: column; align-items: flex-start; gap: .4rem; }
```

- [ ] **Step 2: Test card layout on iPhone 15 simulation**

In Chrome DevTools device simulation (iPhone 15):
- Each PR row should render as a card with a visible border and rounded corners.
- First line: PR title link (wraps if long), repo/number below.
- Second line: state badge, status, author name, updated time — all on one horizontal line (wraps if needed).
- No columns for Participation, Created, or the dot indicator visible.
- No horizontal scroll bar.

- [ ] **Step 3: Test clicking the status label opens the review dialog**

Tap (click) the status label (e.g. "✅ approved") on a card. The review dialog must open. Confirm dialog content is readable.

- [ ] **Step 4: Verify desktop unchanged**

Exit device simulation. Confirm the table renders normally with all columns and column resizers.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat(mobile): card layout for PR list on small screens"
```

---

### Task 4: Mobile dialogs and filter bar CSS

**Files:**
- Modify: `public/index.html` — extend the `@media (max-width: 600px)` block

**Interfaces:**
- Consumes: `dialog`, `#review-dialog`, `#owners-dialog`, `#settings-dialog`, `.dialog-toolbar`, `#filter-bar`, `#markRead` selectors.

- [ ] **Step 1: Add dialog and filter-bar CSS to the media query block**

Append to the `@media (max-width: 600px)` block:

```css
  /* Dialogs: full-width, taller */
  dialog {
    min-width: auto;
    width: 95vw;
    max-height: 92vh;
    padding: .9rem 1rem;
  }

  /* Review dialog toolbar: stack toggles vertically */
  .dialog-toolbar {
    flex-direction: column;
    align-items: flex-start;
    gap: .5rem;
  }
```

- [ ] **Step 2: Test dialogs on iPhone 15 simulation**

- Tap a status label → review dialog opens. Confirm it occupies ~95% of screen width with no horizontal scroll.
- Confirm the three toggle switches (Hide closed / Hide my comments / Only unreplied) are stacked vertically and readable.
- Tap outside the dialog to close it. Confirm it closes.

- [ ] **Step 3: Test filter chips**

If any filter chips are active (e.g. state filter), confirm they wrap to a second line cleanly with the "Mark all read" button below them.

- [ ] **Step 4: Final end-to-end check on iPhone 15**

Run through the full flow:
1. Header shows Author/Involved/All — tap "Involved", list refreshes.
2. PR cards render with title, state, status, author, updated time.
3. Tap a status label → review dialog opens full-width with vertically-stacked toggles.
4. Close dialog → back to list.
5. No horizontal scroll at any point.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat(mobile): full-width dialogs and stacked toolbar on small screens"
```

---

## Self-Review

**Spec coverage:**
- ✅ Breakpoint `≤ 600px` — Task 2 (first media query block)
- ✅ Header two-row layout, hide days/refresh/settings — Task 2
- ✅ Semantic td classes — Task 1
- ✅ Table → card list with flex ordering — Task 3
- ✅ Show: title, state, status, author, updated — Task 3
- ✅ Hide: dot, participation, created — Task 3 (`display: none`)
- ✅ `td` overflow/whitespace reset — Task 3
- ✅ Dialog `min-width: auto`, `width: 95vw`, `max-height: 92vh` — Task 4
- ✅ Dialog toolbar `flex-direction: column` — Task 4
- ✅ Filter bar `flex-direction: column` — Task 3 (filter-bar-wrap)
- ✅ Desktop unchanged — verified in each task

**Placeholder scan:** No TBD/TODO/similar-to patterns found.

**Type/selector consistency:** All class names introduced in Task 1 (`td-state`, `td-participation`, `td-created`, `td-dot`) are referenced exactly in Tasks 3–4 CSS. Existing classes (`td-author`, `td-status`, `td-updated`/`td-time`) match JS renderers.
