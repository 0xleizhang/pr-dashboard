# Dark Mode Design

**Date:** 2026-06-19  
**Status:** Approved

## Overview

Add a three-state dark mode toggle to the PR Dashboard that respects the user's system preference by default, allows manual override, and persists the choice across sessions via `localStorage`.

## States

| State | `localStorage` value | Visual effect |
|---|---|---|
| Auto (default) | not set | Follows `prefers-color-scheme` media query |
| Dark | `"dark"` | Forces dark theme regardless of system |
| Light | `"light"` | Forces light theme regardless of system |

Cycle order on button click: **Auto → Dark → Light → Auto**

## Architecture

### HTML

- `<html>` element carries a `data-theme` attribute: `"dark"` or `"light"` when manually set, absent when auto.
- A new `<button id="theme-toggle">` is added to the header `.controls` (leftmost position), styled identically to existing buttons. It displays the current state icon + label: `💻 Auto`, `🌙 Dark`, `☀️ Light`.

### CSS (in `index.html` `<style>`)

Define ~18 semantic CSS custom properties on `:root` (light values by default):

```css
:root {
  --color-bg: #ffffff;
  --color-fg: #1f2328;
  --color-muted: #656d76;
  --color-border: #d0d7de;
  --color-border-subtle: #eaeef2;
  --color-surface: #f6f8fa;
  --color-surface-2: #eaeef2;
  --color-link: #0969da;
  --color-link-hover-bg: #f6f8fa;
  --color-error-bg: #ffebe9;
  --color-error-border: #ff818266;
  --color-ci-pass: #1a7f37;
  --color-ci-fail: #cf222e;
  --color-ci-pending: #9a6700;
  --color-state-open-bg: #dafbe1;
  --color-state-open-fg: #1a7f37;
  --color-state-draft-bg: #eaeef2;
  --color-state-draft-fg: #656d76;
  --color-state-closed-bg: #ffebe9;
  --color-state-closed-fg: #cf222e;
  --color-state-merged-bg: #fbefff;
  --color-state-merged-fg: #8250df;
  --color-owners-pending-bg: #fff8c5;
  --color-owners-pending-border: #e3b341;
  --color-owners-ok-bg: #dafbe1;
  --color-owners-ok-border: #2da44e;
  --color-resizer-hover: #0969da33;
  --color-review-approved: #1a7f37;
  --color-review-changes: #cf222e;
  --color-dialog-shadow: rgba(0,0,0,.15);
  --color-backdrop: rgba(0,0,0,.3);
  --color-slider-bg: #d0d7de;
  --color-warn: #9a6700;
  --color-new-dot: #0969da;
  --color-time: #8c959f;
}
```

Dark values override via two selectors (covers both manual and system-auto):

```css
[data-theme="dark"],
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-bg: #0d1117;
    --color-fg: #e6edf3;
    /* ... all overrides ... */
  }
}
```

All existing hard-coded color values in selectors are replaced with their corresponding variable.

### JS (in `dashboard.js` or a small inline `<script>` in `<head>`)

**FOUC prevention** — a tiny inline script runs synchronously in `<head>` before any paint:

```html
<script>
  const t = localStorage.getItem('theme');
  if (t) document.documentElement.setAttribute('data-theme', t);
</script>
```

**Toggle logic** in `dashboard.js`:

```js
const STATES = ['auto', 'dark', 'light'];
const LABELS = { auto: '💻 Auto', dark: '🌙 Dark', light: '☀️ Light' };

function getThemeState() {
  return localStorage.getItem('theme') ?? 'auto';
}

function applyTheme(state) {
  if (state === 'auto') {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem('theme');
  } else {
    document.documentElement.setAttribute('data-theme', state);
    localStorage.setItem('theme', state);
  }
  document.getElementById('theme-toggle').textContent = LABELS[state];
}

document.getElementById('theme-toggle').addEventListener('click', () => {
  const next = STATES[(STATES.indexOf(getThemeState()) + 1) % STATES.length];
  applyTheme(next);
});

// Initialize button label on load
applyTheme(getThemeState());
```

## Files Changed

| File | Change |
|---|---|
| `public/index.html` | Add CSS variables, replace ~40 hard-coded color values, add FOUC-prevention inline script, add theme-toggle button |
| `public/dashboard.js` | Add theme toggle logic (~20 lines) |

## Non-Goals

- No transition animations between themes (can be added later with `transition: background .2s, color .2s` on `body`)
- No per-component theming beyond the variable set above
- No server-side preference storage
