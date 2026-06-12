import { isNewActivity } from './shared.js';

const SEEN_KEY = 'pr-dashboard:seen';
const els = {
  rows: document.getElementById('rows'),
  error: document.getElementById('error'),
  empty: document.getElementById('empty'),
  scope: document.getElementById('scope'),
  type: document.getElementById('type'),
  sort: document.getElementById('sort'),
  refresh: document.getElementById('refresh'),
  markRead: document.getElementById('markRead'),
  subtitle: document.getElementById('subtitle'),
};

const PARTICIPATION = { author: '🖊 author', assignee: '👤 assignee', mention: '@ mention', commenter: '💬 commenter' };
const REVIEW = { approved: '✅ approved', changes_requested: '❌ changes', commented: '💬 commented', none: '⚪ none' };
const CI = { pass: '🟢 pass', fail: '🔴 fail', pending: '🟡 pending', unknown: '⚪ —' };
const STATE = { open: 'open', draft: 'draft', closed: 'closed', merged: 'merged' };

function prState(pr) {
  if (pr.isDraft) return 'draft';
  if (pr.state === 'MERGED') return 'merged';
  if (pr.state === 'CLOSED') return 'closed';
  return 'open';
}

let allPrs = [];

function loadSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; }
  catch { return {}; }
}
function saveSeen(seen) {
  localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
}

const SORTERS = {
  number:  { asc: (a, b) => a.number - b.number,           desc: (a, b) => b.number - a.number },
  created: { asc: (a, b) => new Date(a.createdAt) - new Date(b.createdAt), desc: (a, b) => new Date(b.createdAt) - new Date(a.createdAt) },
  updated: { asc: (a, b) => new Date(a.updatedAt) - new Date(b.updatedAt), desc: (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt) },
};

let sortState = { col: 'updated', dir: 'desc' }; // default

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

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${min}`;
}

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

function authorInfo(pr) {
  const parts = [];
  if (pr.unresolved > 0) {
    parts.push(`<span class="warn">⚠ ${pr.unresolved} unresolved</span>`);
  }
  if (pr.latestComment) {
    const body = pr.latestComment.body.replace(/\s+/g, ' ').trim();
    const snip = body.slice(0, 80);
    parts.push(`<span class="muted">💬 @${escapeHtml(pr.latestComment.author)}: ${escapeHtml(snip)}${body.length > 80 ? '…' : ''}</span>`);
  }
  return parts.length ? `<div class="comment">${parts.join(' · ')}</div>` : '';
}

function render() {
  const prs = visiblePrs();
  const seen = loadSeen();
  els.rows.innerHTML = '';
  els.empty.style.display = prs.length ? 'none' : 'block';
  for (const pr of prs) {
    const isNew = isNewActivity(seen[pr.key], pr.updatedAt);
    const tr = document.createElement('tr');
    tr.className = 'pr';
    const state = prState(pr);
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
  els.rows.innerHTML = '<tr><td colspan="10" class="muted">Loading…</td></tr>';
  try {
    const res = await fetch(`/api/prs?scope=${els.scope.value}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    els.subtitle.textContent = `${data.user} @ ${data.org} · ${data.prs.length} PRs`;
    allPrs = data.prs;
    render();
  } catch (err) {
    els.rows.innerHTML = '';
    els.error.textContent = 'Failed to load PRs: ' + err.message;
    els.error.style.display = 'block';
  }
}

els.refresh.addEventListener('click', load);
els.scope.addEventListener('change', load);
els.type.addEventListener('change', render);
els.markRead.addEventListener('click', () => {
  const seen = loadSeen();
  for (const pr of visiblePrs()) seen[pr.key] = pr.updatedAt;
  saveSeen(seen);
  render();
});

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
  evtSource.addEventListener('error', () => console.warn('[SSE] connection error, browser will retry'));
}

function disconnectSSE() {
  evtSource?.close();
  evtSource = null;
}

async function enableNotifications() {
  if (typeof Notification === 'undefined') { applyNotifyUI(); return; }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    localStorage.setItem(NOTIFY_KEY, 'on');
    connectSSE();
  } else {
    localStorage.setItem(NOTIFY_KEY, 'off');
    disconnectSSE();
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
if (typeof Notification !== 'undefined' && isNotifyOn() && Notification.permission === 'granted') connectSSE();

load();
