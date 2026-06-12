import { isNewActivity } from './shared.js';

const SEEN_KEY = 'pr-dashboard:seen';
const els = {
  rows: document.getElementById('rows'),
  error: document.getElementById('error'),
  empty: document.getElementById('empty'),
  scope: document.getElementById('scope'),
  type: document.getElementById('type'),
  refresh: document.getElementById('refresh'),
  markRead: document.getElementById('markRead'),
  subtitle: document.getElementById('subtitle'),
};

const PARTICIPATION = { author: '🖊 author', assignee: '👤 assignee', mention: '@ mention', commenter: '💬 commenter' };
const REVIEW = { approved: '✅ approved', changes_requested: '❌ changes', commented: '💬 commented', none: '⚪ none' };
const CI = { pass: '🟢 pass', fail: '🔴 fail', pending: '🟡 pending', unknown: '⚪ —' };

let allPrs = [];

function loadSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; }
  catch { return {}; }
}
function saveSeen(seen) {
  localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
}

function visiblePrs() {
  const type = els.type.value;
  if (type === 'all') return allPrs;
  return allPrs.filter(pr => pr.labels.includes(type));
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
    tr.innerHTML = `
      <td>${isNew ? '<span class="dot new" title="new activity"></span>' : ''}</td>
      <td>${pr.labels.map(l => `<span class="tag">${PARTICIPATION[l]}</span>`).join('')}</td>
      <td class="review-${pr.review}">${REVIEW[pr.review]}</td>
      <td class="ci-${pr.ci}">${CI[pr.ci]}</td>
      <td>
        <div>${pr.isDraft ? '<span class="tag">draft</span>' : ''}${escapeHtml(pr.title)}</div>
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
  els.rows.innerHTML = '<tr><td colspan="5" class="muted">Loading…</td></tr>';
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

load();
