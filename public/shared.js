const BOT_LOGINS = new Set(['greptile-apps', 'urbancompass-automation', 'github-actions']);

function isBot(login) {
  const l = login ?? '';
  return l.endsWith('[bot]') || BOT_LOGINS.has(l);
}

export function mapReviewStatus(pr) {
  if (pr.reviewDecision === 'APPROVED') return 'approved';
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes_requested';
  const humanReviews = (pr.reviews?.nodes || []).filter(r => !isBot(r.author?.login));
  const humanComments = (pr.comments?.nodes || []).filter(c => !isBot(c.author?.login));
  if (humanReviews.length > 0 || humanComments.length > 0) return 'commented';
  return 'none';
}

// Checks whose name contains any of these are ignored when computing CI status:
// they depend on review approval (e.g. owners-files) and never pass on their own,
// so they would otherwise mask the real CI result.
const CI_EXCLUDE = ['owners'];

function checkName(node) {
  return (node.name ?? node.context ?? '').toLowerCase();
}

function normalizeCheck(node) {
  if (node.__typename === 'StatusContext') {
    switch (node.state) {
      case 'SUCCESS': return 'pass';
      case 'FAILURE':
      case 'ERROR': return 'fail';
      default: return 'pending';
    }
  }
  // CheckRun
  if (node.status !== 'COMPLETED') return 'pending';
  switch (node.conclusion) {
    case 'SUCCESS':
    case 'NEUTRAL':
    case 'SKIPPED': return 'pass';
    default: return 'fail';
  }
}

// Extract unique pending owner teams/users from the owners-files check summary.
// The check outputs markdown links like [UrbanCompass/team-name](https://github.com/orgs/UrbanCompass/teams/team-name/members)
function extractPendingOwners(text) {
  if (!text) return [];
  const seen = new Set();
  const pending = [];
  // Match markdown links pointing to GitHub teams: [Org/team](https://github.com/orgs/Org/teams/team/members)
  const teamRe = /\[([^\]]+)\]\((https:\/\/github\.com\/orgs\/[^/]+\/teams\/[^)]+\/members)\)/g;
  let m;
  while ((m = teamRe.exec(text)) !== null) {
    const key = m[2];
    if (!seen.has(key)) { seen.add(key); pending.push({ name: m[1], url: m[2] }); }
  }
  return pending;
}

// Return the owners-files check status, link, and list of pending approvers.
export function parseOwnersPending(rollup, prUrl) {
  const checks = (rollup?.contexts?.nodes || [])
    .filter(n => n && n.__typename === 'CheckRun' && CI_EXCLUDE.some(ex => checkName(n).includes(ex)));
  if (!checks.length) return null;
  const check = checks[checks.length - 1];
  const status = normalizeCheck(check);
  const checkUrl = check.databaseId ? `${prUrl}/checks?check_run_id=${check.databaseId}` : null;
  const rawText = [check.title, check.summary, check.text].filter(Boolean).join('\n');
  const pending = status === 'fail' ? extractPendingOwners(rawText) : [];
  return { checkUrl, status, pending };
}

// Aggregate the real CI checks (excluding approval-gated ones) into one status.
export function mapCIStatus(rollup) {
  const checks = (rollup?.contexts?.nodes || [])
    .filter(n => n && !CI_EXCLUDE.some(ex => checkName(n).includes(ex)));
  if (checks.length === 0) return 'unknown';
  const states = checks.map(normalizeCheck);
  if (states.includes('fail')) return 'fail';
  if (states.includes('pending')) return 'pending';
  if (states.includes('pass')) return 'pass';
  return 'unknown';
}

export function isNewActivity(lastSeen, updatedAt) {
  if (!lastSeen) return true;
  return new Date(updatedAt).getTime() > new Date(lastSeen).getTime();
}

// Returns { author, ts } of the most recent human activity (comment/review/thread),
// or null if none found. Used to determine if the logged-in user self-triggered an update.
export function latestActivityOf(pr) {
  const events = [];
  if (pr.latestComment?.createdAt) {
    events.push({ author: pr.latestComment.author, ts: pr.latestComment.createdAt });
  }
  for (const r of pr.reviewDetail?.reviewers ?? []) {
    if (r.submittedAt) events.push({ author: r.login, ts: r.submittedAt });
  }
  for (const tg of pr.reviewDetail?.threadGroups ?? []) {
    for (const c of tg.comments ?? []) {
      if (c.createdAt) events.push({ author: c.author, ts: c.createdAt });
    }
  }
  if (!events.length) return null;
  return events.reduce((best, e) => (e.ts > best.ts ? e : best));
}

export function daysAgoISO(days, now = new Date()) {
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * NOTE: `user` and `org` must be trusted, validated identifiers sourced from
 * server config — not raw HTTP input — because they are interpolated directly
 * into the search query string and could otherwise inject extra qualifiers.
 */
export function buildSearchQuery({ user, org, scope, days = 7, qualifier, now = new Date() }) {
  const parts = ['is:pr', `${qualifier}:${user}`, `org:${org}`];
  if (scope === 'open') parts.push('is:open');
  else parts.push(`updated:>=${daysAgoISO(days, now)}`);
  return parts.join(' ');
}

const PR_FIELDS = `
  ... on PullRequest {
    id number title url createdAt updatedAt isDraft state reviewDecision
    author { login }
    repository { nameWithOwner }
    comments(last: 10) { totalCount nodes { author { login } bodyText createdAt url } }
    reviews(last: 20) { totalCount nodes { author { login } state body submittedAt url } }
    reviewThreads(first: 100) { nodes { isResolved comments(first: 10) { nodes { author { login } body url createdAt } } } }
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

function prKey(node) {
  return `${node.repository.nameWithOwner}#${node.number}`;
}

function latestCommentOf(node) {
  const humanComments = (node.comments?.nodes ?? []).filter(c => !isBot(c.author?.login));
  const c = humanComments[humanComments.length - 1];
  if (!c) return null;
  return {
    author: c.author?.login ?? 'unknown',
    body: c.bodyText ?? '',
    createdAt: c.createdAt ?? null,
  };
}

function reviewDetailsOf(node) {
  const REVIEW_STATE = { APPROVED: '✅ Approved', CHANGES_REQUESTED: '❌ Changes Requested', COMMENTED: '💬 Commented', DISMISSED: '⚫ Dismissed' };
  const reviewers = (node.reviews?.nodes ?? [])
    .filter(r => !isBot(r.author?.login) && r.state !== 'PENDING')
    .map(r => ({ login: r.author?.login ?? 'unknown', state: r.state, label: REVIEW_STATE[r.state] ?? r.state, body: r.body ?? '', url: r.url ?? '', submittedAt: r.submittedAt ?? null }));
  const comments = (node.comments?.nodes ?? [])
    .filter(c => !isBot(c.author?.login))
    .map(c => ({ author: c.author?.login ?? 'unknown', body: c.bodyText ?? '', createdAt: c.createdAt, url: c.url ?? '' }));
  const threadGroups = (node.reviewThreads?.nodes ?? [])
    .map(t => ({
      isResolved: t.isResolved,
      comments: (t.comments?.nodes ?? [])
        .filter(c => !isBot(c.author?.login))
        .map(c => ({ author: c.author?.login ?? 'unknown', body: c.body ?? '', url: c.url ?? '', createdAt: c.createdAt })),
    }))
    .filter(t => t.comments.length > 0);
  return { reviewers, comments, threadGroups };
}

function unresolvedThreadCount(node) {
  return (node.reviewThreads?.nodes || []).filter(t => t && t.isResolved === false).length;
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

  const prs = nodes('main').filter(n => n.repository).map(n => ({
    key: prKey(n),
    id: n.id,
    number: n.number,
    title: n.title,
    url: n.url,
    repo: n.repository.nameWithOwner,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    author: n.author?.login ?? 'unknown',
    isDraft: n.isDraft,
    state: n.state,
    review: mapReviewStatus(n),
    reviewDetail: reviewDetailsOf(n),
    ci: mapCIStatus(n.commits?.nodes?.[0]?.commit?.statusCheckRollup),
    ownersPending: parseOwnersPending(n.commits?.nodes?.[0]?.commit?.statusCheckRollup, n.url),
    latestComment: latestCommentOf(n),
    unresolved: unresolvedThreadCount(n),
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
