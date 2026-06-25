# Mobile Adaptation Design — PR Dashboard

**Date:** 2026-06-25  
**Target device:** iPhone 15 (390px viewport width)  
**Scope:** Responsive CSS + minimal JS class additions; no framework introduced.

---

## Goals

- The app is usable on iPhone 15 with no horizontal overflow.
- Users can browse PR cards, switch Author/Involved/All mode, and open the review dialog.
- Desktop experience is completely unchanged.

## Non-Goals

- Filtering by state, created/updated date, or participation on mobile (desktop-only).
- Column reordering / resizing on mobile.
- Settings dialog fully usable on mobile (accessible but not optimized).

---

## 1. Breakpoint

Single breakpoint: `@media (max-width: 600px)`.  
All mobile overrides live inside this block in `public/index.html`.

---

## 2. Header

**Desktop (unchanged):** single row — `h1 | subtitle | seg-control | days-select | refresh | ⚙️`

**Mobile:**
- Row 1: `h1` (left) + `#subtitle` (right, small muted text)
- Row 2: `#me-seg` seg-control, full-width, centered
- Hidden: `#days-select`, `#refresh`, `#settings-btn`
- `body` padding reduced from `1.5rem` to `.75rem`

Implementation: `header { flex-wrap: wrap }`, `#days-select, #refresh, #settings-btn { display: none }`, `#me-seg { width: 100%; justify-content: center }`.

---

## 3. Table → Card List

### CSS transformation

```
table, tbody  → display: block
thead         → display: none
tr.pr         → display: flex; flex-wrap: wrap; border: 1px solid var(--color-border);
                border-radius: 8px; margin-bottom: .75rem; padding: .75rem; gap: .3rem
td            → display: block; overflow: visible; white-space: normal
```

### Card layout (flex ordering)

| Element | CSS class | Mobile order | Visible |
|---|---|---|---|
| PR title td (last td) | — | `order: 0; width: 100%` | yes |
| State td | `td-state` | `order: 1` | yes |
| Status td | `td-status` | `order: 2` | yes |
| Author td | `td-author` | `order: 3` | yes |
| Updated td | `td-updated` | `order: 4` | yes |
| Dot td | `td-dot` | — | `display: none` |
| Participation td | `td-participation` | — | `display: none` |
| Created td | `td-created` | — | `display: none` |

Visual result:
```
┌──────────────────────────────────────┐
│ Fix the auth bug in login flow        │
│ #1234 · my-org/my-repo               │
│ [JIRA-123]  [label]                   │
│                                      │
│ [open]  ✅ approved  @alice  2h ago  │
└──────────────────────────────────────┘
```

State, status, author, updated form a flex row with `flex-wrap: wrap; gap: .4rem; align-items: center`.

### JS changes (minimal)

Add semantic classes to `td` elements in `COL_RENDERERS` and the dot cell in `render()`:

- Col 1 (State): add `td-state`
- Col 4 (Participation): add `td-participation`
- Col 7 (Created): add `td-created` (already has `td-time`)
- Dot cell: add `td-dot`
- Col 8 (Updated) and Col 3 (Author) already have `td-updated`/`td-time` and `td-author` — rename `td-time` on col 8 to `td-updated` for specificity.

Total JS diff: ~4 lines in `COL_RENDERERS` + 1 line in `render()`.

---

## 4. Dialogs

| Property | Desktop | Mobile |
|---|---|---|
| `min-width` | `360px` | `auto` |
| `width` | `90vw` | `95vw` |
| `max-height` | `88vh` | `92vh` |
| `padding` | `1.4rem 1.8rem` | `.9rem 1rem` |

**Review dialog toolbar** (3 toggle switches in a row):
- Desktop: horizontal flex row
- Mobile: `flex-direction: column; gap: .5rem`

---

## 5. Filter bar

`#filter-bar-wrap`:
- Desktop: single row, chips + "Mark all read" button at right
- Mobile: `flex-direction: column; align-items: flex-start` — chips on first line, button on second line

---

## Files Changed

| File | Type of change |
|---|---|
| `public/index.html` | Add `@media (max-width: 600px)` block with all mobile CSS |
| `public/dashboard.js` | Add class names to 5 `td` elements (~5 line diff) |
