# Mobile Sort Control Design

**Date:** 2026-06-25  
**Scope:** Add Status and Created sort buttons to the mobile card layout. Desktop unchanged.

---

## Goal

On mobile (≤ 600px), the table `<thead>` is hidden, so existing sort-by-column-header functionality is inaccessible. This feature adds two sort buttons — **Status** and **Created** — visible only on mobile, wired to the existing `sortState` and `render()` logic.

---

## UI

A `#mobile-sort-bar` div is added inside `<header>` in `index.html`, below the seg-control row. It contains two `<button>` elements.

```
[Author] [Involved] [All]        ← existing seg-control (full width)
[Status ↓]  [Created]            ← new mobile-sort-bar (visible mobile only)
```

**Button states:**
- **Active sort column:** blue background (same as `.seg-btn.active`), shows direction arrow (↓ desc, ↑ asc)
- **Inactive column:** surface background, no arrow, muted text
- **Click active button:** toggle direction (desc → asc → desc)
- **Click inactive button:** make it active, set direction to `desc`

---

## Implementation

### HTML (`public/index.html`)

Add inside `<header>`, after `<div class="controls">`:

```html
<div id="mobile-sort-bar">
  <button id="mobile-sort-status">Status</button>
  <button id="mobile-sort-created">Created</button>
</div>
```

### CSS (`public/index.html` — inside `@media (max-width: 600px)`)

```css
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

On desktop, `#mobile-sort-bar` defaults to `display: none` (set in base styles).

### JS (`public/dashboard.js`)

**1. Hide bar on desktop (base style):** Add `display: none` to `#mobile-sort-bar` in base CSS (outside media query), shown only inside `@media (max-width: 600px)`.

**2. Extend `updateSortUI()`:** After the existing loop over `sortCols`, update the two mobile buttons:

```js
const MOBILE_SORT_BTNS = {
  'mobile-sort-status':  'status',
  'mobile-sort-created': 'created',
};
for (const [id, col] of Object.entries(MOBILE_SORT_BTNS)) {
  const btn = document.getElementById(id);
  if (!btn) continue;
  const isActive = sortState.col === col;
  btn.classList.toggle('active', isActive);
  btn.textContent = (col === 'status' ? 'Status' : 'Created') +
    (isActive ? (sortState.dir === 'desc' ? ' ↓' : ' ↑') : '');
}
```

**3. Click handlers:** Wire up after existing sort handlers:

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

---

## Files Changed

| File | Change |
|---|---|
| `public/index.html` | Add `#mobile-sort-bar` HTML; add `display: none` base rule; add mobile CSS inside media query |
| `public/dashboard.js` | Extend `updateSortUI()` + add click handlers (~15 lines) |
