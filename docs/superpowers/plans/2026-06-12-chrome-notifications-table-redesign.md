# Chrome Notifications + Table UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SSE-based Chrome push notifications for new PR comments (with on/off toggle) and redesign the PR table with Excel-style column-header filters/sorts plus new Author, PR#, Created, Updated columns.

**Architecture:** Server gains a `/api/events` SSE endpoint backed by a 5-minute background poll loop; when new comments are detected, all connected clients receive a push event and show a Chrome notification. The table replaces top-level `<select>` controls with in-header filter dropdowns and sort-arrow toggles.

**Tech Stack:** Node.js (ESM, no build tools), Web Notifications API, `EventSource`, `node:test` for tests.

---

### Task 1: Add `author` field to data model

**Files:**
- Modify: `public/shared.js`
- Modify: `test/shared.test.js`

- [ ] **Step 1: Write the failing test**

Add to `test/shared.test.js`, after the existing `parseGraphQLResponse` tests:

```js
test('parseGraphQLResponse includes author login', () => {
  const json = {
    data: {
      main: { nodes: [{
        number: 42, title: 'My PR', url: 'http://x/42',
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z',
        isDraft: false, state: 'OPEN', reviewDecision: null,
        author: { login: 'alice' },
        repository: { nameWithOwner: 'ACME/web' },
        comments: { totalCount: 0, nodes: [] },
        reviews: { totalCount: 0 },
        reviewThreads: { nodes: [] },
        commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
      }]},
      byAuthor: { nodes: [] }, byAssignee: { nodes: [] },
      byMention: { nodes: [] }, byCommenter: { nodes: [] },
    },
  };
  const prs = parseGraphQLResponse(json);
  assert.equal(prs[0].author, 'alice');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test test/shared.test.js
```

Expected: FAIL — `prs[0].author` is `undefined`.

- [ ] **Step 3: Add `author { login }` to PR_FIELDS in `public/shared.js`**

Find `PR_FIELDS` (around line 72). Change:
```js
const PR_FIELDS = `
  ... on PullRequest {
    id number title url createdAt updatedAt isDraft state reviewDecision
    repository { nameWithOwner }
```
To:
```js
const PR_FIELDS = `
  ... on PullRequest {
    id number title url createdAt updatedAt isDraft state reviewDecision
    author { login }
    repository { nameWithOwner }
```

- [ ] **Step 4: Expose `author` in `parseGraphQLResponse`**

In `parseGraphQLResponse`, in the `.map(n => ({...}))` block (around line 136), add after `updatedAt`:
```js
    author: n.author?.login ?? 'unknown',
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
node --test test/shared.test.js
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add public/shared.js test/shared.test.js
git commit -m "feat: add author field to PR data model"
```

---

### Task 2: SSE endpoint and background polling in server.js

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add client registry and poll state at the top of server.js**

After the `CONFIG` block (around line 17), add:

```js
// SSE clients and poll state
const sseClients = new Set();
let lastPollPrs = null; // Map<key, latestComment.createdAt> from previous poll
```

- [ ] **Step 2: Add SSE endpoint handler function**

Before the `createServer` call, add:

```js
function serveSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(':\n\n'); // initial heartbeat
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
}

function pushSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(payload);
}
```

- [ ] **Step 3: Add background poll loop**

After the SSE functions, add:

```js
async function pollForNewComments() {
  try {
    const prs = await fetchDashboard({
      token, scope: 'all', days: CONFIG.closedDays,
      user: CONFIG.user, org: CONFIG.org,
    });
    const currentMap = new Map(prs.map(pr => [pr.key, pr.latestComment?.createdAt ?? null]));
    if (lastPollPrs !== null) {
      for (const [key, createdAt] of currentMap) {
        const prev = lastPollPrs.get(key);
        if (createdAt && (!prev || createdAt > prev)) {
          const pr = prs.find(p => p.key === key);
          const snip = (pr.latestComment?.body ?? '').replace(/\s+/g, ' ').slice(0, 100);
          pushSSE('new-comment', {
            prTitle: pr.title,
            commentAuthor: pr.latestComment?.author ?? 'unknown',
            commentSnip: snip,
            prUrl: pr.url,
          });
        }
      }
    }
    lastPollPrs = currentMap;
  } catch (err) {
    console.error('[poll] error:', err.message);
  }
}
```

- [ ] **Step 4: Wire SSE route and start poll loop**

In the `createServer` callback (around line 66), add the SSE route before static:
```js
const server = createServer((req, res) => {
  if (req.url.startsWith('/api/events')) return serveSSE(req, res);
  if (req.url.startsWith('/api/prs')) return serveApi(req, res);
  return serveStatic(req, res);
});
```

After `server.listen(...)`, add:
```js
server.listen(CONFIG.port, () => {
  const addr = `http://localhost:${CONFIG.port}`;
  console.log(`pr-dashboard for ${CONFIG.user} @ ${CONFIG.org} → ${addr}`);
  pollForNewComments(); // seed baseline immediately
  setInterval(pollForNewComments, 5 * 60 * 1000);
});
```

- [ ] **Step 5: Manual smoke test**

```bash
node server.js &
curl -N http://localhost:4317/api/events
```

Expected: response stays open, prints `:` heartbeat, no error. Kill with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: add SSE endpoint and 5-minute background comment poll"
```

---

### Task 3: Chrome notification toggle on the client

**Files:**
- Modify: `public/index.html`
- Modify: `public/dashboard.js`

- [ ] **Step 1: Add notification toggle button to index.html**

In the `<div class="controls">` section, add before `<button id="markRead">`:
```html
<button id="notifyToggle">🔔 通知</button>
```

- [ ] **Step 2: Add notification styles to index.html**

In `<style>`, add:
```css
#notifyToggle.off { color: #656d76; }
```

- [ ] **Step 3: Add notification logic to dashboard.js**

Add the following block at the end of `dashboard.js` (before `load()`):

```js
// ── Chrome notifications via SSE ──────────────────────────────────────
const NOTIFY_KEY = 'pr-dashboard:notify';
const notifyToggle = document.getElementById('notifyToggle');
let evtSource = null;

function isNotifyOn() {
  return localStorage.getItem(NOTIFY_KEY) === 'on';
}

function applyNotifyUI() {
  if (isNotifyOn()) {
    notifyToggle.textContent = '🔔 通知';
    notifyToggle.classList.remove('off');
  } else {
    notifyToggle.textContent = '🔕 静默';
    notifyToggle.classList.add('off');
  }
}

function connectSSE() {
  if (evtSource) return;
  evtSource = new EventSource('/api/events');
  evtSource.addEventListener('new-comment', (e) => {
    if (!isNotifyOn()) return;
    const d = JSON.parse(e.data);
    const n = new Notification(`💬 ${d.commentAuthor} on ${d.prTitle}`, {
      body: d.commentSnip,
      tag: d.prUrl,
    });
    n.onclick = () => { window.open(d.prUrl, '_blank', 'noopener'); n.close(); };
  });
}

function disconnectSSE() {
  evtSource?.close();
  evtSource = null;
}

async function enableNotifications() {
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    localStorage.setItem(NOTIFY_KEY, 'on');
    connectSSE();
  } else {
    localStorage.setItem(NOTIFY_KEY, 'off');
  }
  applyNotifyUI();
}

notifyToggle.addEventListener('click', () => {
  if (isNotifyOn()) {
    localStorage.setItem(NOTIFY_KEY, 'off');
    disconnectSSE();
    applyNotifyUI();
  } else {
    enableNotifications();
  }
});

// Connect SSE on load if previously enabled and permission still granted
applyNotifyUI();
if (isNotifyOn() && Notification.permission === 'granted') connectSSE();
```

- [ ] **Step 4: Verify in browser**

Start the server, open http://localhost:4317, click `🔔 通知`. Browser should request notification permission. After granting, button stays `🔔 通知`. After denying, button switches to `🔕 静默`. Reload — preference is remembered.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/dashboard.js
git commit -m "feat: add Chrome notification toggle with SSE-driven push"
```

---

### Task 4: New table columns (Author, #, Created, Updated) + data wiring

**Files:**
- Modify: `public/index.html`
- Modify: `public/dashboard.js`

- [ ] **Step 1: Update table header in index.html**

Replace the existing `<thead>` row:
```html
<thead>
  <tr>
    <th></th>
    <th id="th-state">State <span class="th-arrow">▾</span></th>
    <th id="th-number" class="sortable">PR# <span class="sort-dir"></span></th>
    <th>Author</th>
    <th id="th-participation">Participation <span class="th-arrow">▾</span></th>
    <th>Review</th>
    <th>CI</th>
    <th id="th-created" class="sortable">Created <span class="sort-dir"></span></th>
    <th id="th-updated" class="sortable">Updated <span class="sort-dir"></span></th>
    <th>PR</th>
  </tr>
</thead>
```

- [ ] **Step 2: Add header and cell styles to index.html**

In `<style>`, add:
```css
th.sortable { cursor: pointer; user-select: none; }
th.sortable:hover { color: #1f2328; }
.sort-dir { font-size: .7rem; }
.th-filter-wrap { position: relative; display: inline-block; }
.th-arrow { cursor: pointer; font-size: .7rem; }
.th-dropdown { display: none; position: absolute; top: 100%; left: 0; z-index: 10;
  background: #fff; border: 1px solid #d0d7de; border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,.1); min-width: 140px; padding: .25rem 0; }
.th-dropdown.open { display: block; }
.th-dropdown label { display: flex; align-items: center; gap: .4rem;
  padding: .25rem .6rem; font-size: .8rem; cursor: pointer; }
.th-dropdown label:hover { background: #f6f8fa; }
.td-time { font-size: .75rem; color: #656d76; white-space: nowrap; }
.td-author { font-size: .8rem; }
```

- [ ] **Step 3: Add `formatTime` helper to dashboard.js**

Add near the top of `dashboard.js`, after the `SORTERS` block:

```js
function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${min}`;
}
```

- [ ] **Step 4: Add Author, #, Created, Updated to table rows in `render()`**

Replace the `tr.innerHTML` template in `render()`:

```js
tr.innerHTML = `
  <td>${isNew ? '<span class="dot new" title="new activity"></span>' : ''}</td>
  <td><span class="state state-${state}">${STATE[state]}</span></td>
  <td class="td-number">${pr.number}</td>
  <td class="td-author">${escapeHtml(pr.author)}</td>
  <td>${pr.labels.map(l => `<span class="tag">${PARTICIPATION[l]}</span>`).join('')}</td>
  <td class="review-${pr.review}">${REVIEW[pr.review]}</td>
  <td class="ci-${pr.ci}">${CI[pr.ci]}</td>
  <td class="td-time">${formatTime(pr.createdAt)}</td>
  <td class="td-time">${formatTime(pr.updatedAt)}</td>
  <td>
    <div>${escapeHtml(pr.title)}</div>
    <div class="repo">${pr.repo}</div>
    ${pr.labels.includes('author') ? authorInfo(pr) : ''}
  </td>`;
```

- [ ] **Step 5: Update `colspan` in the loading placeholder**

In `load()`, change:
```js
els.rows.innerHTML = '<tr><td colspan="10" class="muted">Loading…</td></tr>';
```

- [ ] **Step 6: Verify in browser**

Reload the dashboard. Check that Author, PR#, Created, Updated columns appear and show correct data.

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/dashboard.js
git commit -m "feat: add Author, PR#, Created, Updated columns to table"
```

---

### Task 5: Column-header sort controls

**Files:**
- Modify: `public/dashboard.js`

- [ ] **Step 1: Replace `SORTERS` and add sort state**

Replace the existing `SORTERS` object and `els.sort` references with:

```js
const SORTERS = {
  number:  { asc: (a, b) => a.number - b.number,           desc: (a, b) => b.number - a.number },
  created: { asc: (a, b) => new Date(a.createdAt) - new Date(b.createdAt), desc: (a, b) => new Date(b.createdAt) - new Date(a.createdAt) },
  updated: { asc: (a, b) => new Date(a.updatedAt) - new Date(b.updatedAt), desc: (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt) },
};

let sortState = { col: 'updated', dir: 'desc' }; // default
```

- [ ] **Step 2: Update `visiblePrs()` to use `sortState`**

Replace the existing `visiblePrs()` function. Also add stub `let` variables for the two filter helpers (they are assigned real implementations in Task 6 — using `let` so they can be reassigned without the duplicate-declaration error ES modules enforce):

```js
// Stubs reassigned in Task 6
let activeStateFilter = () => [];
let activeTypeFilter = () => 'all';

function visiblePrs() {
  const stateFilter = activeStateFilter();
  const typeFilter = activeTypeFilter();
  let filtered = allPrs;
  if (stateFilter.length) filtered = filtered.filter(pr => stateFilter.includes(prState(pr)));
  if (typeFilter !== 'all') filtered = filtered.filter(pr => pr.labels.includes(typeFilter));
  const sorter = SORTERS[sortState.col]?.[sortState.dir] ?? SORTERS.updated.desc;
  return [...filtered].sort(sorter);
}
```

- [ ] **Step 3: Wire sort click handlers**

Add after the `sortState` declaration:

```js
const sortCols = {
  'th-number':  'number',
  'th-created': 'created',
  'th-updated': 'updated',
};

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
}

for (const [id, col] of Object.entries(sortCols)) {
  document.getElementById(id).addEventListener('click', () => {
    if (sortState.col === col) {
      sortState.dir = sortState.dir === 'desc' ? 'asc' : 'desc';
    } else {
      sortState = { col, dir: 'desc' };
    }
    updateSortUI();
    render();
  });
}

updateSortUI();
```

- [ ] **Step 4: Remove old `els.sort` listener** (the `els.sort.addEventListener('change', render)` line near the bottom of the file).

- [ ] **Step 5: Verify in browser**

Click `PR#`, `Created`, `Updated` headers — arrow toggles ↓/↑ and rows reorder correctly.

- [ ] **Step 6: Commit**

```bash
git add public/dashboard.js
git commit -m "feat: add sortable column headers for PR#, Created, Updated"
```

---

### Task 6: Column-header filter dropdowns (State, Participation) + cleanup

**Files:**
- Modify: `public/index.html`
- Modify: `public/dashboard.js`

- [ ] **Step 1: Add filter dropdown markup to index.html**

Replace the `<th id="th-state">` and `<th id="th-participation">` headers with dropdown wrappers:

```html
<th>
  <div class="th-filter-wrap">
    State <span class="th-arrow" id="state-arrow">▾</span>
    <div class="th-dropdown" id="state-dropdown">
      <label><input type="checkbox" value="open" checked> Open</label>
      <label><input type="checkbox" value="draft"> Draft</label>
      <label><input type="checkbox" value="closed"> Closed</label>
      <label><input type="checkbox" value="merged"> Merged</label>
    </div>
  </div>
</th>
```

```html
<th>
  <div class="th-filter-wrap">
    Participation <span class="th-arrow" id="participation-arrow">▾</span>
    <div class="th-dropdown" id="participation-dropdown">
      <label><input type="radio" name="ptype" value="all" checked> All</label>
      <label><input type="radio" name="ptype" value="author"> Author</label>
      <label><input type="radio" name="ptype" value="assignee"> Assignee</label>
      <label><input type="radio" name="ptype" value="mention"> Mention</label>
      <label><input type="radio" name="ptype" value="commenter"> Commenter</label>
    </div>
  </div>
</th>
```

- [ ] **Step 2: Remove old top-level `<select>` elements from index.html**

Delete these three lines from the `<div class="controls">`:
```html
<select id="type">…</select>
<select id="scope">…</select>
<select id="sort">…</select>
```

- [ ] **Step 3: Remove stale `els` references in dashboard.js**

Remove `scope`, `type`, `sort` from the `els` object at the top. Remove their event listeners at the bottom (`els.scope.addEventListener`, `els.type.addEventListener`, `els.sort.addEventListener`).

- [ ] **Step 4: Implement filter dropdown toggle logic in dashboard.js**

Add:

```js
function setupDropdown(arrowId, dropdownId) {
  const arrow = document.getElementById(arrowId);
  const menu = document.getElementById(dropdownId);
  arrow.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) menu.classList.remove('open');
  });
}

setupDropdown('state-arrow', 'state-dropdown');
setupDropdown('participation-arrow', 'participation-dropdown');
```

- [ ] **Step 5: Implement `activeStateFilter` and `activeTypeFilter` (reassign stubs from Task 5)**

```js
activeStateFilter = () => {
  const checked = [...document.querySelectorAll('#state-dropdown input:checked')];
  return checked.map(i => i.value);
};

activeTypeFilter = () => {
  const checked = document.querySelector('#participation-dropdown input:checked');
  return checked?.value ?? 'all';
};
```

- [ ] **Step 6: Wire state filter to re-fetch when closed/merged selected**

After `setupDropdown` calls, add:

```js
let currentScope = 'open';

document.getElementById('state-dropdown').addEventListener('change', () => {
  const selected = activeStateFilter();
  const needAll = selected.some(s => s === 'closed' || s === 'merged');
  const newScope = needAll ? 'all' : 'open';
  if (newScope !== currentScope) {
    currentScope = newScope;
    load();
  } else {
    render();
  }
});

document.getElementById('participation-dropdown').addEventListener('change', render);
```

- [ ] **Step 7: Update `load()` to use `currentScope` instead of `els.scope.value`**

In `load()`, change:
```js
const res = await fetch(`/api/prs?scope=${currentScope}`);
```

- [ ] **Step 8: Verify in browser end-to-end**

- Open dashboard. State dropdown shows only "Open" checked by default, rows show open PRs.
- Check "Closed" — page re-fetches with `scope=all`, closed PRs appear.
- Uncheck "Closed" — page re-fetches with `scope=open`.
- Participation dropdown filters without re-fetching.
- Sort arrows on PR#/Created/Updated still work.

- [ ] **Step 9: Commit**

```bash
git add public/index.html public/dashboard.js
git commit -m "feat: column-header filter dropdowns for State and Participation"
```

---

### Task 7: One-click launch (auto-open browser on start)

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Import `child_process` at the top of server.js**

Add after the existing imports:
```js
import { exec } from 'node:child_process';
```

- [ ] **Step 2: Auto-open browser after server starts**

In the `server.listen` callback, add after the `console.log`:
```js
server.listen(CONFIG.port, () => {
  const addr = `http://localhost:${CONFIG.port}`;
  console.log(`pr-dashboard for ${CONFIG.user} @ ${CONFIG.org} → ${addr}`);
  exec(`open ${addr}`); // macOS: open in default browser
  pollForNewComments();
  setInterval(pollForNewComments, 5 * 60 * 1000);
});
```

- [ ] **Step 3: Verify**

```bash
npm start
```

Expected: terminal prints the URL and the browser opens automatically.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: auto-open browser on npm start"
```
