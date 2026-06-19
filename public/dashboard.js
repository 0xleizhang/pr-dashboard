import { isNewActivity } from './shared.js';

const SEEN_KEY = 'pr-dashboard:seen';
const PREFS_KEY = 'pr-dashboard:prefs';
const THEME_KEY = 'pr-dashboard:theme';
const THEME_STATES = ['auto', 'dark', 'light'];
const THEME_LABELS = { auto: '💻 Auto', dark: '🌙 Dark', light: '☀️ Light' };

function getThemeState() {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'dark' || stored === 'light' ? stored : 'auto';
}

function applyTheme(state) {
  if (state === 'auto') {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem(THEME_KEY);
  } else {
    document.documentElement.setAttribute('data-theme', state);
    localStorage.setItem(THEME_KEY, state);
  }
  document.getElementById('theme-toggle').textContent = THEME_LABELS[state];
}

document.getElementById('theme-toggle').addEventListener('click', () => {
  const current = getThemeState();
  const next = THEME_STATES[(THEME_STATES.indexOf(current) + 1) % THEME_STATES.length];
  applyTheme(next);
});

applyTheme(getThemeState());
const els = {
  rows: document.getElementById('rows'),
  error: document.getElementById('error'),
  empty: document.getElementById('empty'),
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

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
  catch { return {}; }
}
function savePrefs() {
  const stateFilter = [...document.querySelectorAll('#state-dropdown input:checked')].map(i => i.value);
  const participation = document.querySelector('#participation-dropdown input:checked')?.value ?? 'all';
  localStorage.setItem(PREFS_KEY, JSON.stringify({ sort: sortState, stateFilter, participation, meOnly, days: currentDays }));
}

const SORTERS = {
  number:  { asc: (a, b) => a.number - b.number,           desc: (a, b) => b.number - a.number },
  author:  { asc: (a, b) => a.author.localeCompare(b.author), desc: (a, b) => b.author.localeCompare(a.author) },
  created: { asc: (a, b) => new Date(a.createdAt) - new Date(b.createdAt), desc: (a, b) => new Date(b.createdAt) - new Date(a.createdAt) },
  updated: { asc: (a, b) => new Date(a.updatedAt) - new Date(b.updatedAt), desc: (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt) },
};

let sortState = { col: 'updated', dir: 'desc' };

const sortCols = {
  'th-number':  'number',
  'th-author':  'author',
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
    savePrefs();
    render();
  });
}

updateSortUI();

function setupDropdown(arrowId, dropdownId) {
  const arrow = document.getElementById(arrowId);
  const menu = document.getElementById(dropdownId);
  arrow.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && !arrow.contains(e.target)) menu.classList.remove('open');
  });
}

setupDropdown('state-arrow', 'state-dropdown');
setupDropdown('participation-arrow', 'participation-dropdown');
setupDropdown('author-arrow', 'author-dropdown');

// ── Column resize ─────────────────────────────────────────────
const COL_WIDTHS_KEY = 'pr-dashboard:col-widths';

function loadColWidths() {
  try { return JSON.parse(localStorage.getItem(COL_WIDTHS_KEY)) || {}; } catch { return {}; }
}
function saveColWidths(widths) {
  localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(widths));
}

(function initColResize() {
  const cols = document.querySelectorAll('#colgroup col');
  const saved = loadColWidths();

  // Restore saved widths
  cols.forEach((col, i) => {
    if (saved[i] != null) col.style.width = saved[i] + 'px';
  });

  // Attach drag logic to every .col-resizer handle
  document.querySelectorAll('thead th').forEach((th, colIdx) => {
    const handle = th.querySelector('.col-resizer');
    if (!handle) return;
    const col = cols[colIdx];
    if (!col) return;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      handle.classList.add('dragging');
      document.body.classList.add('col-resizing');
      const startX = e.clientX;
      const startW = th.offsetWidth;

      function onMove(e) {
        const newW = Math.max(30, startW + e.clientX - startX);
        col.style.width = newW + 'px';
      }

      function onUp() {
        handle.classList.remove('dragging');
        document.body.classList.remove('col-resizing');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        // Save all current widths
        const widths = {};
        cols.forEach((c, i) => {
          const w = parseInt(c.style.width);
          if (!isNaN(w)) widths[i] = w;
        });
        saveColWidths(widths);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
})();
// ─────────────────────────────────────────────────────────────

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${min}`;
}

function timeCell(iso) {
  if (!iso) return '—';
  const full = new Date(iso).toLocaleString();
  return `<span title="${escapeHtml(full)}">${timeAgo(iso)}</span>`;
}

// Stubs reassigned in Task 6
let activeStateFilter = () => [];
let activeTypeFilter = () => 'all';

activeStateFilter = () => {
  const checked = [...document.querySelectorAll('#state-dropdown input:checked')];
  return checked.map(i => i.value);
};

activeTypeFilter = () => {
  const checked = document.querySelector('#participation-dropdown input:checked');
  return checked?.value ?? 'all';
};

let currentScope = 'open';
let currentDays = 14;
let meOnly = true;

(function applyPrefs() {
  const p = loadPrefs();
  if (p.sort) sortState = p.sort;
  if (p.stateFilter) {
    document.querySelectorAll('#state-dropdown input').forEach(inp => {
      inp.checked = p.stateFilter.includes(inp.value);
    });
  }
  if (p.participation) {
    const radio = document.querySelector(`#participation-dropdown input[value="${p.participation}"]`);
    if (radio) radio.checked = true;
  }
  if (p.meOnly !== undefined) {
    meOnly = p.meOnly;
    document.getElementById('me-toggle').checked = meOnly;
  }
  if (p.days) {
    currentDays = p.days;
    document.getElementById('days-select').value = String(currentDays);
  }
  const stateVals = p.stateFilter ?? ['open'];
  currentScope = stateVals.some(s => s === 'closed' || s === 'merged') ? 'all' : 'open';
  updateSortUI();
})();

document.getElementById('days-select').addEventListener('change', (e) => {
  currentDays = Number(e.target.value);
  savePrefs();
  load();
});

document.getElementById('me-toggle').addEventListener('change', (e) => {
  meOnly = e.target.checked;
  savePrefs();
  render();
});

document.getElementById('state-dropdown').addEventListener('change', () => {
  const selected = activeStateFilter();
  const needAll = selected.some(s => s === 'closed' || s === 'merged');
  const newScope = needAll ? 'all' : 'open';
  savePrefs();
  if (newScope !== currentScope) {
    currentScope = newScope;
    load();
  } else {
    render();
  }
});

document.getElementById('participation-dropdown').addEventListener('change', () => { savePrefs(); render(); });

const authorAllCheckbox = document.getElementById('author-all');
const authorList = document.getElementById('author-list');

function buildAuthorFilter(prs) {
  const authors = [...new Set(prs.map(pr => pr.author))].sort((a, b) => a.localeCompare(b));
  // Keep existing checked state if authors haven't changed
  const prevChecked = new Set(
    [...authorList.querySelectorAll('input:checked')].map(i => i.value)
  );
  const hadSelections = authorList.querySelector('input') !== null;
  authorList.innerHTML = '';
  for (const author of authors) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = author;
    cb.checked = hadSelections ? prevChecked.has(author) : false;
    cb.addEventListener('change', () => {
      authorAllCheckbox.checked = [...authorList.querySelectorAll('input')].every(i => !i.checked);
      render();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + author));
    authorList.appendChild(label);
  }
}

function activeAuthorFilter() {
  const checked = [...authorList.querySelectorAll('input:checked')].map(i => i.value);
  return checked; // empty = no filter (show all)
}

authorAllCheckbox.addEventListener('change', () => {
  if (authorAllCheckbox.checked) {
    authorList.querySelectorAll('input').forEach(i => { i.checked = false; });
    render();
  }
});

function visiblePrs() {
  const stateFilter = activeStateFilter();
  const typeFilter = activeTypeFilter();
  const authorFilter = activeAuthorFilter();
  let filtered = allPrs;
  if (meOnly) filtered = filtered.filter(pr => pr.labels.includes('author'));
  if (stateFilter.length) filtered = filtered.filter(pr => stateFilter.includes(prState(pr)));
  if (typeFilter !== 'all') filtered = filtered.filter(pr => pr.labels.includes(typeFilter));
  if (authorFilter.length) filtered = filtered.filter(pr => authorFilter.includes(pr.author));
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

const reviewDialog = document.getElementById('review-dialog');
const reviewDialogTitle = document.getElementById('review-dialog-title');
const reviewDialogContent = document.getElementById('review-dialog-content');
const showClosedToggle = document.getElementById('show-closed-toggle');
document.getElementById('review-dialog-close').addEventListener('click', () => reviewDialog.close());
reviewDialog.addEventListener('click', (e) => { if (e.target === reviewDialog) reviewDialog.close(); });

let currentReviewPr = null;
showClosedToggle.addEventListener('change', () => { if (currentReviewPr) renderReviewContent(currentReviewPr); });

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function renderReviewContent(pr) {
  const showClosed = showClosedToggle.checked;
  const { reviewers, comments, threadGroups = [] } = pr.reviewDetail;

  let html = '';

  // OWNERS pending block
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

  // Flatten all items into a unified list sorted by time
  const items = [];

  for (const r of reviewers) {
    const isDismissed = r.state === 'DISMISSED';
    if (isDismissed && !showClosed) continue;
    items.push({ kind: 'review', ts: r.submittedAt, isDismissed, r });
  }

  const closedThreadCount = threadGroups.filter(t => t.isResolved).length;
  for (const t of threadGroups) {
    if (t.isResolved && !showClosed) continue;
    for (const c of t.comments) {
      items.push({ kind: 'thread', ts: c.createdAt, isResolved: t.isResolved, c });
    }
  }

  for (const c of comments) {
    items.push({ kind: 'comment', ts: c.createdAt, c });
  }

  items.sort((a, b) => new Date(a.ts || 0) - new Date(b.ts || 0));

  if (items.length) {
    html += '<ul>';
    for (const item of items) {
      const ago = item.ts ? `<span class="time-ago">${timeAgo(item.ts)}</span>` : '';
      if (item.kind === 'review') {
        const { r, isDismissed } = item;
        const nameHtml = r.url
          ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.login)}</a>`
          : escapeHtml(r.login);
        html += `<li${isDismissed ? ' class="thread-resolved"' : ''}><strong>${nameHtml}</strong> — ${r.label} ${ago}`;
        if (r.body.trim()) html += `<div class="popup-review-body">${escapeHtml(r.body.trim().slice(0, 200))}</div>`;
        html += '</li>';
      } else if (item.kind === 'thread') {
        const { c, isResolved } = item;
        const snip = c.body.replace(/\s+/g, ' ').trim();
        const nameHtml = c.url
          ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">@${escapeHtml(c.author)}</a>`
          : `@${escapeHtml(c.author)}`;
        html += `<li${isResolved ? ' class="thread-resolved"' : ''}><strong>${nameHtml}</strong>${isResolved ? ' <span class="thread-label">(resolved)</span>' : ''}: ${escapeHtml(snip.slice(0, 200))}${snip.length > 200 ? '…' : ''} ${ago}</li>`;
      } else {
        const { c } = item;
        const snip = c.body.replace(/\s+/g, ' ').trim();
        const nameHtml = c.url
          ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">@${escapeHtml(c.author)}</a>`
          : `@${escapeHtml(c.author)}`;
        html += `<li><strong>${nameHtml}</strong>: ${escapeHtml(snip.slice(0, 200))}${snip.length > 200 ? '…' : ''} ${ago}</li>`;
      }
    }
    html += '</ul>';
  }

  if (!showClosed && closedThreadCount > 0 && !items.some(i => i.kind === 'thread' && i.isResolved)) {
    html += `<p class="muted" style="font-size:.78rem">${closedThreadCount} resolved thread${closedThreadCount > 1 ? 's' : ''} hidden.</p>`;
  }

  if (!html) html = '<p class="muted" style="font-size:.85rem">No reviews yet.</p>';
  reviewDialogContent.innerHTML = html;
}

function showReviewDialog(pr) {
  currentReviewPr = pr;
  showClosedToggle.checked = false;
  reviewDialogTitle.textContent = `#${pr.number} ${pr.title}`;
  renderReviewContent(pr);
  reviewDialog.showModal();
}

function ownersTag(pr) {
  const op = pr.ownersPending;
  if (!op) return '';
  const href = op.checkUrl ? ` href="${escapeHtml(op.checkUrl)}" target="_blank" rel="noopener"` : '';
  const tag = op.status === 'pass'
    ? `<a class="owners-tag owners-pass"${href}>owners ✅</a>`
    : op.status === 'fail'
      ? `<a class="owners-tag owners-fail"${href}>owners ⏳</a>`
      : `<a class="owners-tag owners-running"${href}>owners 🟡</a>`;
  return `<div>${tag}</div>`;
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
      <td class="td-number"><a href="${escapeHtml(pr.url)}" target="_blank" rel="noopener">${pr.number}</a></td>
      <td class="td-author">${escapeHtml(pr.author)}</td>
      <td>${pr.labels.filter(l => !(l === 'commenter' && pr.labels.includes('author'))).map(l => `<span class="tag">${PARTICIPATION[l]}</span>`).join('')}</td>
      <td class="td-review">
        <span class="review-label review-${pr.review}">${REVIEW[pr.review]}</span>${ownersTag(pr)}
      </td>
      <td class="ci-${pr.ci}">${CI[pr.ci]}</td>
      <td class="td-time">${timeCell(pr.createdAt)}</td>
      <td class="td-time">${timeCell(pr.updatedAt)}</td>
      <td>
        <div><a href="${escapeHtml(pr.url)}" target="_blank" rel="noopener" class="pr-title-link">${escapeHtml(pr.title)}</a></div>
        <div class="repo">${escapeHtml(pr.repo)}</div>
        ${pr.labels.includes('author') ? authorInfo(pr) : ''}
      </td>`;
    tr.querySelector('.td-number a').addEventListener('click', () => {
      const s = loadSeen();
      s[pr.key] = pr.updatedAt;
      saveSeen(s);
      tr.querySelector('.dot')?.remove();
    });
    tr.querySelector('.review-label').addEventListener('click', (e) => { e.stopPropagation(); showReviewDialog(pr); });
    tr.querySelector('.owners-tag')?.addEventListener('click', (e) => e.stopPropagation());
    els.rows.appendChild(tr);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function notifyChanges(prevPrs, nextPrs) {
  if (!prevPrs.length || !isNotifyOn() || Notification.permission !== 'granted') return;
  const prevMap = new Map(prevPrs.map(pr => [pr.key, pr.updatedAt]));
  for (const pr of nextPrs) {
    const prev = prevMap.get(pr.key);
    if (pr.updatedAt && (!prev || pr.updatedAt > prev)) {
      const snip = (pr.latestComment?.body ?? '').replace(/\s+/g, ' ').slice(0, 100);
      const title = pr.latestComment?.author ? `💬 ${pr.latestComment.author} on ${pr.title}` : `🔔 ${pr.title}`;
      const n = new Notification(title, { body: snip || 'PR updated', tag: pr.url });
      n.onclick = () => { window.open(pr.url, '_blank', 'noopener'); n.close(); };
    }
  }
}

async function load() {
  els.error.style.display = 'none';
  if (!allPrs.length) {
    els.rows.innerHTML = '<tr><td colspan="10" class="muted">Loading…</td></tr>';
  }
  try {
    const res = await fetch(`/api/prs?scope=${currentScope}&days=${currentDays}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    els.subtitle.textContent = `${data.user} @ ${data.org} · ${data.prs.length} PRs`;
    notifyChanges(allPrs, data.prs);
    allPrs = data.prs;
    buildAuthorFilter(allPrs);
    render();
  } catch (err) {
    if (!allPrs.length) els.rows.innerHTML = '';
    els.error.textContent = 'Failed to load PRs: ' + err.message;
    els.error.style.display = 'block';
  }
}

els.refresh.addEventListener('click', load);
els.markRead.addEventListener('click', () => {
  const seen = loadSeen();
  for (const pr of visiblePrs()) seen[pr.key] = pr.updatedAt;
  saveSeen(seen);
  render();
});

// ── Chrome notifications ──────────────────────────────────────
const NOTIFY_KEY = 'pr-dashboard:notify';
const notifyToggle = document.getElementById('notifyToggle');

function isNotifyOn() {
  return localStorage.getItem(NOTIFY_KEY) === 'on';
}

function applyNotifyUI() {
  if (isNotifyOn()) {
    notifyToggle.textContent = '🔕 Mute';
    notifyToggle.classList.remove('off');
  } else {
    notifyToggle.textContent = '🔔 Notify';
    notifyToggle.classList.add('off');
  }
}

async function enableNotifications() {
  if (typeof Notification === 'undefined') { applyNotifyUI(); return; }
  if (Notification.permission === 'denied') {
    alert('Notification permission denied. Click the lock icon in the address bar → Notifications → Allow, then refresh.');
    return;
  }
  if (Notification.permission === 'granted') {
    localStorage.setItem(NOTIFY_KEY, 'on');
    applyNotifyUI();
    return;
  }
  const perm = await Notification.requestPermission();
  localStorage.setItem(NOTIFY_KEY, perm === 'granted' ? 'on' : 'off');
  applyNotifyUI();
}

notifyToggle.addEventListener('click', () => {
  if (isNotifyOn()) {
    localStorage.setItem(NOTIFY_KEY, 'off');
    applyNotifyUI();
  } else {
    enableNotifications();
  }
});

applyNotifyUI();

// ── Auto-refresh ──────────────────────────────────────────────
const AUTO_REFRESH_KEY = 'pr-dashboard:auto-refresh';
const autoRefreshToggle = document.getElementById('auto-refresh-toggle');
const refreshIntervalSelect = document.getElementById('refresh-interval');
let refreshTimer = null;

function loadAutoRefreshPrefs() {
  try { return JSON.parse(localStorage.getItem(AUTO_REFRESH_KEY)) ?? {}; } catch { return {}; }
}
function saveAutoRefreshPrefs() {
  localStorage.setItem(AUTO_REFRESH_KEY, JSON.stringify({
    enabled: autoRefreshToggle.checked,
    interval: refreshIntervalSelect.value,
  }));
}

function applyAutoRefreshPrefs() {
  const p = loadAutoRefreshPrefs();
  if (p.enabled === false) autoRefreshToggle.checked = false;
  if (p.interval) {
    const opt = refreshIntervalSelect.querySelector(`option[value="${p.interval}"]`);
    if (opt) refreshIntervalSelect.value = p.interval;
  }
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  if (autoRefreshToggle.checked) {
    refreshTimer = setInterval(load, Number(refreshIntervalSelect.value) * 1000);
  }
}

autoRefreshToggle.addEventListener('change', () => { saveAutoRefreshPrefs(); scheduleRefresh(); });
refreshIntervalSelect.addEventListener('change', () => { saveAutoRefreshPrefs(); scheduleRefresh(); });

applyAutoRefreshPrefs();
scheduleRefresh();
// ─────────────────────────────────────────────────────────────

load();
