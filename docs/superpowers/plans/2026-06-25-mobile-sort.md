# Mobile Sort Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Status and Created sort buttons to the mobile card layout, wired to the existing sort engine.

**Architecture:** Two `<button>` elements added to `<header>` in HTML, hidden on desktop via base CSS, shown on mobile via the existing `@media (max-width: 600px)` block. `updateSortUI()` in `dashboard.js` is extended to sync button text/style, and two click handlers invoke the existing sort + render pipeline.

**Tech Stack:** Vanilla HTML/CSS/JS, no framework, no build step.

## Global Constraints

- All mobile-specific styles must be inside the existing `@media (max-width: 600px)` block in `public/index.html` — no second media block.
- `#mobile-sort-bar { display: none; }` must go in base styles (outside media query) so desktop is unaffected.
- No new dependencies.
- `public/dashboard.js` is an ES module served directly — no bundling.

---

### Task 1: HTML structure + hide on desktop

**Files:**
- Modify: `public/index.html` — add `#mobile-sort-bar` HTML (after line 393, before `</header>`); add base `display: none` rule (in base styles, before `@media` block)

**Interfaces:**
- Produces: `id="mobile-sort-bar"`, `id="mobile-sort-status"`, `id="mobile-sort-created"` in the DOM — consumed by Task 2 CSS and JS.

- [ ] **Step 1: Add the HTML**

In `public/index.html`, insert after line 393 (`</div>` that closes `.controls`) and before line 394 (`</header>`):

```html
    <div id="mobile-sort-bar">
      <button id="mobile-sort-status">Status</button>
      <button id="mobile-sort-created">Created</button>
    </div>
```

Result: `</header>` is now at line 398.

- [ ] **Step 2: Hide on desktop**

In `public/index.html`, find the base styles section (around line 283, just before `@media (prefers-color-scheme: dark)` or before the `@media (max-width: 600px)` block). Add this rule to the base styles (outside any media query):

```css
    #mobile-sort-bar { display: none; }
```

A safe place to insert it: immediately after the `.recent-events-expand:hover { text-decoration: underline; }` rule (currently the last base rule before the mobile media query).

- [ ] **Step 3: Verify**

```bash
grep -n "mobile-sort-bar\|mobile-sort-status\|mobile-sort-created" public/index.html
```

Expected: 3 hits — the `display: none` base rule, plus the two `<button>` tags in the HTML body.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat(mobile): add sort bar HTML and hide on desktop"
```

---

### Task 2: Mobile CSS + JS wiring

**Files:**
- Modify: `public/index.html` — append sort bar CSS inside existing `@media (max-width: 600px)` block (before its closing `}`)
- Modify: `public/dashboard.js` — add `MOBILE_SORT_BTNS` constant, extend `updateSortUI()`, add click handlers

**Interfaces:**
- Consumes: `id="mobile-sort-bar"`, `id="mobile-sort-status"`, `id="mobile-sort-created"` from Task 1; existing `sortState`, `updateSortUI()`, `savePrefs()`, `render()` from `dashboard.js`.

- [ ] **Step 1: Add mobile CSS**

In `public/index.html`, inside the `@media (max-width: 600px)` block (currently closing at `}` after line 370), append these rules before the closing `}`:

```css
      /* Mobile sort bar */
      #mobile-sort-bar {
        display: flex;
        gap: .4rem;
        width: 100%;
      }
      #mobile-sort-bar button {
        font-size: .75rem;
        padding: .2rem .55rem;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        background: var(--color-surface);
        color: var(--color-muted);
        cursor: pointer;
      }
      #mobile-sort-bar button.active {
        background: var(--color-link);
        color: #fff;
        border-color: var(--color-link);
      }
```

- [ ] **Step 2: Add `MOBILE_SORT_BTNS` constant to `dashboard.js`**

In `public/dashboard.js`, after the `sortCols` object (currently lines 156–161), add:

```js
const MOBILE_SORT_BTNS = {
  'mobile-sort-status':  'status',
  'mobile-sort-created': 'created',
};
```

- [ ] **Step 3: Extend `updateSortUI()` to sync mobile buttons**

`updateSortUI()` currently spans lines 163–173. Replace it entirely with:

```js
function updateSortUI() {
  for (const [id, col] of Object.entries(sortCols)) {
    const th = document.getElementById(id);
    const dir = th.querySelector('.sort-dir');
    if (sortState.col === col) {
      dir.textContent = sortState.dir === 'desc' ? ' ↓' : ' ↑';
    } else {
      dir.textContent = '';
    }
  }
  for (const [id, col] of Object.entries(MOBILE_SORT_BTNS)) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    const isActive = sortState.col === col;
    btn.classList.toggle('active', isActive);
    const label = col === 'status' ? 'Status' : 'Created';
    btn.textContent = isActive
      ? label + (sortState.dir === 'desc' ? ' ↓' : ' ↑')
      : label;
  }
}
```

- [ ] **Step 4: Add mobile sort click handlers**

In `public/dashboard.js`, after the existing desktop sort click-handler loop (currently lines 175–186), add:

```js
for (const [id, col] of Object.entries(MOBILE_SORT_BTNS)) {
  document.getElementById(id).addEventListener('click', () => {
    if (sortState.col === col) {
      sortState.dir = sortState.dir === 'desc' ? 'asc' : 'desc';
    } else {
      sortState = { col, dir: 'desc' };
    }
    updateSortUI();
    savePrefs();
    render();
  });
}
```

- [ ] **Step 5: Verify selectors and CSS**

```bash
grep -n "mobile-sort" public/index.html public/dashboard.js
```

Expected output includes:
- `index.html`: `display: none` base rule, `display: flex` mobile rule, `button.active` rule, two `<button>` tags
- `dashboard.js`: `MOBILE_SORT_BTNS` const, `updateSortUI` loop, click handler loop

- [ ] **Step 6: Manual test in DevTools**

Start the server: `node server.js`  
Open Chrome DevTools → iPhone 15 simulation (390px).

Verify:
- Header shows 3 rows: title row, seg-control row, sort bar row with "Status ↓" (blue, active by default since `sortState` defaults to `{ col: 'updated', dir: 'desc' }`) — actually Status should NOT be active on first load; "Updated" is the default sort, so both buttons should appear grey initially.
- Tap "Status" → button turns blue with "Status ↓", PR cards reorder by status priority.
- Tap "Status" again → arrow flips to "Status ↑", order reverses.
- Tap "Created" → "Created ↓" turns blue, "Status" goes grey, cards reorder by created date desc.
- Exit mobile simulation → sort bar is invisible on desktop; desktop sort headers still work normally.

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/dashboard.js
git commit -m "feat(mobile): sort by status and created on small screens"
```

---

## Self-Review

**Spec coverage:**
- ✅ Two buttons: Status and Created — Task 1 HTML + Task 2 CSS
- ✅ Active button: blue highlight + direction arrow — Task 2 CSS `.active` + JS `updateSortUI`
- ✅ Inactive button: surface background, muted, no arrow — Task 2 CSS base button style + JS
- ✅ Click active: toggle direction — Task 2 step 4 handler
- ✅ Click inactive: activate + desc — Task 2 step 4 handler
- ✅ `updateSortUI()` syncs mobile buttons — Task 2 step 3
- ✅ Hidden on desktop: `display: none` base rule — Task 1 step 2
- ✅ Shown on mobile: `display: flex` inside media query — Task 2 step 1

**Placeholder scan:** None found.

**Consistency:** `MOBILE_SORT_BTNS` keys (`mobile-sort-status`, `mobile-sort-created`) match the `id` attributes in Task 1 HTML exactly. Column values (`status`, `created`) match `SORTERS` keys in `dashboard.js`.
