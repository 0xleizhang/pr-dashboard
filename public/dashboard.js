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
  updated: (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
  created: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  number: (a, b) => b.number - a.number,
};

function visiblePrs() {
  const type = els.type.value;
  const filtered = type === 'all' ? allPrs : allPrs.filter(pr => pr.labels.includes(type));
  return [...filtered].sort(SORTERS[els.sort.value] || SORTERS.updated);
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
      <td>${pr.labels.map(l => `<span class="tag">${PARTICIPATION[l]}</span>`).join('')}</td>
      <td class="review-${pr.review}">${REVIEW[pr.review]}</td>
      <td class="ci-${pr.ci}">${CI[pr.ci]}</td>
      <td>
        <div>${escapeHtml(pr.title)}</div>
        <div class="repo">${pr.repo}#${pr.number}</div>
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
  els.rows.innerHTML = '<tr><td colspan="6" class="muted">Loading…</td></tr>';
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
els.sort.addEventListener('change', render);
els.markRead.addEventListener('click', () => {
  const seen = loadSeen();
  for (const pr of visiblePrs()) seen[pr.key] = pr.updatedAt;
  saveSeen(seen);
  render();
});

load();
