# pr-dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local, `npx`-runnable web dashboard that shows only the GitHub PRs the user truly participates in (author / assignee / mention / commenter), with review, CI, and unread-activity status at a glance.

**Architecture:** A zero-dependency Node server (`server.js`) resolves a GitHub token, queries the GitHub GraphQL API (one request with 5 aliased searches), normalizes the result, and serves a vanilla-JS page. All pure logic lives in `public/shared.js`, imported by both the server and the browser so there is no duplication. "Unread" state is kept in browser `localStorage`.

**Tech Stack:** Node 18+ (built-in `http`, `fetch`, `node:child_process`, `node:test`), ES modules, vanilla HTML/JS. No npm runtime dependencies, no build step.

---

## File Structure

```
pr-dashboard/
├─ package.json            # type:module, bin: pr-dashboard → server.js, test script
├─ server.js               # http server: routes, static serving, /api/prs handler
├─ lib/
│  ├─ token.js             # resolveToken(): env → gh CLI → throw
│  └─ github.js            # fetchDashboard(): GraphQL fetch + normalize (injectable fetch)
├─ public/
│  ├─ shared.js            # env-agnostic pure fns (imported by server, browser, tests)
│  ├─ dashboard.js         # browser: fetch /api/prs, render, localStorage unread
│  └─ index.html           # page shell, loads dashboard.js as module
├─ test/
│  ├─ shared.test.js       # unit tests for pure fns
│  ├─ token.test.js        # unit tests for token resolution
│  └─ github.test.js       # unit tests for fetchDashboard with mock fetch
└─ docs/superpowers/...    # spec + this plan
```

**Config constants** (defined once in `server.js`, overridable via env):
- `GH_USER` default `0xleizhang`
- `GH_ORG` default `UrbanCompass`
- `PORT` default `4317`
- `CLOSED_DAYS` default `7` (lookback window for scope=all)

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "pr-dashboard",
  "version": "0.1.0",
  "description": "Local dashboard for GitHub PRs you truly participate in",
  "type": "module",
  "bin": { "pr-dashboard": "./server.js" },
  "scripts": {
    "start": "node server.js",
    "test": "node --test"
  },
  "engines": { "node": ">=18" },
  "files": ["server.js", "lib", "public"]
}
```

- [ ] **Step 2: Verify Node version and test runner work**

Run: `node --version && node --test`
Expected: Node v18+; test run reports `tests 0` (no tests yet) and exits 0.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: scaffold pr-dashboard package"
```

---

## Task 2: Review & CI status mapping (shared.js)

**Files:**
- Create: `public/shared.js`
- Test: `test/shared.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/shared.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapReviewStatus, mapCIStatus } from '../public/shared.js';

test('mapReviewStatus: approved', () => {
  assert.equal(mapReviewStatus({ reviewDecision: 'APPROVED' }), 'approved');
});
test('mapReviewStatus: changes requested', () => {
  assert.equal(mapReviewStatus({ reviewDecision: 'CHANGES_REQUESTED' }), 'changes_requested');
});
test('mapReviewStatus: commented when reviews or comments exist', () => {
  assert.equal(mapReviewStatus({ reviewDecision: null, reviews: { totalCount: 2 }, comments: { totalCount: 0 } }), 'commented');
  assert.equal(mapReviewStatus({ reviewDecision: null, reviews: { totalCount: 0 }, comments: { totalCount: 3 } }), 'commented');
});
test('mapReviewStatus: none when no review activity', () => {
  assert.equal(mapReviewStatus({ reviewDecision: null, reviews: { totalCount: 0 }, comments: { totalCount: 0 } }), 'none');
  assert.equal(mapReviewStatus({}), 'none');
});

test('mapCIStatus mapping', () => {
  assert.equal(mapCIStatus('SUCCESS'), 'pass');
  assert.equal(mapCIStatus('FAILURE'), 'fail');
  assert.equal(mapCIStatus('ERROR'), 'fail');
  assert.equal(mapCIStatus('PENDING'), 'pending');
  assert.equal(mapCIStatus('EXPECTED'), 'pending');
  assert.equal(mapCIStatus(null), 'unknown');
  assert.equal(mapCIStatus(undefined), 'unknown');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/shared.test.js`
Expected: FAIL — cannot find module `../public/shared.js` / exports undefined.

- [ ] **Step 3: Write minimal implementation**

```js
// public/shared.js
export function mapReviewStatus(pr) {
  if (pr.reviewDecision === 'APPROVED') return 'approved';
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes_requested';
  const reviews = pr.reviews?.totalCount ?? 0;
  const comments = pr.comments?.totalCount ?? 0;
  if (reviews > 0 || comments > 0) return 'commented';
  return 'none';
}

export function mapCIStatus(rollupState) {
  switch (rollupState) {
    case 'SUCCESS': return 'pass';
    case 'FAILURE':
    case 'ERROR': return 'fail';
    case 'PENDING':
    case 'EXPECTED': return 'pending';
    default: return 'unknown';
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/shared.test.js`
Expected: PASS (8 assertions across tests).

- [ ] **Step 5: Commit**

```bash
git add public/shared.js test/shared.test.js
git commit -m "feat: add review and CI status mapping"
```

---

## Task 3: Unread-activity helper (shared.js)

**Files:**
- Modify: `public/shared.js`
- Test: `test/shared.test.js`

- [ ] **Step 1: Add the failing tests**

Append to `test/shared.test.js`:

```js
import { isNewActivity } from '../public/shared.js';

test('isNewActivity: true when never seen', () => {
  assert.equal(isNewActivity(undefined, '2026-06-12T00:00:00Z'), true);
  assert.equal(isNewActivity(null, '2026-06-12T00:00:00Z'), true);
});
test('isNewActivity: true when updated after last seen', () => {
  assert.equal(isNewActivity('2026-06-11T00:00:00Z', '2026-06-12T00:00:00Z'), true);
});
test('isNewActivity: false when not updated since last seen', () => {
  assert.equal(isNewActivity('2026-06-12T00:00:00Z', '2026-06-12T00:00:00Z'), false);
  assert.equal(isNewActivity('2026-06-13T00:00:00Z', '2026-06-12T00:00:00Z'), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/shared.test.js`
Expected: FAIL — `isNewActivity` is not exported.

- [ ] **Step 3: Add implementation to public/shared.js**

```js
export function isNewActivity(lastSeen, updatedAt) {
  if (!lastSeen) return true;
  return new Date(updatedAt).getTime() > new Date(lastSeen).getTime();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/shared.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/shared.js test/shared.test.js
git commit -m "feat: add unread-activity helper"
```

---

## Task 4: Search query builders (shared.js)

**Files:**
- Modify: `public/shared.js`
- Test: `test/shared.test.js`

- [ ] **Step 1: Add the failing tests**

Append to `test/shared.test.js`:

```js
import { daysAgoISO, buildSearchQuery } from '../public/shared.js';

const NOW = new Date('2026-06-12T00:00:00Z');

test('daysAgoISO returns YYYY-MM-DD N days before now', () => {
  assert.equal(daysAgoISO(7, NOW), '2026-06-05');
});

test('buildSearchQuery open scope', () => {
  assert.equal(
    buildSearchQuery({ user: 'me', org: 'ACME', scope: 'open', qualifier: 'involves', now: NOW }),
    'is:pr involves:me org:ACME is:open'
  );
});

test('buildSearchQuery all scope adds updated lookback', () => {
  assert.equal(
    buildSearchQuery({ user: 'me', org: 'ACME', scope: 'all', days: 7, qualifier: 'author', now: NOW }),
    'is:pr author:me org:ACME updated:>=2026-06-05'
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/shared.test.js`
Expected: FAIL — `daysAgoISO` / `buildSearchQuery` not exported.

- [ ] **Step 3: Add implementation to public/shared.js**

```js
export function daysAgoISO(days, now = new Date()) {
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export function buildSearchQuery({ user, org, scope, days = 7, qualifier, now = new Date() }) {
  const parts = ['is:pr', `${qualifier}:${user}`, `org:${org}`];
  if (scope === 'open') parts.push('is:open');
  else parts.push(`updated:>=${daysAgoISO(days, now)}`);
  return parts.join(' ');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/shared.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/shared.js test/shared.test.js
git commit -m "feat: add GitHub search query builders"
```

---

## Task 5: GraphQL query assembly (shared.js)

**Files:**
- Modify: `public/shared.js`
- Test: `test/shared.test.js`

- [ ] **Step 1: Add the failing tests**

Append to `test/shared.test.js`:

```js
import { buildGraphQLQuery } from '../public/shared.js';

test('buildGraphQLQuery includes all 5 aliased searches and PR fields', () => {
  const q = buildGraphQLQuery({ user: 'me', org: 'ACME', scope: 'open', now: NOW });
  for (const alias of ['main:', 'byAuthor:', 'byAssignee:', 'byMention:', 'byCommenter:']) {
    assert.ok(q.includes(alias), `missing alias ${alias}`);
  }
  assert.ok(q.includes('involves:me'), 'main uses involves');
  assert.ok(q.includes('mentions:me'), 'mention alias uses mentions qualifier');
  assert.ok(q.includes('reviewDecision'), 'requests reviewDecision');
  assert.ok(q.includes('statusCheckRollup'), 'requests CI rollup');
  assert.ok(q.includes('first: 50'), 'paginates at 50');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/shared.test.js`
Expected: FAIL — `buildGraphQLQuery` not exported.

- [ ] **Step 3: Add implementation to public/shared.js**

```js
const PR_FIELDS = `
  ... on PullRequest {
    number title url updatedAt isDraft state reviewDecision
    repository { nameWithOwner }
    comments { totalCount }
    reviews { totalCount }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  }`;

const KEY_FIELDS = `... on PullRequest { number repository { nameWithOwner } }`;

export function buildGraphQLQuery({ user, org, scope, days = 7, now = new Date() }) {
  const search = (qualifier, fields) =>
    `search(query: ${JSON.stringify(buildSearchQuery({ user, org, scope, days, qualifier, now }))}, type: ISSUE, first: 50) { nodes { ${fields} } }`;
  return `query {
    main: ${search('involves', PR_FIELDS)}
    byAuthor: ${search('author', KEY_FIELDS)}
    byAssignee: ${search('assignee', KEY_FIELDS)}
    byMention: ${search('mentions', KEY_FIELDS)}
    byCommenter: ${search('commenter', KEY_FIELDS)}
  }`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/shared.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/shared.js test/shared.test.js
git commit -m "feat: assemble GraphQL query with aliased searches"
```

---

## Task 6: Response parsing & label merge (shared.js)

**Files:**
- Modify: `public/shared.js`
- Test: `test/shared.test.js`

- [ ] **Step 1: Add the failing tests**

Append to `test/shared.test.js`:

```js
import { parseGraphQLResponse } from '../public/shared.js';

test('parseGraphQLResponse normalizes PRs and merges participation labels', () => {
  const json = {
    data: {
      main: { nodes: [
        { number: 1, title: 'Fix bug', url: 'http://x/1', updatedAt: '2026-06-12T00:00:00Z',
          isDraft: false, state: 'OPEN', reviewDecision: 'APPROVED',
          repository: { nameWithOwner: 'ACME/web' },
          comments: { totalCount: 0 }, reviews: { totalCount: 1 },
          commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] } },
        { number: 2, title: 'Add feature', url: 'http://x/2', updatedAt: '2026-06-11T00:00:00Z',
          isDraft: true, state: 'OPEN', reviewDecision: null,
          repository: { nameWithOwner: 'ACME/api' },
          comments: { totalCount: 0 }, reviews: { totalCount: 0 },
          commits: { nodes: [] } },
      ]},
      byAuthor:    { nodes: [{ number: 1, repository: { nameWithOwner: 'ACME/web' } }] },
      byAssignee:  { nodes: [{ number: 2, repository: { nameWithOwner: 'ACME/api' } }] },
      byMention:   { nodes: [{ number: 1, repository: { nameWithOwner: 'ACME/web' } }] },
      byCommenter: { nodes: [] },
    },
  };
  const prs = parseGraphQLResponse(json);
  assert.equal(prs.length, 2);

  const pr1 = prs.find(p => p.number === 1);
  assert.equal(pr1.key, 'ACME/web#1');
  assert.equal(pr1.repo, 'ACME/web');
  assert.equal(pr1.review, 'approved');
  assert.equal(pr1.ci, 'pass');
  assert.deepEqual(pr1.labels.sort(), ['author', 'mention']);

  const pr2 = prs.find(p => p.number === 2);
  assert.equal(pr2.ci, 'unknown');
  assert.equal(pr2.review, 'none');
  assert.deepEqual(pr2.labels, ['assignee']);
});

test('parseGraphQLResponse tolerates null nodes', () => {
  const json = { data: { main: { nodes: [null] }, byAuthor: { nodes: [] },
    byAssignee: { nodes: [] }, byMention: { nodes: [] }, byCommenter: { nodes: [] } } };
  assert.deepEqual(parseGraphQLResponse(json), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/shared.test.js`
Expected: FAIL — `parseGraphQLResponse` not exported.

- [ ] **Step 3: Add implementation to public/shared.js**

```js
function prKey(node) {
  return `${node.repository.nameWithOwner}#${node.number}`;
}

export function mergeLabels(prs, labelSets) {
  return prs.map(pr => {
    const labels = [];
    for (const [label, keys] of Object.entries(labelSets)) {
      if (keys.has(pr.key)) labels.push(label);
    }
    return { ...pr, labels };
  });
}

export function parseGraphQLResponse(json) {
  const data = json.data || {};
  const nodes = (alias) => (data[alias]?.nodes || []).filter(n => n && n.number);

  const prs = nodes('main').map(n => ({
    key: prKey(n),
    number: n.number,
    title: n.title,
    url: n.url,
    repo: n.repository.nameWithOwner,
    updatedAt: n.updatedAt,
    isDraft: n.isDraft,
    state: n.state,
    review: mapReviewStatus(n),
    ci: mapCIStatus(n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state),
  }));

  const setOf = (alias) => new Set(nodes(alias).map(prKey));
  const labelSets = {
    author: setOf('byAuthor'),
    assignee: setOf('byAssignee'),
    mention: setOf('byMention'),
    commenter: setOf('byCommenter'),
  };
  return mergeLabels(prs, labelSets);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/shared.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/shared.js test/shared.test.js
git commit -m "feat: parse GraphQL response and merge participation labels"
```

---

## Task 7: Token resolution (lib/token.js)

**Files:**
- Create: `lib/token.js`
- Test: `test/token.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/token.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveToken } from '../lib/token.js';

test('resolveToken: prefers GITHUB_TOKEN env', () => {
  const t = resolveToken({ env: { GITHUB_TOKEN: 'env-tok' }, runGh: () => 'gh-tok' });
  assert.equal(t, 'env-tok');
});
test('resolveToken: trims env token', () => {
  assert.equal(resolveToken({ env: { GITHUB_TOKEN: '  spaced  ' }, runGh: () => '' }), 'spaced');
});
test('resolveToken: falls back to gh CLI', () => {
  const t = resolveToken({ env: {}, runGh: () => 'gh-tok\n' });
  assert.equal(t, 'gh-tok');
});
test('resolveToken: throws helpful error when none available', () => {
  assert.throws(
    () => resolveToken({ env: {}, runGh: () => { throw new Error('gh not found'); } }),
    /No GitHub token/
  );
});
test('resolveToken: throws when gh returns empty', () => {
  assert.throws(() => resolveToken({ env: {}, runGh: () => '   ' }), /No GitHub token/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/token.test.js`
Expected: FAIL — cannot find `../lib/token.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/token.js
import { execFileSync } from 'node:child_process';

function defaultRunGh() {
  return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' });
}

export function resolveToken({ env = process.env, runGh = defaultRunGh } = {}) {
  const envTok = (env.GITHUB_TOKEN || '').trim();
  if (envTok) return envTok;
  try {
    const ghTok = (runGh() || '').trim();
    if (ghTok) return ghTok;
  } catch {
    // fall through to error below
  }
  throw new Error(
    'No GitHub token found. Set GITHUB_TOKEN, or run `gh auth login` so `gh auth token` works.'
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/token.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/token.js test/token.test.js
git commit -m "feat: add GitHub token resolution"
```

---

## Task 8: GitHub fetch wrapper (lib/github.js)

**Files:**
- Create: `lib/github.js`
- Test: `test/github.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// test/github.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchDashboard } from '../lib/github.js';

function mockFetch(responder) {
  return async (url, opts) => responder(url, opts);
}

const okBody = {
  data: {
    main: { nodes: [
      { number: 1, title: 'T', url: 'http://x/1', updatedAt: '2026-06-12T00:00:00Z',
        isDraft: false, state: 'OPEN', reviewDecision: 'APPROVED',
        repository: { nameWithOwner: 'ACME/web' },
        comments: { totalCount: 0 }, reviews: { totalCount: 1 },
        commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] } },
    ]},
    byAuthor: { nodes: [{ number: 1, repository: { nameWithOwner: 'ACME/web' } }] },
    byAssignee: { nodes: [] }, byMention: { nodes: [] }, byCommenter: { nodes: [] },
  },
};

test('fetchDashboard posts a GraphQL query with bearer token and returns parsed PRs', async () => {
  let captured;
  const fetchImpl = mockFetch(async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 200, json: async () => okBody };
  });
  const prs = await fetchDashboard({
    token: 'tok', scope: 'open', user: 'me', org: 'ACME',
    now: new Date('2026-06-12T00:00:00Z'), fetchImpl,
  });
  assert.equal(captured.url, 'https://api.github.com/graphql');
  assert.equal(captured.opts.method, 'POST');
  assert.equal(captured.opts.headers.Authorization, 'bearer tok');
  assert.ok(JSON.parse(captured.opts.body).query.includes('involves:me'));
  assert.equal(prs.length, 1);
  assert.deepEqual(prs[0].labels, ['author']);
});

test('fetchDashboard throws on non-ok HTTP', async () => {
  const fetchImpl = mockFetch(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  await assert.rejects(
    () => fetchDashboard({ token: 't', scope: 'open', user: 'm', org: 'O', fetchImpl }),
    /401/
  );
});

test('fetchDashboard throws on GraphQL errors', async () => {
  const fetchImpl = mockFetch(async () => ({ ok: true, status: 200,
    json: async () => ({ errors: [{ message: 'bad query' }] }) }));
  await assert.rejects(
    () => fetchDashboard({ token: 't', scope: 'open', user: 'm', org: 'O', fetchImpl }),
    /bad query/
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/github.test.js`
Expected: FAIL — cannot find `../lib/github.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/github.js
import { buildGraphQLQuery, parseGraphQLResponse } from '../public/shared.js';

export async function fetchDashboard({
  token, scope, days = 7, user, org, now = new Date(), fetchImpl = fetch,
}) {
  const query = buildGraphQLQuery({ user, org, scope, days, now });
  const res = await fetchImpl('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'pr-dashboard',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error(`GitHub API returned HTTP ${res.status}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error('GraphQL error: ' + json.errors.map(e => e.message).join('; '));
  }
  return parseGraphQLResponse(json);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/github.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `node --test`
Expected: All tests across shared/token/github PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/github.js test/github.test.js
git commit -m "feat: add GitHub GraphQL fetch wrapper"
```

---

## Task 9: HTTP server (server.js)

**Files:**
- Create: `server.js`

This task wires routing and static serving. The data-fetch and pure logic are already unit-tested; the http glue is verified by a manual smoke run.

- [ ] **Step 1: Write server.js**

```js
#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { resolveToken } from './lib/token.js';
import { fetchDashboard } from './lib/github.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');

const CONFIG = {
  user: process.env.GH_USER || '0xleizhang',
  org: process.env.GH_ORG || 'UrbanCompass',
  port: Number(process.env.PORT) || 4317,
  closedDays: Number(process.env.CLOSED_DAYS) || 7,
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

let token;
try {
  token = resolveToken();
} catch (err) {
  console.error('\n' + err.message + '\n');
  process.exit(1);
}

async function serveStatic(req, res) {
  let urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  // prevent path traversal
  const filePath = normalize(join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

async function serveApi(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'open';
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const prs = await fetchDashboard({
      token, scope, days: CONFIG.closedDays,
      user: CONFIG.user, org: CONFIG.org,
    });
    res.writeHead(200).end(JSON.stringify({ prs, scope, user: CONFIG.user, org: CONFIG.org }));
  } catch (err) {
    res.writeHead(200).end(JSON.stringify({ error: err.message }));
  }
}

const server = createServer((req, res) => {
  if (req.url.startsWith('/api/prs')) return serveApi(req, res);
  return serveStatic(req, res);
});

server.listen(CONFIG.port, () => {
  const addr = `http://localhost:${CONFIG.port}`;
  console.log(`pr-dashboard for ${CONFIG.user} @ ${CONFIG.org} → ${addr}`);
});
```

- [ ] **Step 2: Make server.js executable (for bin)**

Run: `chmod +x server.js`
Expected: no output, exit 0.

- [ ] **Step 3: Smoke-test the token-missing path**

Run: `GITHUB_TOKEN= PATH=/usr/bin node server.js` (PATH without `gh` so `gh auth token` fails)
Expected: prints "No GitHub token found..." and exits non-zero.
(If `gh` is still resolvable and authed, instead confirm it starts; then Ctrl-C.)

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: add http server with static serving and /api/prs"
```

---

## Task 10: Frontend (index.html + dashboard.js)

**Files:**
- Create: `public/index.html`
- Create: `public/dashboard.js`

- [ ] **Step 1: Write public/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PR Dashboard</title>
  <style>
    body { font: 14px/1.5 -apple-system, system-ui, sans-serif; margin: 0; padding: 1.5rem; color: #1f2328; }
    header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
    h1 { font-size: 1.1rem; margin: 0; }
    .controls { margin-left: auto; display: flex; gap: .5rem; align-items: center; }
    button, select { font: inherit; padding: .3rem .6rem; border: 1px solid #d0d7de; border-radius: 6px; background: #f6f8fa; cursor: pointer; }
    table { border-collapse: collapse; width: 100%; }
    th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid #eaeef2; }
    th { font-size: .8rem; color: #656d76; font-weight: 600; }
    tr.pr { cursor: pointer; }
    tr.pr:hover { background: #f6f8fa; }
    .dot { display: inline-block; width: .6rem; height: .6rem; border-radius: 50%; }
    .new { background: #0969da; }
    .muted { color: #656d76; }
    .tag { display: inline-block; padding: 0 .35rem; margin-right: .2rem; border-radius: 4px; font-size: .72rem; background: #eaeef2; }
    .repo { color: #656d76; font-size: .8rem; }
    #error { background: #ffebe9; border: 1px solid #ff818266; padding: .6rem; border-radius: 6px; margin-bottom: 1rem; display: none; }
    .review-approved { color: #1a7f37; }
    .review-changes_requested { color: #cf222e; }
    .ci-pass { color: #1a7f37; }
    .ci-fail { color: #cf222e; }
    .ci-pending { color: #9a6700; }
  </style>
</head>
<body>
  <header>
    <h1>PR Dashboard</h1>
    <span id="subtitle" class="muted"></span>
    <div class="controls">
      <select id="scope">
        <option value="open">Open only</option>
        <option value="all">Open + recently closed</option>
      </select>
      <button id="markRead">Mark all read</button>
      <button id="refresh">Refresh</button>
    </div>
  </header>
  <div id="error"></div>
  <table>
    <thead>
      <tr><th></th><th>Participation</th><th>Review</th><th>CI</th><th>PR</th></tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <p id="empty" class="muted" style="display:none">No PRs found.</p>
  <script type="module" src="./dashboard.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write public/dashboard.js**

```js
import { isNewActivity } from './shared.js';

const SEEN_KEY = 'pr-dashboard:seen';
const els = {
  rows: document.getElementById('rows'),
  error: document.getElementById('error'),
  empty: document.getElementById('empty'),
  scope: document.getElementById('scope'),
  refresh: document.getElementById('refresh'),
  markRead: document.getElementById('markRead'),
  subtitle: document.getElementById('subtitle'),
};

const PARTICIPATION = { author: '🖊 author', assignee: '👤 assignee', mention: '@ mention', commenter: '💬 commenter' };
const REVIEW = { approved: '✅ approved', changes_requested: '❌ changes', commented: '💬 commented', none: '⚪ none' };
const CI = { pass: '🟢 pass', fail: '🔴 fail', pending: '🟡 pending', unknown: '⚪ —' };

let current = [];

function loadSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; }
  catch { return {}; }
}
function saveSeen(seen) {
  localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
}

function render(prs) {
  current = prs;
  const seen = loadSeen();
  els.rows.innerHTML = '';
  els.empty.style.display = prs.length ? 'none' : 'block';
  for (const pr of prs) {
    const isNew = isNewActivity(seen[pr.key], pr.updatedAt);
    const tr = document.createElement('tr');
    tr.className = 'pr';
    tr.innerHTML = `
      <td>${isNew ? '<span class="dot new" title="new activity"></span>' : ''}</td>
      <td>${pr.labels.map(l => `<span class="tag">${PARTICIPATION[l]}</span>`).join('')}</td>
      <td class="review-${pr.review}">${REVIEW[pr.review]}</td>
      <td class="ci-${pr.ci}">${CI[pr.ci]}</td>
      <td>
        <div>${pr.isDraft ? '<span class="tag">draft</span>' : ''}${escapeHtml(pr.title)}</div>
        <div class="repo">${pr.repo}#${pr.number}</div>
      </td>`;
    tr.addEventListener('click', () => {
      const s = loadSeen();
      s[pr.key] = pr.updatedAt;
      saveSeen(s);
      tr.querySelector('.dot')?.remove();
      window.open(pr.url, '_blank', 'noopener');
    });
    els.rows.appendChild(tr);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function load() {
  els.error.style.display = 'none';
  els.rows.innerHTML = '<tr><td colspan="5" class="muted">Loading…</td></tr>';
  try {
    const res = await fetch(`/api/prs?scope=${els.scope.value}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    els.subtitle.textContent = `${data.user} @ ${data.org} · ${data.prs.length} PRs`;
    render(data.prs);
  } catch (err) {
    els.rows.innerHTML = '';
    els.error.textContent = 'Failed to load PRs: ' + err.message;
    els.error.style.display = 'block';
  }
}

els.refresh.addEventListener('click', load);
els.scope.addEventListener('change', load);
els.markRead.addEventListener('click', () => {
  const seen = loadSeen();
  for (const pr of current) seen[pr.key] = pr.updatedAt;
  saveSeen(seen);
  render(current);
});

load();
```

- [ ] **Step 3: Manual verification (golden path)**

Run: `node server.js` (with a valid token via env or `gh`)
Then open `http://localhost:4317` in a browser. Confirm:
- PR rows render with participation tags, review, CI columns
- Scope toggle switches between open-only and open+closed
- Clicking a row opens the PR in a new tab and clears its "new" dot
- "Mark all read" clears all blue dots
- If token/network fails, the red error bar appears (test by temporarily using a bad `GITHUB_TOKEN`)

> Note: if you see a TLS/certificate error in the server console, the corporate proxy CA is not trusted by Node. Provide it via `NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem node server.js`.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/dashboard.js
git commit -m "feat: add dashboard frontend"
```

---

## Task 11: Final end-to-end & npx check

**Files:** none (verification + docs)

- [ ] **Step 1: Run full test suite**

Run: `node --test`
Expected: all tests PASS.

- [ ] **Step 2: Verify npx-style invocation resolves the bin**

Run: `npm pack --dry-run`
Expected: lists `server.js`, `lib/`, `public/`, `package.json` in the tarball (these are what `npx` would run).

- [ ] **Step 3: Verify local bin runs**

Run: `node server.js` and confirm it starts and serves the dashboard, then Ctrl-C.
Expected: startup line `pr-dashboard for 0xleizhang @ UrbanCompass → http://localhost:4317`.

- [ ] **Step 4: Commit any final tweaks**

```bash
git add -A
git commit -m "chore: finalize pr-dashboard v0.1"
```

---

## Self-Review Notes

- **Spec coverage:** 4 participation cases → Tasks 5/6 (aliased searches + label merge); review status → Task 2; CI status → Task 2; unread activity → Task 3 + Task 10; PR link → Task 10; token order env→gh→error → Task 7; scope toggle → Tasks 8/10; npx run → Tasks 1/9/11; server-side proxy (token not in browser) → Tasks 8/9; error bar instead of white screen → Tasks 8/10. All covered.
- **50-item pagination limit:** accepted for v0.1 per spec §7.2; `first: 50` hard-coded in Task 5.
- **Type consistency:** PR object shape `{ key, number, title, url, repo, updatedAt, isDraft, state, review, ci, labels }` is produced in Task 6 and consumed identically in Tasks 8/10. Status enums (`approved|changes_requested|commented|none`, `pass|fail|pending|unknown`) match between Task 2 and the CSS/labels in Task 10.
