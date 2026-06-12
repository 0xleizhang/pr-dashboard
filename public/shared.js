export function mapReviewStatus(pr) {
  if (pr.reviewDecision === 'APPROVED') return 'approved';
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes_requested';
  const reviews = pr.reviews?.totalCount ?? 0;
  const comments = pr.comments?.totalCount ?? 0;
  if (reviews > 0 || comments > 0) return 'commented';
  return 'none';
}

export function mapCIStatus(rollupState) {
  switch (rollupState) {
    case 'SUCCESS': return 'pass';
    case 'FAILURE':
    case 'ERROR': return 'fail';
    case 'PENDING':
    case 'EXPECTED': return 'pending';
    default: return 'unknown';
  }
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
    number title url updatedAt isDraft state reviewDecision
    repository { nameWithOwner }
    comments { totalCount }
    reviews { totalCount }
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
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
    number: n.number,
    title: n.title,
    url: n.url,
    repo: n.repository.nameWithOwner,
    updatedAt: n.updatedAt,
    isDraft: n.isDraft,
    state: n.state,
    review: mapReviewStatus(n),
    ci: mapCIStatus(n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state),
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
