# PR Review Dialog Redesign

**Date:** 2026-06-23  
**Status:** Approved

## Problem

The current review dialog renders a flat chronological list that mixes review events ("suafata — 💬 Commented"), inline thread comments, and PR-level comments. This makes it hard to understand:

1. What a reviewer actually said (review events show "Commented" with no body when the review body is empty)
2. Which file and line each inline comment refers to
3. Which comments belong to the same review submission round

## Design

### Data model changes (`public/shared.js`)

**GraphQL query updates:**

- Add `id` to review nodes (needed to link threads to their parent review)
- Add `path line` to `reviewThreads` nodes (file location)
- Add `pullRequestReview { id }` to review thread comment nodes (links comment to its parent review submission)

```
reviews(last: 20) { nodes { id author { login } state body submittedAt url } }
reviewThreads(first: 100) { nodes { isResolved path line comments(first: 10) { nodes { author { login } body url createdAt pullRequestReview { id } } } } }
```

**`reviewDetailsOf` restructure:**

Each reviewer entry gains a `threads` field — file-grouped inline threads belonging to that review submission, determined by matching `pullRequestReview.id` to the review's `id`. Threads with no matching review (edge case) go into a top-level `orphanThreads` array.

New shape:
```js
{
  reviewers: [{
    id, login, state, label, body, url, submittedAt,
    threads: [{       // inline threads belonging to this review submission
      isResolved,
      path,           // e.g. "interceptor/retry.go"
      line,           // e.g. 42
      comments: [{ author, body, url, createdAt }]
    }]
  }],
  comments: [{ author, body, createdAt, url }],   // PR-level (non-file) comments
  orphanThreads: [{ isResolved, path, line, comments }],  // fallback, should be empty
}
```

**`latestActivityOf` update:**

Walk `r.threads` on each reviewer instead of top-level `threadGroups`. Remove `threadGroups` from the data shape.

### Dialog rendering changes (`public/dashboard.js` + `public/index.html`)

Replace flat list with review batch cards. Each card covers one review submission:

```
┌─────────────────────────────────────────────────────┐
│ @suafata  💬 Commented  11h ago                     │
│ "Great job overall."  ← review body if non-empty    │
│                                                      │
│  interceptor/retry.go:42                             │
│    @suafata: We might leverage ctxWithSpan here.     │
│                                                      │
│  interceptor/retry.go:58                             │
│    @suafata: Do we still need this import?           │
│    @suafata: if SetMetrics is never called...        │
└─────────────────────────────────────────────────────┘
```

Sections within the dialog (top to bottom):

1. **OWNERS block** — unchanged
2. **Review batches** — one card per review submission, sorted by `submittedAt`. Each card shows:
   - Header: `@login  <state label>  <time ago>` (linked to review URL)
   - Body: review-level comment if non-empty
   - File groups: threads attached to this review, grouped by `path`, each showing `path:line` as a monospace subheader and comments indented below. Thread replies within the same thread are also indented.
   - Dismissed reviews: shown at reduced opacity (same as current `thread-resolved` style)
3. **PR comments section** — non-file `comments`, shown below review batches with a divider labeled "PR comments". Hidden if empty.
4. **"N resolved threads hidden" notice** — same as current, shown when toggle is off

**"Show closed reviews" toggle** — same behavior: hides dismissed reviews and resolved threads when off.

**Orphan threads** (fallback) — if any threads have no matching review, render them at the bottom as a flat list using current style.

### CSS additions (`public/index.html`)

New classes:
- `.review-batch` — bordered card per review round, `margin-bottom: .75rem`
- `.review-batch-header` — reviewer + state + time, `font-size: .85rem`, `font-weight: 600`
- `.review-batch-body` — review-level comment text, muted, `font-size: .78rem`
- `.file-group` — groups comments on one file, `margin-top: .5rem`
- `.file-path` — monospace small label (`path:line`), `font-size: .75rem`, muted
- `.thread-comment` — individual comment line
- `.thread-comment + .thread-comment` — indent replies within same thread
- `.pr-comments-section` — PR-level comments section with divider

## Files changed

| File | Change |
|------|--------|
| `public/shared.js` | GraphQL query, `reviewDetailsOf`, `latestActivityOf` |
| `public/dashboard.js` | `renderReviewContent` rewrite |
| `public/index.html` | New CSS classes |
| `test/shared.test.js` | Update tests for new data shape |

## Out of scope

- Markdown rendering of comment bodies (keep as plain text / `escapeHtml`)
- Pagination of reviews beyond current `last: 20` / `first: 100` limits
- Collapsing/expanding individual file groups
