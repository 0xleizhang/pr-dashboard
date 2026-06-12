function isBot(login) {
  return (login ?? '').endsWith('[bot]');
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
    comments(last: 10) { totalCount nodes { author { login } bodyText createdAt } }
    reviews(last: 20) { totalCount nodes { author { login } state body submittedAt } }
    reviewThreads(first: 100) { nodes { isResolved } }
    commits(last: 1) { nodes { commit { statusCheckRollup {
      contexts(first: 100) {
        nodes {
          __typename
          ... on CheckRun { name status conclusion }
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
    .map(r => ({ login: r.author?.login ?? 'unknown', state: r.state, label: REVIEW_STATE[r.state] ?? r.state, body: r.body ?? '' }));
  const comments = (node.comments?.nodes ?? [])
    .filter(c => !isBot(c.author?.login))
    .map(c => ({ author: c.author?.login ?? 'unknown', body: c.bodyText ?? '', createdAt: c.createdAt }));
  return { reviewers, comments };
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
