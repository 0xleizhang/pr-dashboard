import { isNewActivity, latestActivityOf } from './shared.js';

const SEEN_KEY = 'pr-dashboard:seen';
const PREFS_KEY = 'pr-dashboard:prefs';
const THEME_KEY = 'pr-dashboard:theme';
const COL_VISIBILITY_KEY = 'pr-dashboard:col-visibility';
const COL_ORDER_KEY = 'pr-dashboard:col-order';

const DEFAULT_COL_ORDER = [1, 3, 4, 5, 7, 8];
let currentColOrder = [...DEFAULT_COL_ORDER];

const COL_DEF = {
  1: { label: 'State',         defaultW: 72  },
  3: { label: 'Author',        defaultW: 90  },
  4: { label: 'Participation', defaultW: 110 },
  5: { label: 'Status',        defaultW: 150 },
  7: { label: 'Created',       defaultW: 88  },
  8: { label: 'Updated',       defaultW: 88  },
};

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

const PARTICIPATION = { author: '🖊 author', reviewer: '👁 reviewer', mention: '@ mention', assignee: '👤 assignee' };
const STATUS_LABEL = {
  ci_failed:      '🔴 ci failed',
  approved:       '✅ approved',
  author_turn:    '✏️ author turn',
  part_approved:  '🔶 part approved',
  lead_re_review: '👀 lead re-review',
  wait_re_review: '🔍 wait re-review',
  none:           '⚪ none',
  ci_pending:     '🟡 ci pending',
  ci_unknown:     '❓ ci unknown',
};
const STATE = { open: 'open', draft: 'draft', closed: 'closed', merged: 'merged' };

function prState(pr) {
  if (pr.isDraft) return 'draft';
  if (pr.state === 'MERGED') return 'merged';
  if (pr.state === 'CLOSED') return 'closed';
  return 'open';
}

function approverNames(pr) {
  return (pr.reviewDetail?.reviewers ?? [])
    .filter(r => r.state === 'APPROVED')
    .map(r => r.login);
}

function statusLabel(pr) {
  const s = pr.status ?? 'none';
  const label = STATUS_LABEL[s] ?? s;
  let tip = '';
  if (s === 'approved' || s === 'part_approved') {
    const approvers = approverNames(pr);
    if (approvers.length) tip = `Approved by: ${approvers.join(', ')}`;
  }
  const title = tip ? ` title="${escapeHtml(tip)}"` : '';
  return `<span class="status-label status-${s}"${title}>${label}</span>`;
}

const COL_RENDERERS = {
  1: (pr) => `<td class="td-state"><span class="state state-${prState(pr)}">${STATE[prState(pr)]}</span></td>`,
  3: (pr) => `<td class="td-author">${escapeHtml(pr.author)}</td>`,
  4: (pr) => `<td class="td-participation">${pr.labels.map(l => `<span class="tag">${PARTICIPATION[l]}</span>`).join('')}</td>`,
  5: (pr) => `<td class="td-status">${statusLabel(pr)}${ownersTag(pr)}</td>`,
  7: (pr) => `<td class="td-time td-created">${timeCell(pr.createdAt)}</td>`,
  8: (pr) => `<td class="td-time td-updated">${timeCell(pr.updatedAt)}</td>`,
};

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
  const participation = [...document.querySelectorAll('#participation-dropdown input[type="checkbox"]:checked')].map(i => i.value);
  localStorage.setItem(PREFS_KEY, JSON.stringify({ sort: sortState, stateFilter, participation, meMode, days: currentDays }));
}

const STATUS_SORT_PRIORITY = {
  approved:       0,
  ci_failed:      1,
  author_turn:    2,
  part_approved:  3,
  lead_re_review: 4,
  wait_re_review: 5,
  none:           6,
  ci_pending:     7,
  ci_unknown:     8,
};

function statusPriority(pr) {
  return STATUS_SORT_PRIORITY[pr.status] ?? 9;
}

const SORTERS = {
  number:  { asc: (a, b) => a.number - b.number,           desc: (a, b) => b.number - a.number },
  author:  { asc: (a, b) => a.author.localeCompare(b.author), desc: (a, b) => b.author.localeCompare(a.author) },
  created: { asc: (a, b) => new Date(a.createdAt) - new Date(b.createdAt), desc: (a, b) => new Date(b.createdAt) - new Date(a.createdAt) },
  updated: { asc: (a, b) => new Date(a.updatedAt) - new Date(b.updatedAt), desc: (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt) },
  status:  {
    desc: (a, b) => (statusPriority(a) - statusPriority(b)) || (new Date(b.updatedAt) - new Date(a.updatedAt)),
    asc:  (a, b) => (statusPriority(b) - statusPriority(a)) || (new Date(b.updatedAt) - new Date(a.updatedAt)),
  },
};

let sortState = { col: 'updated', dir: 'desc' };

const sortCols = {
  'th-author':  'author',
  'th-status':  'status',
  'th-created': 'created',
  'th-updated': 'updated',
};

const MOBILE_SORT_BTNS = {
  'mobile-sort-status':  'status',
  'mobile-sort-created': 'created',
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
  for (const [id, col] of Object.entries(MOBILE_SORT_BTNS)) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    const isActive = sortState.col === col;
    btn.classList.toggle('active', isActive);
    const label = col === 'status' ? 'Status' : 'Created';
    btn.textContent = isActive
      ? label + (sortState.dir === 'desc' ? ' ↓' : ' ↑')
      : label;
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

for (const [id, col] of Object.entries(MOBILE_SORT_BTNS)) {
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

function loadColOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(COL_ORDER_KEY));
    if (Array.isArray(saved) && saved.length === DEFAULT_COL_ORDER.length) return saved;
  } catch {}
  return [...DEFAULT_COL_ORDER];
}

function saveColOrder(order) {
  localStorage.setItem(COL_ORDER_KEY, JSON.stringify(order));
}

function applyColVisibility(v) {
  const savedWidths = loadColWidths();
  for (const [idxStr, def] of Object.entries(COL_DEF)) {
    const idx = Number(idxStr);
    const col = document.querySelector(`#colgroup col[data-col-idx="${idx}"]`);
    if (!col) continue;
    const hidden = v[idx] === false;
    if (hidden) {
      col.style.width = '0px';
      col.style.visibility = 'collapse';
    } else {
      col.style.visibility = '';
      const w = savedWidths[idx] > 0 ? savedWidths[idx] : def.defaultW;
      col.style.width = w + 'px';
    }
  }
}

function applyColOrder(order) {
  currentColOrder = order;
  const colgroup = document.getElementById('colgroup');
  const theadRow = document.getElementById('thead-row');
  const titleCol = colgroup.lastElementChild;
  const titleTh = theadRow.lastElementChild;
  // Re-insert col and th elements in the new order (after the fixed dot col/th)
  for (const idx of [...order].reverse()) {
    const col = colgroup.querySelector(`col[data-col-idx="${idx}"]`);
    if (col) colgroup.insertBefore(col, colgroup.children[1]);
    const th = theadRow.querySelector(`th[data-col-idx="${idx}"]`);
    if (th) theadRow.insertBefore(th, theadRow.children[1]);
  }
}

function setupSettingsModal() {
  const dialog = document.getElementById('settings-dialog');
  const openBtn = document.getElementById('settings-btn');
  const closeBtn = document.getElementById('settings-close');
  const colContainer = document.getElementById('settings-col-config');
  let dragIdx = null;

  function buildColList() {
    colContainer.innerHTML = '';
    const v = loadColVisibility();
    for (const idx of currentColOrder) {
      const def = COL_DEF[idx];
      const row = document.createElement('div');
      row.className = 'col-config-row';
      row.dataset.idx = idx;
      row.draggable = true;

      const handle = document.createElement('span');
      handle.className = 'drag-handle';
      handle.textContent = '⠿';

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
      lbl.appendChild(document.createTextNode(' ' + def.label));

      row.appendChild(handle);
      row.appendChild(lbl);
      colContainer.appendChild(row);
    }
  }

  colContainer.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.col-config-row');
    if (!row) return;
    dragIdx = Number(row.dataset.idx);
    e.dataTransfer.effectAllowed = 'move';
  });

  colContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const row = e.target.closest('.col-config-row');
    colContainer.querySelectorAll('.col-config-row').forEach(r => r.classList.remove('drag-over'));
    if (row) row.classList.add('drag-over');
  });

  colContainer.addEventListener('dragleave', (e) => {
    if (!colContainer.contains(e.relatedTarget)) {
      colContainer.querySelectorAll('.col-config-row').forEach(r => r.classList.remove('drag-over'));
    }
  });

  colContainer.addEventListener('drop', (e) => {
    e.preventDefault();
    colContainer.querySelectorAll('.col-config-row').forEach(r => r.classList.remove('drag-over'));
    const row = e.target.closest('.col-config-row');
    if (!row || dragIdx === null) return;
    const dropIdx = Number(row.dataset.idx);
    if (dragIdx === dropIdx) { dragIdx = null; return; }
    const order = [...currentColOrder];
    const from = order.indexOf(dragIdx);
    const to = order.indexOf(dropIdx);
    order.splice(from, 1);
    order.splice(to, 0, dragIdx);
    saveColOrder(order);
    applyColOrder(order);
    applyColVisibility(loadColVisibility());
    render();
    buildColList();
    dragIdx = null;
  });

  buildColList();

  openBtn.addEventListener('click', () => {
    buildColList();
    dialog.showModal();
  });
  closeBtn.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
}

function initColResize() {
  const colgroup = document.getElementById('colgroup');
  const theadRow = document.getElementById('thead-row');
  const saved = loadColWidths();

  // Restore saved widths by semantic index
  colgroup.querySelectorAll('col[data-col-idx]').forEach(col => {
    const idx = Number(col.dataset.colIdx);
    if (saved[idx] != null) col.style.width = saved[idx] + 'px';
  });

  // Attach drag logic to every .col-resizer handle
  theadRow.querySelectorAll('th').forEach((th, pos) => {
    const handle = th.querySelector('.col-resizer');
    if (!handle) return;

    handle.addEventListener('mousedown', (e) => {
      // Resolve col at current position at drag time (survives reorder)
      const allCols = [...document.querySelectorAll('#colgroup col')];
      const col = allCols[pos];
      if (!col) return;
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
        // Save by semantic index
        const widths = loadColWidths();
        document.querySelectorAll('#colgroup col[data-col-idx]').forEach(c => {
          const idx = Number(c.dataset.colIdx);
          const w = parseInt(c.style.width);
          if (!isNaN(w) && w > 0) widths[idx] = w;
        });
        saveColWidths(widths);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}
applyColOrder(loadColOrder());
applyColVisibility(loadColVisibility());
initColResize();
setupSettingsModal();
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

// Stubs reassigned below
let activeStateFilter = () => [];
let activeTypeFilter = () => [];

activeStateFilter = () => {
  const checked = [...document.querySelectorAll('#state-dropdown input:checked')];
  return checked.map(i => i.value);
};

activeTypeFilter = () => {
  return [...document.querySelectorAll('#participation-dropdown input[type="checkbox"]:checked')].map(i => i.value);
  // empty array = all (no filter)
};

let currentDays = 14;
let meMode = 'author'; // 'author' | 'involved' | 'all'
let lastLoadedMeOnly = true;

function getMeOnly() {
  const checked = [...document.querySelectorAll('#participation-dropdown input[type="checkbox"]:checked')].map(i => i.value);
  return checked.length === 1 && checked[0] === 'author';
}

function applyMeSeg(mode) {
  meMode = mode;
  document.querySelectorAll('#me-seg .seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  const boxes = document.querySelectorAll('#participation-dropdown input[type="checkbox"]');
  if (mode === 'author') {
    boxes.forEach(inp => { inp.checked = inp.value === 'author'; });
  } else if (mode === 'involved') {
    boxes.forEach(inp => { inp.checked = inp.value !== 'author'; });
  } else {
    boxes.forEach(inp => { inp.checked = false; });
  }
  savePrefs();
  const newMeOnly = getMeOnly();
  if (lastLoadedMeOnly !== newMeOnly) {
    load();
  } else {
    render();
  }
}

function syncSegFromParticipation() {
  const checked = new Set([...document.querySelectorAll('#participation-dropdown input[type="checkbox"]:checked')].map(i => i.value));
  let mode = null;
  if (checked.size === 1 && checked.has('author')) {
    mode = 'author';
  } else if (checked.size === 3 && !checked.has('author')) {
    mode = 'involved';
  } else if (checked.size === 0) {
    mode = 'all';
  }
  if (mode) meMode = mode;
  document.querySelectorAll('#me-seg .seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

(function applyPrefs() {
  const p = loadPrefs();
  if (p.sort) sortState = p.sort;
  if (p.stateFilter) {
    document.querySelectorAll('#state-dropdown input').forEach(inp => {
      inp.checked = p.stateFilter.includes(inp.value);
    });
  }
  if (p.meMode) {
    meMode = p.meMode;
  } else if (p.meOnly !== undefined) {
    meMode = p.meOnly ? 'author' : 'all';
  }
  const boxes = document.querySelectorAll('#participation-dropdown input[type="checkbox"]');
  if (p.participation && Array.isArray(p.participation)) {
    boxes.forEach(inp => { inp.checked = p.participation.includes(inp.value); });
  } else {
    if (meMode === 'author') {
      boxes.forEach(inp => { inp.checked = inp.value === 'author'; });
    } else if (meMode === 'involved') {
      boxes.forEach(inp => { inp.checked = inp.value !== 'author'; });
    } else {
      boxes.forEach(inp => { inp.checked = false; });
    }
  }
  document.querySelectorAll('#me-seg .seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === meMode);
  });
  if (p.days) {
    currentDays = p.days;
    document.getElementById('days-select').value = String(currentDays);
  }
  updateSortUI();
})();

lastLoadedMeOnly = getMeOnly();

document.querySelectorAll('#me-seg .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => applyMeSeg(btn.dataset.mode));
});

document.getElementById('days-select').addEventListener('change', (e) => {
  currentDays = Number(e.target.value);
  savePrefs();
  load();
});

let stateLoadTimer = null;
document.getElementById('state-dropdown').addEventListener('change', () => {
  savePrefs();
  clearTimeout(stateLoadTimer);
  stateLoadTimer = setTimeout(load, 400);
});

document.getElementById('participation-dropdown').addEventListener('change', () => {
  const newMeOnly = getMeOnly();
  syncSegFromParticipation();
  savePrefs();
  if (lastLoadedMeOnly !== newMeOnly) {
    load();
  } else {
    render();
  }
});

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

function makeChip(labelText, value, onRemove) {
  const chip = document.createElement('span');
  chip.className = 'filter-chip';
  chip.innerHTML = `<span class="filter-chip-label">${escapeHtml(labelText)}</span>${escapeHtml(value)}<button class="filter-chip-remove" title="清除">✕</button>`;
  chip.querySelector('.filter-chip-remove').addEventListener('click', onRemove);
  return chip;
}

function updateFilterIndicators() {
  const bar = document.getElementById('filter-bar');
  bar.innerHTML = '';

  const stateFilter = activeStateFilter();
  const isDefaultState = stateFilter.length === 2 && stateFilter.includes('open') && stateFilter.includes('draft');
  if (!isDefaultState && stateFilter.length > 0) {
    bar.appendChild(makeChip('State: ', stateFilter.join(', '), () => {
      document.querySelectorAll('#state-dropdown input').forEach(i => { i.checked = i.value === 'open' || i.value === 'draft'; });
      savePrefs(); load();
    }));
  }

  const typeFilter = activeTypeFilter();
  if (typeFilter.length > 0) {
    bar.appendChild(makeChip('Participation: ', typeFilter.join(', '), () => {
      document.querySelectorAll('#participation-dropdown input[type="checkbox"]').forEach(i => { i.checked = false; });
      syncSegFromParticipation();
      savePrefs(); render();
    }));
  }

  const authorFilter = activeAuthorFilter();
  if (authorFilter.length > 0) {
    bar.appendChild(makeChip('Author: ', authorFilter.join(', '), () => {
      authorList.querySelectorAll('input').forEach(i => { i.checked = false; });
      authorAllCheckbox.checked = true;
      render();
    }));
  }
}

function visiblePrs() {
  const stateFilter = activeStateFilter();
  const typeFilter = activeTypeFilter(); // array, empty = all
  const authorFilter = activeAuthorFilter();
  let filtered = allPrs;
  if (stateFilter.length) filtered = filtered.filter(pr => stateFilter.includes(prState(pr)));
  if (typeFilter.length) filtered = filtered.filter(pr => typeFilter.some(t => pr.labels.includes(t)));
  if (authorFilter.length) filtered = filtered.filter(pr => authorFilter.includes(pr.author));
  const sorter = SORTERS[sortState.col]?.[sortState.dir] ?? SORTERS.updated.desc;
  return [...filtered].sort(sorter);
}

function recentEventsHtml(pr, seenEntry, user) {
  const lastSeenTs = typeof seenEntry === 'string' ? seenEntry : seenEntry?.ts;
  const lastSeenCommits = typeof seenEntry === 'string' ? null : (seenEntry?.commits ?? null);
  if (!lastSeenTs) return '';

  const isAuthor = pr.labels.includes('author');
  const events = [];

  if (isAuthor) {
    for (const r of pr.reviewDetail?.reviewers ?? []) {
      if (r.login === user) continue;
      if (r.submittedAt && r.submittedAt > lastSeenTs) {
        const action = r.state === 'APPROVED' ? 'approved'
          : r.state === 'CHANGES_REQUESTED' ? 'changes requested'
          : 'commented';
        events.push(`${escapeHtml(r.login)}: ${action}`);
      }
    }
    for (const c of pr.reviewDetail?.comments ?? []) {
      if (c.author === user) continue;
      if (c.createdAt && c.createdAt > lastSeenTs) {
        events.push(`${escapeHtml(c.author)} commented`);
      }
    }
  } else {
    if (lastSeenCommits !== null && pr.commitCount > lastSeenCommits) {
      const diff = pr.commitCount - lastSeenCommits;
      events.push(`${diff} new commit${diff > 1 ? 's' : ''}`);
    }
    for (const r of pr.reviewDetail?.reviewers ?? []) {
      for (const t of r.threads ?? []) {
        if (!t.comments.some(c => c.author === user)) continue;
        for (const c of t.comments) {
          if (c.author === user) continue;
          if (c.createdAt && c.createdAt > lastSeenTs) {
            const file = t.path ? t.path.split('/').pop() : 'code';
            events.push(`${escapeHtml(c.author)} replied on ${escapeHtml(file)}`);
            break;
          }
        }
      }
    }
    for (const t of pr.reviewDetail?.orphanThreads ?? []) {
      if (!t.comments.some(c => c.author === user)) continue;
      for (const c of t.comments) {
        if (c.author === user) continue;
        if (c.createdAt && c.createdAt > lastSeenTs) {
          const file = t.path ? t.path.split('/').pop() : 'code';
          events.push(`${escapeHtml(c.author)} replied on ${escapeHtml(file)}`);
          break;
        }
      }
    }
  }

  if (!events.length) return '';
  return `<div class="recent-events-wrap"><div class="recent-events">${events.join(' · ')}</div></div>`;
}


const reviewDialog = document.getElementById('review-dialog');
const reviewDialogTitle = document.getElementById('review-dialog-title');
const reviewDialogContent = document.getElementById('review-dialog-content');
const showClosedToggle = document.getElementById('show-closed-toggle');
const SHOW_CLOSED_KEY = 'pr-dashboard:hide-closed-reviews';
showClosedToggle.checked = localStorage.getItem(SHOW_CLOSED_KEY) !== 'off';
showClosedToggle.addEventListener('change', () => {
  localStorage.setItem(SHOW_CLOSED_KEY, showClosedToggle.checked ? 'on' : 'off');
  if (currentReviewPr) renderReviewContent(currentReviewPr);
});
document.getElementById('review-dialog-close').addEventListener('click', () => reviewDialog.close());
reviewDialog.addEventListener('click', (e) => { if (e.target === reviewDialog) reviewDialog.close(); });

const ownersDialog = document.getElementById('owners-dialog');
const ownersDialogContent = document.getElementById('owners-dialog-content');
document.getElementById('owners-dialog-close').addEventListener('click', () => ownersDialog.close());
ownersDialog.addEventListener('click', (e) => { if (e.target === ownersDialog) ownersDialog.close(); });

const hideMyToggle = document.getElementById('hide-my-toggle');
const HIDE_MY_KEY = 'pr-dashboard:hide-my-comments';
hideMyToggle.checked = localStorage.getItem(HIDE_MY_KEY) !== 'off';
hideMyToggle.addEventListener('change', () => {
  localStorage.setItem(HIDE_MY_KEY, hideMyToggle.checked ? 'on' : 'off');
  if (currentReviewPr) renderReviewContent(currentReviewPr);
});

const onlyUnrepliedToggle = document.getElementById('only-unreplied-toggle');
const ONLY_UNREPLIED_KEY = 'pr-dashboard:only-unreplied';
onlyUnrepliedToggle.checked = localStorage.getItem(ONLY_UNREPLIED_KEY) === 'on';
onlyUnrepliedToggle.addEventListener('change', () => {
  localStorage.setItem(ONLY_UNREPLIED_KEY, onlyUnrepliedToggle.checked ? 'on' : 'off');
  if (currentReviewPr) renderReviewContent(currentReviewPr);
});

let currentReviewPr = null;
reviewDialogContent.addEventListener('click', e => {
  if (e.target.classList.contains('expand-btn')) {
    const wrap = e.target.closest('.truncatable');
    wrap.querySelector('.txt-short').hidden = true;
    wrap.querySelector('.txt-full').hidden = false;
    e.target.remove();
    return;
  }
  const header = e.target.closest('.reviewer-group-header');
  if (header) {
    const group = header.closest('.reviewer-group');
    const icon = header.querySelector('.batch-collapse-icon');
    group.classList.toggle('collapsed');
    if (icon) icon.textContent = group.classList.contains('collapsed') ? '▶' : '▼';
  }
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
  const showClosed = !showClosedToggle.checked;
  const { reviewers, comments, orphanThreads = [] } = pr.reviewDetail;

  let html = '';
  let commentNum = 0;
  const numLink = (url, n) => url
    ? `<a href="${escapeHtml(url)}" class="comment-num" target="_blank" rel="noopener">#${n}</a>`
    : `<span class="comment-num">#${n}</span>`;

  const visibleReviewers = reviewers.filter(r => {
    if (r.state === 'DISMISSED' && !showClosed) return false;
    if (hideMyToggle.checked && r.login === currentUser) return false;
    return true;
  });

  const visibleComments = hideMyToggle.checked ? comments.filter(c => c.author !== currentUser) : comments;

  // Flatten all events individually so each gets placed in its own day's round
  const allEvents = [];

  for (const r of visibleReviewers) {
    // Review submission header (state + body) goes in the review's own day
    allEvents.push({ type: 'review', ts: r.submittedAt || '', login: r.login, label: r.label, state: r.state, url: r.url, body: r.body });
    // Entire thread goes in the round of the FIRST comment (ci=0), keeping replies with their original
    for (const t of r.threads) {
      const authorReplied = t.comments.some(c => c.author === currentUser);
      if (onlyUnrepliedToggle.checked && authorReplied) continue;
      const roundTs = t.comments[0]?.createdAt || r.submittedAt || '';
      for (let ci = 0; ci < t.comments.length; ci++) {
        allEvents.push({ type: 'thread', ts: roundTs, thread: t, comment: t.comments[ci], isReply: ci > 0 });
      }
    }
  }
  for (const c of visibleComments) {
    allEvents.push({ type: 'pr-comment', ts: c.createdAt || '', comment: c });
  }
  for (const t of orphanThreads) {
    const roundTs = t.comments[0]?.createdAt || '';
    for (let ci = 0; ci < t.comments.length; ci++) {
      allEvents.push({ type: 'thread', ts: roundTs, thread: t, comment: t.comments[ci], isReply: ci > 0 });
    }
  }

  // Group events by calendar day
  const roundMap = new Map();
  for (const event of allEvents) {
    const dateStr = event.ts ? event.ts.slice(0, 10) : 'unknown';
    if (!roundMap.has(dateStr)) roundMap.set(dateStr, { date: dateStr, earliestTime: '', events: [] });
    const round = roundMap.get(dateStr);
    if (event.ts && (!round.earliestTime || event.ts < round.earliestTime)) round.earliestTime = event.ts;
    round.events.push(event);
  }

  const rounds = [...roundMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, r]) => r);

  for (let ri = 0; ri < rounds.length; ri++) {
    const round = rounds[ri];
    const isLast = ri >= rounds.length - 2;
    const dateLabel = round.date !== 'unknown' ? round.date.slice(5).replace('-', '/') : '?';
    const ago = round.earliestTime ? `<span class="time-ago">${timeAgo(round.earliestTime)}</span>` : '';
    const collapseIcon = `<span class="batch-collapse-icon">${isLast ? '▼' : '▶'}</span>`;

    // Build per-author comment counts for summary
    const authorCounts = new Map();
    for (const ev of round.events) {
      const login = ev.type === 'thread' ? ev.comment.author
        : ev.type === 'pr-comment' ? ev.comment.author
        : (ev.type === 'review' && ev.body.trim()) ? ev.login : null;
      if (login) authorCounts.set(login, (authorCounts.get(login) || 0) + 1);
    }
    const summaryHtml = [...authorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([login, n]) => `@${escapeHtml(login)} ${n}`)
      .join(' · ');

    html += `<div class="reviewer-group${isLast ? '' : ' collapsed'}">`;
    html += `<div class="reviewer-group-header">${collapseIcon}<span class="round-date">${escapeHtml(dateLabel)}</span> ${ago}${summaryHtml ? `<span class="round-summary">${summaryHtml}</span>` : ''}</div>`;
    html += `<div class="reviewer-group-body">`;

    // Within the round: group thread events by thread object, non-thread events stay flat
    // Then merge into a time-sorted list for rendering
    const threadGroupMap = new Map(); // thread -> { firstTs, events[] }
    const nonThreadEvents = [];
    for (const event of round.events) {
      if (event.type === 'thread') {
        if (!threadGroupMap.has(event.thread)) threadGroupMap.set(event.thread, { thread: event.thread, firstTs: event.ts, events: [] });
        const tg = threadGroupMap.get(event.thread);
        if (event.ts < tg.firstTs) tg.firstTs = event.ts;
        tg.events.push(event);
      } else {
        nonThreadEvents.push(event);
      }
    }

    const mergedItems = [
      ...[...threadGroupMap.values()].map(tg => ({ type: 'thread-group', ts: tg.firstTs, tg })),
      ...nonThreadEvents,
    ].sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));

    for (const item of mergedItems) {
      if (item.type === 'thread-group') {
        const { thread, events } = item.tg;
        const fileLabel = thread.line != null ? `${thread.path}:${thread.line}` : thread.path;
        html += `<div class="file-group${thread.isResolved ? ' thread-resolved' : ''}">`;
        html += `<div class="file-path">${escapeHtml(fileLabel)}</div>`;
        const sortedEvs = events.sort((a, b) => (a.comment.createdAt || '').localeCompare(b.comment.createdAt || ''));
        for (let evi = 0; evi < sortedEvs.length; evi++) {
          const ev = sortedEvs[evi];
          const c = ev.comment;
          const snip = c.body.replace(/\s+/g, ' ').trim();
          const cAgo = c.createdAt ? `<span class="time-ago">${timeAgo(c.createdAt)}</span>` : '';
          const n = ++commentNum;
          // indent only if there's a preceding comment visible in this same round
          html += `<div class="thread-comment${evi > 0 ? ' thread-reply' : ''}">${numLink(c.url, n)} <strong>@${escapeHtml(c.author)}</strong>: ${truncatableHtml(snip, 200)} ${cAgo}</div>`;
        }
        html += `</div>`;
      } else if (item.type === 'review') {
        const isDismissed = item.state === 'DISMISSED';
        if (isDismissed && !showClosed) continue;
        // Skip empty COMMENTED submissions — threads are already shown separately
        if (item.state === 'COMMENTED' && !item.body.trim()) continue;
        const nameHtml = item.url
          ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">@${escapeHtml(item.login)}</a>`
          : `@${escapeHtml(item.login)}`;
        const rAgo = item.ts ? `<span class="time-ago">${timeAgo(item.ts)}</span>` : '';
        const rn = item.body.trim() ? ++commentNum : 0;
        html += `<div class="review-batch${isDismissed ? ' review-batch-dismissed' : ''}">`;
        html += `<div class="review-batch-header">${nameHtml} &nbsp;${escapeHtml(item.label)} ${rAgo}</div>`;
        if (item.body.trim()) html += `<div class="review-batch-body">${rn ? numLink(item.url, rn) + ' ' : ''}${truncatableHtml(item.body.trim(), 300)}</div>`;
        html += `</div>`;
      } else if (item.type === 'pr-comment') {
        const c = item.comment;
        const snip = c.body.replace(/\s+/g, ' ').trim();
        const cAgo = c.createdAt ? `<span class="time-ago">${timeAgo(c.createdAt)}</span>` : '';
        const pn = ++commentNum;
        html += `<div class="pr-comment-item"><div class="thread-comment">${numLink(c.url, pn)} <strong>@${escapeHtml(c.author)}</strong>: ${truncatableHtml(snip, 200)} ${cAgo}</div></div>`;
      }
    }

    html += `</div></div>`;
  }

  let resolvedCount = 0;
  for (const r of reviewers) resolvedCount += r.threads.filter(t => t.isResolved).length;
  resolvedCount += orphanThreads.filter(t => t.isResolved).length;
  if (!showClosed && resolvedCount > 0) {
    html += `<p class="muted" style="font-size:.78rem">${resolvedCount} resolved thread${resolvedCount > 1 ? 's' : ''} hidden.</p>`;
  }

  if (!html) html = '<p class="muted" style="font-size:.85rem">No reviews yet.</p>';
  reviewDialogContent.innerHTML = html;
}

function showReviewDialog(pr) {
  currentReviewPr = pr;
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
    const orderedCells = currentColOrder.map(idx => COL_RENDERERS[idx](pr)).join('');
    tr.innerHTML = `
      <td class="td-dot">${isNew ? '<span class="dot new" title="new activity"></span>' : ''}</td>
      ${orderedCells}
      <td class="td-title">
        <div><a href="${escapeHtml(pr.url)}" target="_blank" rel="noopener" class="pr-title-link">${escapeHtml(pr.title)}</a></div>
        <div class="repo"><a href="${escapeHtml(pr.url)}" target="_blank" rel="noopener" class="pr-number-link">#${pr.number}</a> ${escapeHtml(pr.repo)}${pr.branch ? ` <span class="branch">${escapeHtml(pr.branch)}</span>` : ''}</div>
        ${(() => { const id = extractJiraId(pr.title); const labels = ghLabelHtml(pr.ghLabels); const jira = id ? `<a class="jira-link" href="https://compass-tech.atlassian.net/browse/${escapeHtml(id)}" target="_blank" rel="noopener">${JIRA_ICON}${escapeHtml(id)}</a>` : ''; return (jira || labels) ? `<div class="pr-meta-row">${jira}${labels}</div>` : ''; })()}
        ${isNew ? recentEventsHtml(pr, seen[pr.key], currentUser) : ''}
      </td>`;
    const eventsDiv = tr.querySelector('.recent-events');
    if (eventsDiv && eventsDiv.scrollHeight > eventsDiv.clientHeight + 1) {
      const wrap = eventsDiv.parentElement;
      const btn = document.createElement('button');
      btn.className = 'recent-events-expand';
      btn.textContent = '▼ more';
      btn.addEventListener('click', e => {
        e.stopPropagation();
        eventsDiv.classList.add('expanded');
        btn.remove();
      });
      wrap.appendChild(btn);
    }
    const markRead = () => {
      const s = loadSeen();
      s[pr.key] = { ts: pr.updatedAt, commits: pr.commitCount };
      saveSeen(s);
      tr.querySelector('.dot')?.remove();
      tr.querySelector('.recent-events-wrap')?.remove();
    };
    tr.querySelector('.pr-number-link').addEventListener('click', markRead);
    tr.querySelector('.pr-title-link').addEventListener('click', markRead);
    tr.addEventListener('dblclick', () => {
      const s = loadSeen();
      s[pr.key] = { ts: pr.updatedAt, commits: pr.commitCount };
      saveSeen(s);
      tr.querySelector('.dot')?.remove();
      tr.querySelector('.recent-events-wrap')?.remove();
    });
    tr.querySelector('.status-label').addEventListener('click', (e) => { e.stopPropagation(); showReviewDialog(pr); });
    tr.querySelector('.owners-tag')?.addEventListener('click', (e) => { e.stopPropagation(); showOwnersDialog(pr); });
    els.rows.appendChild(tr);
  }
  updateFilterIndicators();
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
      seen[pr.key] = { ts: pr.updatedAt, commits: pr.commitCount };
      changed = true;
    }
  }
  if (changed) saveSeen(seen);
}

const loadingBar = document.getElementById('loading-bar');

async function load() {
  els.error.style.display = 'none';
  loadingBar.classList.add('active');
  if (!allPrs.length) {
    els.rows.innerHTML = '<tr><td colspan="10" class="muted">Loading…</td></tr>';
  }
  try {
    const statesParam = activeStateFilter();
    const states = statesParam.length ? statesParam.join(',') : 'open';
    const meOnly = getMeOnly();
    lastLoadedMeOnly = meOnly;
    const res = await fetch(`/api/prs?states=${states}&days=${currentDays}&meOnly=${meOnly}`);
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
  } finally {
    loadingBar.classList.remove('active');
  }
}

els.refresh.addEventListener('click', load);
els.markRead.addEventListener('click', () => {
  const seen = loadSeen();
  for (const pr of visiblePrs()) seen[pr.key] = { ts: pr.updatedAt, commits: pr.commitCount };
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
  notifyToggle.checked = isNotifyOn();
}

function sendTestNotification() {
  const n = new Notification('🔔 PR Dashboard notifications enabled', { body: 'You will receive PR update alerts' });
  setTimeout(() => n.close(), 4000);
}

async function enableNotifications() {
  if (typeof Notification === 'undefined') { applyNotifyUI(); return; }
  if (Notification.permission === 'denied') {
    alert('Notification permission denied. Click the lock icon in the address bar → Notifications → Allow, then refresh.');
    applyNotifyUI();
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

notifyToggle.addEventListener('change', () => {
  if (notifyToggle.checked) {
    enableNotifications();
  } else {
    localStorage.setItem(NOTIFY_KEY, 'off');
    applyNotifyUI();
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
