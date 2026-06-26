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
  const ts = typeof lastSeen === 'string' ? lastSeen : lastSeen.ts;
  return new Date(updatedAt).getTime() > new Date(ts).getTime();
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
    for (const t of r.threads ?? []) {
      for (const c of t.comments ?? []) {
        if (c.createdAt) events.push({ author: c.author, ts: c.createdAt });
      }
    }
  }
  for (const t of pr.reviewDetail?.orphanThreads ?? []) {
    for (const c of t.comments ?? []) {
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
function stateQualifiers(states, days, now) {
  const hasOpen = states.includes('open') || states.includes('draft');
  const hasClosed = states.includes('closed');
  const hasMerged = states.includes('merged');
  if (!hasClosed && !hasMerged) return ['is:open'];
  const q = [`updated:>=${daysAgoISO(days, now)}`];
  if (!hasOpen) {
    if (hasClosed && hasMerged) q.push('is:closed');
    else if (hasClosed) q.push('is:closed', 'is:unmerged');
    else if (hasMerged) q.push('is:merged');
  }
  return q;
}

export function buildSearchQuery({ user, org, scope, states, days = 7, qualifier, now = new Date() }) {
  const resolved = states ?? (scope === 'open' ? ['open'] : ['open', 'closed', 'merged']);
  const parts = ['is:pr', `${qualifier}:${user}`, `org:${org}`, ...stateQualifiers(resolved, days, now)];
  return parts.join(' ');
}

const LEAD_TEAMS = new Set(['authz-leads', 'iam-leads']);

// Compute the merged 9-state PR status from review + CI signals.
export function mapPRStatus(n, { ci, reviewDetail, ownersPending, committedDate }) {
  const authorLogin = n.author?.login;
  // Exclude the PR author's own reviews — authors sometimes leave review comments on
  // their own PR, which would otherwise inflate latestReviewerDate and trigger "author turn".
  const reviewers = reviewDetail.reviewers.filter(r => r.login !== authorLogin);

  if (ci === 'fail') return 'ci_failed';

  const ownersOk = !ownersPending || ownersPending.status !== 'fail';
  if (n.reviewDecision === 'APPROVED' && ownersOk) return 'approved';

  // Compute isLeadOnly early so it can take priority over part_approved.
  const pending = ownersPending?.pending ?? [];
  const isLeadOnly = pending.length > 0 && pending.every(t => {
    let name = t.name;
    const slash = name.indexOf('/');
    if (slash !== -1) name = name.slice(slash + 1);
    return LEAD_TEAMS.has(name);
  });

  // When only lead teams are blocking OWNERS, surface that over "part approved"
  // so leads know they are the remaining blocker.
  if (n.reviewDecision === 'APPROVED' && isLeadOnly) return 'lead_re_review';

  // Compute reviewer and author timestamps for the "author turn" decision
  let latestReviewerDate = new Date(0);
  const allThreads = [
    ...reviewers.flatMap(r => r.threads ?? []),
    ...(reviewDetail.orphanThreads ?? []),
  ];
  for (const r of reviewers) {
    if (r.submittedAt) {
      const t = new Date(r.submittedAt);
      if (t > latestReviewerDate) latestReviewerDate = t;
    }
  }
  for (const thread of allThreads) {
    for (const c of thread.comments ?? []) {
      if (c.author !== authorLogin && c.createdAt) {
        const t = new Date(c.createdAt);
        if (t > latestReviewerDate) latestReviewerDate = t;
      }
    }
  }

  let latestAuthorCommentDate = new Date(0);
  for (const c of (n.comments?.nodes ?? [])) {
    if (c.author?.login === authorLogin && c.createdAt) {
      const t = new Date(c.createdAt);
      if (t > latestAuthorCommentDate) latestAuthorCommentDate = t;
    }
  }
  for (const thread of allThreads) {
    for (const c of thread.comments ?? []) {
      if (c.author === authorLogin && c.createdAt) {
        const t = new Date(c.createdAt);
        if (t > latestAuthorCommentDate) latestAuthorCommentDate = t;
      }
    }
  }
  const latestCommitDate = committedDate ? new Date(committedDate) : new Date(0);
  const authorRespondedAt = latestCommitDate > latestAuthorCommentDate ? latestCommitDate : latestAuthorCommentDate;

  const hasChangesRequested = reviewers.some(r => r.state === 'CHANGES_REQUESTED');
  const hasUnresolved = allThreads.some(t => !t.isResolved);

  if ((hasChangesRequested || hasUnresolved) && authorRespondedAt <= latestReviewerDate) return 'author_turn';

  if (n.reviewDecision === 'APPROVED' && ownersPending?.status === 'fail') return 'part_approved';

  // Reviewer's turn
  const hasActiveReview = reviewers.length > 0;

  if (isLeadOnly) return 'lead_re_review';
  if (hasActiveReview) return 'wait_re_review';
  if (ci === 'pending') return 'ci_pending';
  if (ci === 'unknown') return 'ci_unknown';
  return 'none';
}

const PR_FIELDS = `
  ... on PullRequest {
    id number title url createdAt updatedAt isDraft state reviewDecision headRefName
    author { login }
    repository { nameWithOwner }
    labels(first: 20) { nodes { name color } }
    comments(last: 10) { totalCount nodes { author { login } bodyText createdAt url } }
    reviews(last: 20) { totalCount nodes { id author { login } state body submittedAt url } }
    reviewThreads(first: 100) { nodes { isResolved path line comments(first: 10) { nodes { author { login } body url createdAt pullRequestReview { id } } } } }
    commits(last: 1) { totalCount nodes { commit { committedDate statusCheckRollup {
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

export function buildGraphQLQuery({ user, org, scope, states, meOnly = false, days = 7, now = new Date() }) {
  const search = (qualifier, fields) =>
    `search(query: ${JSON.stringify(buildSearchQuery({ user, org, scope, states, days, qualifier, now }))}, type: ISSUE, first: 50) { nodes { ${fields} } }`;
  const mainQualifier = meOnly ? 'author' : 'involves';
  return `query {
    main: ${search(mainQualifier, PR_FIELDS)}
    byAuthor: ${search('author', KEY_FIELDS)}
    byAssignee: ${search('assignee', KEY_FIELDS)}
    byMention: ${search('mentions', KEY_FIELDS)}
    byReviewer: ${search('reviewed-by', KEY_FIELDS)}
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
    .map(r => ({ id: r.id ?? '', login: r.author?.login ?? 'unknown', state: r.state, label: REVIEW_STATE[r.state] ?? r.state, body: r.body ?? '', url: r.url ?? '', submittedAt: r.submittedAt ?? null, threads: [] }));
  const reviewMap = new Map(reviewers.map(r => [r.id, r]));
  const orphanThreads = [];
  for (const t of node.reviewThreads?.nodes ?? []) {
    const comments = (t.comments?.nodes ?? [])
      .filter(c => !isBot(c.author?.login))
      .map(c => ({ author: c.author?.login ?? 'unknown', body: c.body ?? '', url: c.url ?? '', createdAt: c.createdAt }));
    if (!comments.length) continue;
    const thread = { isResolved: t.isResolved, path: t.path ?? '', line: t.line ?? null, comments };
    const reviewId = t.comments?.nodes?.find(c => c.pullRequestReview?.id)?.pullRequestReview?.id;
    let parent = reviewId ? reviewMap.get(reviewId) : null;
    if (!parent && comments.length > 0) {
      const firstAuthor = comments[0].author;
      const firstTime = comments[0].createdAt ? new Date(comments[0].createdAt).getTime() : null;
      const byAuthor = reviewers.filter(r => r.login === firstAuthor);
      if (byAuthor.length === 1) {
        parent = byAuthor[0];
      } else if (byAuthor.length > 1 && firstTime) {
        parent = byAuthor.reduce((best, r) => {
          const rDiff = Math.abs((r.submittedAt ? new Date(r.submittedAt).getTime() : 0) - firstTime);
          const bDiff = Math.abs((best.submittedAt ? new Date(best.submittedAt).getTime() : 0) - firstTime);
          return rDiff < bDiff ? r : best;
        });
      }
    }
    if (parent) parent.threads.push(thread);
    else orphanThreads.push(thread);
  }
  const comments = (node.comments?.nodes ?? [])
    .filter(c => !isBot(c.author?.login))
    .map(c => ({ author: c.author?.login ?? 'unknown', body: c.bodyText ?? '', createdAt: c.createdAt, url: c.url ?? '' }));
  return { reviewers, comments, orphanThreads };
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
    // reviewer/mention on your own PR is noise — author role takes precedence
    const filtered = labels.includes('author') ? labels.filter(l => l !== 'reviewer' && l !== 'mention') : labels;
    return { ...pr, labels: filtered };
  });
}

export function parseGraphQLResponse(json) {
  const data = json.data || {};
  const nodes = (alias) => (data[alias]?.nodes || []).filter(n => n && n.number);

  const prs = nodes('main').filter(n => n.repository).map(n => {
    const commit = n.commits?.nodes?.[0]?.commit;
    const ci = mapCIStatus(commit?.statusCheckRollup);
    const reviewDetail = reviewDetailsOf(n);
    const ownersPending = parseOwnersPending(commit?.statusCheckRollup, n.url);
    const committedDate = commit?.committedDate ?? null;
    return {
      key: prKey(n),
      id: n.id,
      number: n.number,
      title: n.title,
      url: n.url,
      repo: n.repository.nameWithOwner,
      branch: n.headRefName ?? null,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      author: n.author?.login ?? 'unknown',
      isDraft: n.isDraft,
      state: n.state,
      review: mapReviewStatus(n),
      reviewDetail,
      ci,
      ownersPending,
      status: mapPRStatus(n, { ci, reviewDetail, ownersPending, committedDate }),
      latestComment: latestCommentOf(n),
      unresolved: unresolvedThreadCount(n),
      ghLabels: (n.labels?.nodes ?? []).map(l => ({ name: l.name ?? '', color: l.color ?? '' })),
      commitCount: n.commits?.totalCount ?? 0,
    };
  });

  const setOf = (alias) => new Set(nodes(alias).map(prKey));
  const labelSets = {
    author: setOf('byAuthor'),
    assignee: setOf('byAssignee'),
    mention: setOf('byMention'),
    reviewer: setOf('byReviewer'),
  };
  return mergeLabels(prs, labelSets);
}
