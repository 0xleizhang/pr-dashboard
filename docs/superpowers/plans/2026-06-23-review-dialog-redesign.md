# Review Dialog Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the PR review dialog to group comments by review submission batch, organize inline threads by file with line numbers, and show PR-level comment bodies.

**Architecture:** Update the GraphQL query to fetch file path/line and review linkage fields, restructure `reviewDetailsOf` to attach threads to their parent review, then rewrite `renderReviewContent` to render one bordered card per review batch with file-grouped threads inside.

**Tech Stack:** Vanilla JS (ES modules), GitHub GraphQL API, HTML/CSS

## Global Constraints

- No external dependencies — all changes are in `public/shared.js`, `public/dashboard.js`, `public/index.html`, `test/shared.test.js`
- Run tests with: `node --test test/shared.test.js`
- Escape all user-supplied strings with `escapeHtml()` before inserting into HTML
- Follow existing code style: no comments, single-line variable declarations, same indentation

---

### Task 1: Update data model — GraphQL, `reviewDetailsOf`, `latestActivityOf`

**Files:**
- Modify: `public/shared.js` (lines 127–191, 93–108)
- Modify: `test/shared.test.js` (lines 79–98, 121–131, 133–178)

**Interfaces:**
- Produces: `reviewDetail` shape used by Task 2:
  ```js
  {
    reviewers: [{
      id: string,
      login: string, state: string, label: string,
      body: string, url: string, submittedAt: string|null,
      threads: [{
        isResolved: boolean,
        path: string,       // e.g. "interceptor/retry.go"
        line: number|null,  // e.g. 42
        comments: [{ author: string, body: string, url: string, createdAt: string }]
      }]
    }],
    comments: [{ author: string, body: string, createdAt: string, url: string }],
    orphanThreads: [{ isResolved: boolean, path: string, line: number|null, comments: [...] }]
  }
  ```

- [ ] **Step 1: Update the GraphQL query string**

In `public/shared.js`, replace the existing `reviews` and `reviewThreads` lines inside `PR_FIELDS` (lines 133–134):

```js
const PR_FIELDS = `
  ... on PullRequest {
    id number title url createdAt updatedAt isDraft state reviewDecision
    author { login }
    repository { nameWithOwner }
    comments(last: 10) { totalCount nodes { author { login } bodyText createdAt url } }
    reviews(last: 20) { totalCount nodes { id author { login } state body submittedAt url } }
    reviewThreads(first: 100) { nodes { isResolved path line comments(first: 10) { nodes { author { login } body url createdAt pullRequestReview { id } } } } }
    commits(last: 1) { nodes { commit { statusCheckRollup {
      contexts(first: 100) {
        nodes {
          __typename
          ... on CheckRun { name status conclusion databaseId title summary text }
          ... on StatusContext { context state }
        }
      }
    } } } }
  }`;
```

Changes: added `id` to review nodes; added `path line` to reviewThreads nodes; added `pullRequestReview { id }` to thread comment nodes.

- [ ] **Step 2: Rewrite `reviewDetailsOf`**

Replace the entire `reviewDetailsOf` function (lines 175–192) with:

```js
function reviewDetailsOf(node) {
  const REVIEW_STATE = { APPROVED: '✅ Approved', CHANGES_REQUESTED: '❌ Changes Requested', COMMENTED: '💬 Commented', DISMISSED: '⚫ Dismissed' };
  const reviewers = (node.reviews?.nodes ?? [])
    .filter(r => !isBot(r.author?.login) && r.state !== 'PENDING')
    .map(r => ({ id: r.id ?? '', login: r.author?.login ?? 'unknown', state: r.state, label: REVIEW_STATE[r.state] ?? r.state, body: r.body ?? '', url: r.url ?? '', submittedAt: r.submittedAt ?? null, threads: [] }));
  const reviewMap = new Map(reviewers.map(r => [r.id, r]));
  const orphanThreads = [];
  for (const t of node.reviewThreads?.nodes ?? []) {
    const comments = (t.comments?.nodes ?? [])
      .filter(c => !isBot(c.author?.login))
      .map(c => ({ author: c.author?.login ?? 'unknown', body: c.body ?? '', url: c.url ?? '', createdAt: c.createdAt }));
    if (!comments.length) continue;
    const thread = { isResolved: t.isResolved, path: t.path ?? '', line: t.line ?? null, comments };
    const reviewId = t.comments?.nodes?.find(c => c.pullRequestReview?.id)?.pullRequestReview?.id;
    const parent = reviewId ? reviewMap.get(reviewId) : null;
    if (parent) parent.threads.push(thread);
    else orphanThreads.push(thread);
  }
  const comments = (node.comments?.nodes ?? [])
    .filter(c => !isBot(c.author?.login))
    .map(c => ({ author: c.author?.login ?? 'unknown', body: c.bodyText ?? '', createdAt: c.createdAt, url: c.url ?? '' }));
  return { reviewers, comments, orphanThreads };
}
```

- [ ] **Step 3: Update `latestActivityOf` to walk `r.threads` instead of `threadGroups`**

Replace the `latestActivityOf` function (lines 93–108) with:

```js
export function latestActivityOf(pr) {
  const events = [];
  if (pr.latestComment?.createdAt) {
    events.push({ author: pr.latestComment.author, ts: pr.latestComment.createdAt });
  }
  for (const r of pr.reviewDetail?.reviewers ?? []) {
    if (r.submittedAt) events.push({ author: r.login, ts: r.submittedAt });
    for (const t of r.threads ?? []) {
      for (const c of t.comments ?? []) {
        if (c.createdAt) events.push({ author: c.author, ts: c.createdAt });
      }
    }
  }
  for (const t of pr.reviewDetail?.orphanThreads ?? []) {
    for (const c of t.comments ?? []) {
      if (c.createdAt) events.push({ author: c.author, ts: c.createdAt });
    }
  }
  if (!events.length) return null;
  return events.reduce((best, e) => (e.ts > best.ts ? e : best));
}
```

- [ ] **Step 4: Update tests for `latestActivityOf`**

In `test/shared.test.js`, replace the three `latestActivityOf` tests (lines 79–98):

```js
test('latestActivityOf: returns null when no activity', () => {
  assert.equal(latestActivityOf({ latestComment: null, reviewDetail: { reviewers: [], orphanThreads: [] } }), null);
});
test('latestActivityOf: returns latest comment', () => {
  const pr = { latestComment: { author: 'alice', createdAt: '2026-06-12T10:00:00Z' }, reviewDetail: { reviewers: [], orphanThreads: [] } };
  assert.deepEqual(latestActivityOf(pr), { author: 'alice', ts: '2026-06-12T10:00:00Z' });
});
test('latestActivityOf: prefers most recent across comments, reviews, threads', () => {
  const pr = {
    latestComment: { author: 'alice', createdAt: '2026-06-12T08:00:00Z' },
    reviewDetail: {
      reviewers: [{ login: 'bob', submittedAt: '2026-06-12T09:00:00Z', threads: [{ comments: [{ author: 'carol', createdAt: '2026-06-12T10:00:00Z' }] }] }],
      orphanThreads: [],
    },
  };
  assert.deepEqual(latestActivityOf(pr), { author: 'carol', ts: '2026-06-12T10:00:00Z' });
});
test('latestActivityOf: handles missing reviewDetail gracefully', () => {
  const pr = { latestComment: { author: 'alice', createdAt: '2026-06-12T10:00:00Z' } };
  assert.deepEqual(latestActivityOf(pr), { author: 'alice', ts: '2026-06-12T10:00:00Z' });
});
```

- [ ] **Step 5: Update `buildGraphQLQuery` test to assert new fields**

In `test/shared.test.js`, inside the `buildGraphQLQuery` test (around line 121), add two assertions after the existing ones:

```js
assert.ok(q.includes('pullRequestReview'), 'requests pullRequestReview id on thread comments');
assert.ok(q.includes('path line'), 'requests path and line on review threads');
```

- [ ] **Step 6: Run tests and verify all pass**

```bash
node --test test/shared.test.js
```

Expected: all tests pass, no failures.

- [ ] **Step 7: Commit**

```bash
git add public/shared.js test/shared.test.js
git commit -m "feat: restructure reviewDetail to group threads under parent review batch"
```

---

### Task 2: Rewrite dialog rendering + CSS

**Files:**
- Modify: `public/dashboard.js` (lines 447–536)
- Modify: `public/index.html` (lines 193–208 CSS block)

**Interfaces:**
- Consumes: `pr.reviewDetail` shape from Task 1:
  - `reviewers`: array with `id, login, state, label, body, url, submittedAt, threads`
  - `threads`: array with `isResolved, path, line, comments`
  - `comments`: PR-level non-file comments
  - `orphanThreads`: fallback threads

- [ ] **Step 1: Add new CSS classes to `public/index.html`**

After line 208 (`.time-ago { ... }`) in the `<style>` block, add:

```css
.review-batch { border: 1px solid var(--color-border); border-radius: 6px; padding: .5rem .7rem; margin-bottom: .6rem; }
.review-batch.review-batch-dismissed { opacity: .5; }
.review-batch-header { font-size: .85rem; font-weight: 600; margin-bottom: .15rem; }
.review-batch-body { font-size: .78rem; color: var(--color-muted); margin: .15rem 0 .35rem; white-space: pre-wrap; }
.file-group { margin-top: .45rem; padding-left: .5rem; border-left: 2px solid var(--color-border-subtle); }
.file-group.thread-resolved { opacity: .5; }
.file-path { font-family: monospace; font-size: .72rem; color: var(--color-muted); margin-bottom: .15rem; }
.thread-comment { font-size: .82rem; margin-bottom: .15rem; }
.pr-comments-section { margin-top: .75rem; padding-top: .55rem; border-top: 1px solid var(--color-border-subtle); }
.pr-comments-label { font-size: .72rem; color: var(--color-muted); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin-bottom: .35rem; }
```

- [ ] **Step 2: Rewrite `renderReviewContent` in `public/dashboard.js`**

Replace the entire `renderReviewContent` function (lines 447–536):

```js
function renderReviewContent(pr) {
  const showClosed = showClosedToggle.checked;
  const { reviewers, comments, orphanThreads = [] } = pr.reviewDetail;

  let html = '';

  const op = pr.ownersPending;
  if (op) {
    const link = op.checkUrl
      ? `<a href="${escapeHtml(op.checkUrl)}" target="_blank" rel="noopener">owners-files ↗</a>`
      : 'owners-files';
    if (op.status === 'pass') {
      html += `<div class="owners-ok">✅ OWNERS approved — ${link}</div>`;
    } else if (op.status === 'fail') {
      html += `<div class="owners-pending"><strong>⏳ Pending OWNERS approval</strong> — ${link}`;
      if (op.pending?.length) {
        html += `<ul class="owners-list">`;
        for (const t of op.pending) {
          html += `<li><a href="${escapeHtml(t.url)}" target="_blank" rel="noopener">${escapeHtml(t.name)}</a></li>`;
        }
        html += `</ul>`;
      }
      html += `</div>`;
    } else {
      html += `<div class="owners-running-banner owners-pending"><strong>🟡 OWNERS check running</strong> — ${link}</div>`;
    }
  }

  const visibleReviewers = reviewers.filter(r => !(r.state === 'DISMISSED' && !showClosed));

  for (const r of visibleReviewers) {
    const isDismissed = r.state === 'DISMISSED';
    html += `<div class="review-batch${isDismissed ? ' review-batch-dismissed' : ''}">`;
    const nameHtml = r.url
      ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">@${escapeHtml(r.login)}</a>`
      : `@${escapeHtml(r.login)}`;
    const ago = r.submittedAt ? `<span class="time-ago">${timeAgo(r.submittedAt)}</span>` : '';
    html += `<div class="review-batch-header">${nameHtml} &nbsp;${escapeHtml(r.label)} ${ago}</div>`;
    if (r.body.trim()) {
      html += `<div class="review-batch-body">${escapeHtml(r.body.trim().slice(0, 300))}</div>`;
    }
    for (const t of r.threads) {
      if (t.isResolved && !showClosed) continue;
      const fileLabel = t.line != null ? `${t.path}:${t.line}` : t.path;
      html += `<div class="file-group${t.isResolved ? ' thread-resolved' : ''}">`;
      html += `<div class="file-path">${escapeHtml(fileLabel)}</div>`;
      for (const c of t.comments) {
        const snip = c.body.replace(/\s+/g, ' ').trim();
        const cAgo = c.createdAt ? `<span class="time-ago">${timeAgo(c.createdAt)}</span>` : '';
        const cName = c.url
          ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">@${escapeHtml(c.author)}</a>`
          : `@${escapeHtml(c.author)}`;
        html += `<div class="thread-comment"><strong>${cName}</strong>: ${escapeHtml(snip.slice(0, 200))}${snip.length > 200 ? '…' : ''} ${cAgo}</div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
  }

  let resolvedCount = 0;
  for (const r of reviewers) resolvedCount += r.threads.filter(t => t.isResolved).length;
  resolvedCount += orphanThreads.filter(t => t.isResolved).length;
  if (!showClosed && resolvedCount > 0) {
    html += `<p class="muted" style="font-size:.78rem">${resolvedCount} resolved thread${resolvedCount > 1 ? 's' : ''} hidden.</p>`;
  }

  if (comments.length > 0) {
    html += `<div class="pr-comments-section"><div class="pr-comments-label">PR comments</div>`;
    for (const c of comments) {
      const snip = c.body.replace(/\s+/g, ' ').trim();
      const ago = c.createdAt ? `<span class="time-ago">${timeAgo(c.createdAt)}</span>` : '';
      const nameHtml = c.url
        ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">@${escapeHtml(c.author)}</a>`
        : `@${escapeHtml(c.author)}`;
      html += `<div class="thread-comment"><strong>${nameHtml}</strong>: ${escapeHtml(snip.slice(0, 200))}${snip.length > 200 ? '…' : ''} ${ago}</div>`;
    }
    html += `</div>`;
  }

  for (const t of orphanThreads) {
    if (t.isResolved && !showClosed) continue;
    const fileLabel = t.line != null ? `${t.path}:${t.line}` : t.path;
    html += `<div class="file-group${t.isResolved ? ' thread-resolved' : ''}">`;
    html += `<div class="file-path">${escapeHtml(fileLabel)}</div>`;
    for (const c of t.comments) {
      const snip = c.body.replace(/\s+/g, ' ').trim();
      const cAgo = c.createdAt ? `<span class="time-ago">${timeAgo(c.createdAt)}</span>` : '';
      const cName = c.url
        ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">@${escapeHtml(c.author)}</a>`
        : `@${escapeHtml(c.author)}`;
      html += `<div class="thread-comment"><strong>${cName}</strong>: ${escapeHtml(snip.slice(0, 200))}${snip.length > 200 ? '…' : ''} ${cAgo}</div>`;
    }
    html += `</div>`;
  }

  if (!html) html = '<p class="muted" style="font-size:.85rem">No reviews yet.</p>';
  reviewDialogContent.innerHTML = html;
}
```

- [ ] **Step 3: Remove now-unused `.thread-label` CSS**

In `public/index.html`, delete this line (line 207):
```css
    .thread-resolved .thread-label { font-size: .72rem; color: var(--color-muted); margin-left: .3rem; }
```

The `.thread-resolved` class itself is still used (on `.file-group`), just remove the `.thread-label` child rule.

- [ ] **Step 4: Verify the app renders correctly**

Start the app and open a PR that has review comments. Verify:
- Each reviewer's batch appears as a bordered card
- Inline threads show with `file.go:42` labels
- PR-level comments appear in their own section below
- "Show closed reviews" toggle hides/shows dismissed and resolved content
- No JS errors in the browser console

- [ ] **Step 5: Commit**

```bash
git add public/dashboard.js public/index.html
git commit -m "feat: render review dialog as batched cards grouped by file"
```
