import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapReviewStatus, mapCIStatus, isNewActivity, daysAgoISO, buildSearchQuery, buildGraphQLQuery, parseGraphQLResponse, mergeLabels } from '../public/shared.js';

test('mapReviewStatus: approved', () => {
  assert.equal(mapReviewStatus({ reviewDecision: 'APPROVED' }), 'approved');
});
test('mapReviewStatus: changes requested', () => {
  assert.equal(mapReviewStatus({ reviewDecision: 'CHANGES_REQUESTED' }), 'changes_requested');
});
test('mapReviewStatus: commented when human reviews or comments exist', () => {
  assert.equal(mapReviewStatus({ reviewDecision: null, reviews: { nodes: [{ author: { login: 'alice' }, state: 'COMMENTED' }] }, comments: { nodes: [] } }), 'commented');
  assert.equal(mapReviewStatus({ reviewDecision: null, reviews: { nodes: [] }, comments: { nodes: [{ author: { login: 'bob' } }] } }), 'commented');
});
test('mapReviewStatus: none when only bot activity', () => {
  assert.equal(mapReviewStatus({ reviewDecision: null, reviews: { nodes: [{ author: { login: 'dependabot[bot]' }, state: 'COMMENTED' }] }, comments: { nodes: [{ author: { login: 'github-actions[bot]' } }] } }), 'none');
  assert.equal(mapReviewStatus({}), 'none');
});
test('mapReviewStatus: none when no review activity', () => {
  assert.equal(mapReviewStatus({ reviewDecision: null, reviews: { nodes: [] }, comments: { nodes: [] } }), 'none');
});

const rollup = (...nodes) => ({ contexts: { nodes } });
const checkRun = (name, status, conclusion) => ({ __typename: 'CheckRun', name, status, conclusion });
const statusCtx = (context, state) => ({ __typename: 'StatusContext', context, state });

test('mapCIStatus: unknown when no checks', () => {
  assert.equal(mapCIStatus(null), 'unknown');
  assert.equal(mapCIStatus(undefined), 'unknown');
  assert.equal(mapCIStatus(rollup()), 'unknown');
});

test('mapCIStatus: passing CheckRun and StatusContext', () => {
  assert.equal(mapCIStatus(rollup(checkRun('ci', 'COMPLETED', 'SUCCESS'))), 'pass');
  assert.equal(mapCIStatus(rollup(checkRun('ci', 'COMPLETED', 'NEUTRAL'))), 'pass');
  assert.equal(mapCIStatus(rollup(checkRun('ci', 'COMPLETED', 'SKIPPED'))), 'pass');
  assert.equal(mapCIStatus(rollup(statusCtx('ci/circleci', 'SUCCESS'))), 'pass');
});

test('mapCIStatus: fail beats pending beats pass when aggregating', () => {
  assert.equal(mapCIStatus(rollup(
    checkRun('ci', 'COMPLETED', 'SUCCESS'),
    checkRun('lint', 'COMPLETED', 'FAILURE'),
  )), 'fail');
  assert.equal(mapCIStatus(rollup(
    checkRun('ci', 'COMPLETED', 'SUCCESS'),
    checkRun('lint', 'IN_PROGRESS', null),
  )), 'pending');
});

test('mapCIStatus: in-progress CheckRun is pending; error StatusContext is fail', () => {
  assert.equal(mapCIStatus(rollup(checkRun('ci', 'QUEUED', null))), 'pending');
  assert.equal(mapCIStatus(rollup(statusCtx('ci', 'ERROR'))), 'fail');
  assert.equal(mapCIStatus(rollup(statusCtx('ci', 'PENDING'))), 'pending');
});

test('mapCIStatus: excludes owners-files (approval-gated) checks', () => {
  // owners-files is failing/pending but real CI passed → result should be pass
  assert.equal(mapCIStatus(rollup(
    checkRun('ci', 'COMPLETED', 'SUCCESS'),
    checkRun('owners-files', 'COMPLETED', 'FAILURE'),
  )), 'pass');
  // only an owners check present → no real checks left → unknown
  assert.equal(mapCIStatus(rollup(checkRun('owners-files', 'COMPLETED', 'FAILURE'))), 'unknown');
});

test('isNewActivity: true when never seen', () => {
  assert.equal(isNewActivity(undefined, '2026-06-12T00:00:00Z'), true);
  assert.equal(isNewActivity(null, '2026-06-12T00:00:00Z'), true);
});
test('isNewActivity: true when updated after last seen', () => {
  assert.equal(isNewActivity('2026-06-11T00:00:00Z', '2026-06-12T00:00:00Z'), true);
});
test('isNewActivity: false when not updated since last seen', () => {
  assert.equal(isNewActivity('2026-06-12T00:00:00Z', '2026-06-12T00:00:00Z'), false);
  assert.equal(isNewActivity('2026-06-13T00:00:00Z', '2026-06-12T00:00:00Z'), false);
});

const NOW = new Date('2026-06-12T00:00:00Z');

test('daysAgoISO returns YYYY-MM-DD N days before now', () => {
  assert.equal(daysAgoISO(7, NOW), '2026-06-05');
});

test('buildSearchQuery open scope', () => {
  assert.equal(
    buildSearchQuery({ user: 'me', org: 'ACME', scope: 'open', qualifier: 'involves', now: NOW }),
    'is:pr involves:me org:ACME is:open'
  );
});

test('buildSearchQuery all scope adds updated lookback', () => {
  assert.equal(
    buildSearchQuery({ user: 'me', org: 'ACME', scope: 'all', days: 7, qualifier: 'author', now: NOW }),
    'is:pr author:me org:ACME updated:>=2026-06-05'
  );
});

test('buildGraphQLQuery includes all 5 aliased searches and PR fields', () => {
  const q = buildGraphQLQuery({ user: 'me', org: 'ACME', scope: 'open', now: NOW });
  for (const alias of ['main:', 'byAuthor:', 'byAssignee:', 'byMention:', 'byCommenter:']) {
    assert.ok(q.includes(alias), `missing alias ${alias}`);
  }
  assert.ok(q.includes('involves:me'), 'main uses involves');
  assert.ok(q.includes('mentions:me'), 'mention alias uses mentions qualifier');
  assert.ok(q.includes('reviewDecision'), 'requests reviewDecision');
  assert.ok(q.includes('statusCheckRollup'), 'requests CI rollup');
  assert.ok(q.includes('first: 50'), 'paginates at 50');
});

test('parseGraphQLResponse normalizes PRs and merges participation labels', () => {
  const json = {
    data: {
      main: { nodes: [
        { number: 1, title: 'Fix bug', url: 'http://x/1', createdAt: '2026-06-10T00:00:00Z', updatedAt: '2026-06-12T00:00:00Z',
          isDraft: false, state: 'OPEN', reviewDecision: 'APPROVED',
          repository: { nameWithOwner: 'ACME/web' },
          comments: { totalCount: 3, nodes: [{ author: { login: 'reviewer1' }, bodyText: 'please fix', createdAt: '2026-06-12T09:00:00Z' }] },
          reviews: { totalCount: 1, nodes: [{ author: { login: 'reviewer1' }, state: 'APPROVED', body: '' }] },
          reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }, { isResolved: false }] },
          commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [
            { __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' },
            { __typename: 'CheckRun', name: 'owners-files', status: 'COMPLETED', conclusion: 'FAILURE' },
          ] } } } }] } },
        { number: 2, title: 'Add feature', url: 'http://x/2', updatedAt: '2026-06-11T00:00:00Z',
          isDraft: true, state: 'OPEN', reviewDecision: null,
          repository: { nameWithOwner: 'ACME/api' },
          comments: { totalCount: 0, nodes: [] }, reviews: { totalCount: 0, nodes: [] },
          commits: { nodes: [] } },
      ]},
      byAuthor:    { nodes: [{ number: 1, repository: { nameWithOwner: 'ACME/web' } }] },
      byAssignee:  { nodes: [{ number: 2, repository: { nameWithOwner: 'ACME/api' } }] },
      byMention:   { nodes: [{ number: 1, repository: { nameWithOwner: 'ACME/web' } }] },
      byCommenter: { nodes: [] },
    },
  };
  const prs = parseGraphQLResponse(json);
  assert.equal(prs.length, 2);

  const pr1 = prs.find(p => p.number === 1);
  assert.equal(pr1.key, 'ACME/web#1');
  assert.equal(pr1.repo, 'ACME/web');
  assert.equal(pr1.review, 'approved');
  assert.equal(pr1.ci, 'pass');
  assert.deepEqual(pr1.labels.sort(), ['author', 'mention']);
  assert.deepEqual(pr1.latestComment, { author: 'reviewer1', body: 'please fix', createdAt: '2026-06-12T09:00:00Z' });
  assert.equal(pr1.unresolved, 2);
  assert.equal(pr1.createdAt, '2026-06-10T00:00:00Z');

  const pr2 = prs.find(p => p.number === 2);
  assert.equal(pr2.ci, 'unknown');
  assert.equal(pr2.review, 'none');
  assert.deepEqual(pr2.labels, ['assignee']);
  assert.equal(pr2.latestComment, null);
  assert.equal(pr2.unresolved, 0);
});

test('parseGraphQLResponse tolerates null nodes', () => {
  const json = { data: { main: { nodes: [null] }, byAuthor: { nodes: [] },
    byAssignee: { nodes: [] }, byMention: { nodes: [] }, byCommenter: { nodes: [] } } };
  assert.deepEqual(parseGraphQLResponse(json), []);
});

test('parseGraphQLResponse drops main node with repository: null and does not throw', () => {
  const json = {
    data: {
      main: { nodes: [
        { number: 1, title: 'Valid', url: 'http://x/1', updatedAt: '2026-06-12T00:00:00Z',
          isDraft: false, state: 'OPEN', reviewDecision: null,
          repository: { nameWithOwner: 'ACME/web' },
          comments: { totalCount: 0, nodes: [] }, reviews: { totalCount: 0, nodes: [] },
          commits: { nodes: [] } },
        { number: 9, repository: null },
      ]},
      byAuthor: { nodes: [] }, byAssignee: { nodes: [] },
      byMention: { nodes: [] }, byCommenter: { nodes: [] },
    },
  };
  const prs = parseGraphQLResponse(json);
  assert.equal(prs.length, 1);
  assert.equal(prs[0].number, 1);
});

test('parseGraphQLResponse includes author login', () => {
  const json = {
    data: {
      main: { nodes: [{
        number: 42, title: 'My PR', url: 'http://x/42',
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z',
        isDraft: false, state: 'OPEN', reviewDecision: null,
        author: { login: 'alice' },
        repository: { nameWithOwner: 'ACME/web' },
        comments: { totalCount: 0, nodes: [] },
        reviews: { totalCount: 0, nodes: [] },
        reviewThreads: { nodes: [] },
        commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
      }]},
      byAuthor: { nodes: [] }, byAssignee: { nodes: [] },
      byMention: { nodes: [] }, byCommenter: { nodes: [] },
    },
  };
  const prs = parseGraphQLResponse(json);
  assert.equal(prs[0].author, 'alice');
});

test('mergeLabels attaches correct label sets to each PR', () => {
  const prs = [{ key: 'a#1' }, { key: 'a#2' }];
  const labelSets = {
    author:    new Set(['a#1']),
    commenter: new Set(['a#1', 'a#2']),
  };
  const result = mergeLabels(prs, labelSets);
  assert.deepEqual(result.find(p => p.key === 'a#1').labels, ['author', 'commenter']);
  assert.deepEqual(result.find(p => p.key === 'a#2').labels, ['commenter']);
});
