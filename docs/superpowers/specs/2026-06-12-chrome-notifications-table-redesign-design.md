# Design: Chrome Notifications + Table UI Redesign

Date: 2026-06-12

## Overview

Two independent features added to the PR Dashboard:

1. **Chrome browser notifications** — push a notification when a new comment appears on a tracked PR, using Server-Sent Events (SSE) for real-time delivery, with an on/off toggle.
2. **Table UI redesign** — add PR number, author, created/updated time columns; move all filter and sort controls into table headers (Excel-style).

---

## Feature 1: Chrome Notifications via SSE

### Server side (`server.js`)

- New endpoint: `GET /api/events` — returns an SSE stream (`text/event-stream`).
- On connection, add the response object to an in-memory `Set` of active clients. Remove it on `close`.
- A single `setInterval` (5 minutes) runs `fetchDashboard` in the background regardless of connected clients.
- After each poll, compare `latestComment.createdAt` per PR against the result from the previous poll. PRs whose latest comment is newer trigger a notification event.
- Event format pushed to all clients:
  ```
  event: new-comment
  data: {"prTitle":"...","commentAuthor":"...","commentSnip":"...","prUrl":"..."}
  ```
- First poll result is stored as baseline; no notifications are sent on startup.

### Client side (`dashboard.js`)

- On page load, read `localStorage('pr-dashboard:notify')`. If `"on"`, open `EventSource('/api/events')`.
- On `new-comment` event: call `new Notification(title, { body, tag: prUrl })`. Clicking the notification opens the PR URL.
- Before showing the first notification, call `Notification.requestPermission()`. If the user denies, set toggle to off silently.
- Toggle button in header (right side): label `🔔 通知` when on, `🔕 静默` when off. Clicking toggles state, saves to localStorage, and connects/disconnects the EventSource.

### Error handling

- If the SSE connection drops, the browser's native EventSource reconnect handles it automatically.
- If `fetchDashboard` throws inside the poll loop, log the error and continue polling (no crash).

---

## Feature 2: Table UI Redesign

### New columns (added to GraphQL query in `shared.js`)

| Column | Data source | Notes |
|--------|-------------|-------|
| `·` | `isNew` flag | Unchanged blue dot |
| `State ▾` | `pr.state / pr.isDraft` | Header has filter dropdown |
| `#` | `pr.number` | Sortable |
| `Author` | `pr.author` (new field) | Add `author { login }` to `PR_FIELDS` |
| `Participation ▾` | `pr.labels` | Header has filter dropdown |
| `Review` | `pr.review` | Unchanged |
| `CI` | `pr.ci` | Unchanged |
| `Created` | `pr.createdAt` | Format `MM-DD HH:mm`, sortable |
| `Updated` | `pr.updatedAt` | Format `MM-DD HH:mm`, sortable, default sort desc |
| `PR Title` | `pr.title` + repo | Unchanged content |

### Column header controls

**Filterable columns** (`State`, `Participation`):
- Header cell contains label + `▾` button.
- Clicking `▾` opens a small inline dropdown (absolutely positioned `<div>`). Clicking outside closes it.
- State options: `All states / Open / Draft / Closed / Merged` (replaces the `scope` select — open-only vs all is now "Open" vs selecting multiple).
- Participation options: `All / Author / Assignee / Mention / Commenter` (replaces the `type` select).

**Sortable columns** (`#`, `Created`, `Updated`):
- Entire `<th>` is clickable. First click = descending, second = ascending, third = back to descending (toggle).
- Active sort column shows `↓` or `↑` suffix. Inactive columns show no arrow.
- Default on load: `Updated ↓`.

### Scope change (open vs closed)

The old `scope` select controlled whether the API call fetched closed PRs too. This moves to the State filter header:
- If the user selects any closed/merged state, the frontend triggers a new API call with `scope=all`.
- If only open/draft states are selected, fetches with `scope=open`.

### Top controls after redesign

Removed: `type`, `scope`, `sort` selects.  
Remaining: `Mark all read` button, `Refresh` button, `🔔/🔕` notification toggle button.

### `shared.js` changes

- Add `author { login }` to `PR_FIELDS`.
- Expose `author: n.author?.login ?? 'unknown'` in `parseGraphQLResponse`.
