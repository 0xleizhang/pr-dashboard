import { isNewActivity, latestActivityOf } from './shared.js';

const SEEN_KEY = 'pr-dashboard:seen';
const PREFS_KEY = 'pr-dashboard:prefs';
const THEME_KEY = 'pr-dashboard:theme';
const COL_VISIBILITY_KEY = 'pr-dashboard:col-visibility';

const HIDEABLE_COLS = [
  { idx: 1, label: 'State',         defaultW: 72  },
  { idx: 2, label: 'PR#',           defaultW: 52  },
  { idx: 3, label: 'Author',        defaultW: 90  },
  { idx: 4, label: 'Participation', defaultW: 110 },
  { idx: 5, label: 'Review',        defaultW: 120 },
  { idx: 6, label: 'CI',            defaultW: 72  },
  { idx: 7, label: 'Created',       defaultW: 88  },
  { idx: 8, label: 'Updated',       defaultW: 88  },
];

const JIRA_ICON = '<svg width="11" height="11" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="vertical-align:-.1em;margin-right:.2em"><path d="M15.78.42L.42 15.78a1.44 1.44 0 000 2.04l15.36 15.36a1.44 1.44 0 002.04 0l15.36-15.36a1.44 1.44 0 000-2.04L17.82.42a1.44 1.44 0 00-2.04 0z" fill="#2684FF"/><path d="M16.8 8.5l-5.5 5.5 2.75 2.75L16.8 14l2.75 2.75L22.3 14z" fill="#0052CC"/></svg>';

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
let currentUser = '';

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

function loadColVisibility() {
  try { return JSON.parse(localStorage.getItem(COL_VISIBILITY_KEY)) || {}; }
  catch { return {}; }
}

function saveColVisibility(v) {
  localStorage.setItem(COL_VISIBILITY_KEY, JSON.stringify(v));
}

function applyColVisibility(v) {
  const cols = document.querySelectorAll('#colgroup col');
  const savedWidths = loadColWidths();
  for (const { idx, defaultW } of HIDEABLE_COLS) {
    const hidden = v[idx] === false;
    if (cols[idx]) {
      if (hidden) {
        // visibility:collapse hides cells and collapses width to 0.
        // Also set width:0 explicitly so table-layout:fixed allocates no space.
        // Do NOT use display:none on th/td — it shifts col-to-cell alignment.
        cols[idx].style.width = '0px';
        cols[idx].style.visibility = 'collapse';
      } else {
        cols[idx].style.visibility = '';
        const w = savedWidths[idx] > 0 ? savedWidths[idx] : defaultW;
        cols[idx].style.width = w + 'px';
      }
    }
  }
  // PR title column always auto-fills remaining space
  if (cols[9]) cols[9].style.width = '';
}

function setupColumnsDropdown() {
  const btn = document.getElementById('col-visibility-btn');
  const menu = document.getElementById('col-visibility-dropdown');
  const v = loadColVisibility();

  for (const { idx, label } of HIDEABLE_COLS) {
    const lbl = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = v[idx] !== false;
    cb.addEventListener('change', () => {
      const cur = loadColVisibility();
      if (cb.checked) delete cur[idx];
      else cur[idx] = false;
      saveColVisibility(cur);
      applyColVisibility(cur);
    });
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(' ' + label));
    menu.appendChild(lbl);
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && !btn.contains(e.target)) menu.classList.remove('open');
  });
}

(function initColResize() {
  const cols = document.querySelectorAll('#colgroup col');
  const saved = loadColWidths();

  // Restore saved widths (skip last col — it always auto-fills)
  cols.forEach((col, i) => {
    if (i < cols.length - 1 && saved[i] != null) col.style.width = saved[i] + 'px';
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
          if (i === cols.length - 1) return; // skip flex PR title column
          const w = parseInt(c.style.width);
          if (!isNaN(w) && w > 0) widths[i] = w;
        });
        saveColWidths(widths);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
})();
applyColVisibility(loadColVisibility());
setupColumnsDropdown();
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

const ownersDialog = document.getElementById('owners-dialog');
const ownersDialogContent = document.getElementById('owners-dialog-content');
document.getElementById('owners-dialog-close').addEventListener('click', () => ownersDialog.close());
ownersDialog.addEventListener('click', (e) => { if (e.target === ownersDialog) ownersDialog.close(); });

let currentReviewPr = null;
showClosedToggle.addEventListener('change', () => { if (currentReviewPr) renderReviewContent(currentReviewPr); });
reviewDialogContent.addEventListener('click', e => {
  if (!e.target.classList.contains('expand-btn')) return;
  const wrap = e.target.closest('.truncatable');
  wrap.querySelector('.txt-short').hidden = true;
  wrap.querySelector('.txt-full').hidden = false;
  e.target.remove();
});

function ghLabelHtml(ghLabels) {
  if (!ghLabels?.length) return '';
  return ghLabels.map(l => {
    const bg = l.color ? `#${l.color}` : '#e1e4e8';
    const hex = l.color || 'e1e4e8';
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    const fg = (r * 299 + g * 587 + b * 114) / 1000 > 140 ? '#000' : '#fff';
    return `<span class="gh-label" style="background:${bg};color:${fg}">${escapeHtml(l.name)}</span>`;
  }).join('');
}

function truncatableHtml(text, max) {
  if (text.length <= max) return escapeHtml(text);
  return `<span class="truncatable"><span class="txt-short">${escapeHtml(text.slice(0, max))}</span><span class="txt-full" hidden>${escapeHtml(text)}</span><button class="expand-btn" type="button">… more</button></span>`;
}

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
      html += `<div class="review-batch-body">${truncatableHtml(r.body.trim(), 300)}</div>`;
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
        html += `<div class="thread-comment"><strong>${cName}</strong>: ${truncatableHtml(snip, 200)} ${cAgo}</div>`;
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
      html += `<div class="thread-comment"><strong>${nameHtml}</strong>: ${truncatableHtml(snip, 200)} ${ago}</div>`;
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
  const cls = op.status === 'pass' ? 'owners-pass' : op.status === 'fail' ? 'owners-fail' : 'owners-running';
  const icon = op.status === 'pass' ? '✅' : op.status === 'fail' ? '⏳' : '🟡';
  return `<div><button class="owners-tag ${cls}" type="button">owners ${icon}</button></div>`;
}

function showOwnersDialog(pr) {
  const op = pr.ownersPending;
  if (!op) return;
  const link = op.checkUrl
    ? `<a href="${escapeHtml(op.checkUrl)}" target="_blank" rel="noopener">owners-files ↗</a>`
    : 'owners-files';
  let html = '';
  if (op.status === 'pass') {
    html = `<div class="owners-ok">✅ OWNERS approved — ${link}</div>`;
  } else if (op.status === 'fail') {
    html = `<div class="owners-pending"><strong>⏳ Pending OWNERS approval</strong> — ${link}`;
    if (op.pending?.length) {
      html += `<ul class="owners-list">`;
      for (const t of op.pending) {
        html += `<li><a href="${escapeHtml(t.url)}" target="_blank" rel="noopener">${escapeHtml(t.name)}</a></li>`;
      }
      html += `</ul>`;
    }
    html += `</div>`;
  } else {
    html = `<div class="owners-pending owners-running-banner"><strong>🟡 OWNERS check running</strong> — ${link}</div>`;
  }
  ownersDialogContent.innerHTML = html;
  ownersDialog.showModal();
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
        ${(() => { const id = extractJiraId(pr.title); const labels = ghLabelHtml(pr.ghLabels); const jira = id ? `<a class="jira-link" href="https://compass-tech.atlassian.net/browse/${escapeHtml(id)}" target="_blank" rel="noopener">${JIRA_ICON}${escapeHtml(id)}</a>` : ''; return (jira || labels) ? `<div class="pr-meta-row">${jira}${labels}</div>` : ''; })()}
        ${pr.labels.includes('author') ? authorInfo(pr) : ''}
      </td>`;
    tr.querySelector('.td-number a').addEventListener('click', () => {
      const s = loadSeen();
      s[pr.key] = pr.updatedAt;
      saveSeen(s);
      tr.querySelector('.dot')?.remove();
    });
    tr.querySelector('.review-label').addEventListener('click', (e) => { e.stopPropagation(); showReviewDialog(pr); });
    tr.querySelector('.owners-tag')?.addEventListener('click', (e) => { e.stopPropagation(); showOwnersDialog(pr); });
    els.rows.appendChild(tr);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function extractJiraId(title) {
  const m = /\[([A-Z]+-\d+)\]/.exec(title);
  return m ? m[1] : null;
}

function notifyChanges(prevPrs, nextPrs) {
  if (!prevPrs.length || !isNotifyOn() || Notification.permission !== 'granted') return;
  const prevMap = new Map(prevPrs.map(pr => [pr.key, pr.updatedAt]));
  for (const pr of nextPrs) {
    const prev = prevMap.get(pr.key);
    if (pr.updatedAt && (!prev || pr.updatedAt > prev)) {
      const latest = latestActivityOf(pr);
      const triggeredByMe = latest ? latest.author === currentUser : pr.author === currentUser;
      if (triggeredByMe) continue;
      const snip = (pr.latestComment?.body ?? '').replace(/\s+/g, ' ').slice(0, 100);
      const title = pr.latestComment?.author ? `💬 ${pr.latestComment.author} on ${pr.title}` : `🔔 ${pr.title}`;
      const body = [snip || 'PR updated', pr.url].filter(Boolean).join('\n');
      const n = new Notification(title, { body, tag: pr.url });
      n.onclick = () => { window.open(pr.url, '_blank', 'noopener'); n.close(); };
    }
  }
}

// Auto-mark PRs as seen when the latest activity was triggered by the current user,
// so self-triggered updates (own commits, own comments) never show an unread dot.
function autoMarkSelfTriggered(prs) {
  if (!currentUser) return;
  const seen = loadSeen();
  let changed = false;
  for (const pr of prs) {
    if (!isNewActivity(seen[pr.key], pr.updatedAt)) continue;
    const latest = latestActivityOf(pr);
    // If we found a recent activity event, check its author.
    // If no activity event found (e.g. a commit push), fall back to the PR author.
    const triggeredByMe = latest ? latest.author === currentUser : pr.author === currentUser;
    if (triggeredByMe) {
      seen[pr.key] = pr.updatedAt;
      changed = true;
    }
  }
  if (changed) saveSeen(seen);
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
    currentUser = data.user;
    autoMarkSelfTriggered(data.prs);
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
    notifyToggle.textContent = '🔔 Notify On';
    notifyToggle.classList.remove('off');
  } else {
    notifyToggle.textContent = '🔔 Notify Off';
    notifyToggle.classList.add('off');
  }
}

function sendTestNotification() {
  const n = new Notification('🔔 PR Dashboard notifications enabled', { body: 'You will receive PR update alerts' });
  setTimeout(() => n.close(), 4000);
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
    sendTestNotification();
    return;
  }
  const perm = await Notification.requestPermission();
  localStorage.setItem(NOTIFY_KEY, perm === 'granted' ? 'on' : 'off');
  applyNotifyUI();
  if (perm === 'granted') sendTestNotification();
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
