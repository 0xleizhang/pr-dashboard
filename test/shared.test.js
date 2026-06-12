import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapReviewStatus, mapCIStatus, isNewActivity, daysAgoISO, buildSearchQuery, buildGraphQLQuery, parseGraphQLResponse } from '../public/shared.js';

test('mapReviewStatus: approved', () => {
  assert.equal(mapReviewStatus({ reviewDecision: 'APPROVED' }), 'approved');
});
test('mapReviewStatus: changes requested', () => {
  assert.equal(mapReviewStatus({ reviewDecision: 'CHANGES_REQUESTED' }), 'changes_requested');
});
test('mapReviewStatus: commented when reviews or comments exist', () => {
  assert.equal(mapReviewStatus({ reviewDecision: null, reviews: { totalCount: 2 }, comments: { totalCount: 0 } }), 'commented');
  assert.equal(mapReviewStatus({ reviewDecision: null, reviews: { totalCount: 0 }, comments: { totalCount: 3 } }), 'commented');
});
test('mapReviewStatus: none when no review activity', () => {
  assert.equal(mapReviewStatus({ reviewDecision: null, reviews: { totalCount: 0 }, comments: { totalCount: 0 } }), 'none');
  assert.equal(mapReviewStatus({}), 'none');
});

test('mapCIStatus mapping', () => {
  assert.equal(mapCIStatus('SUCCESS'), 'pass');
  assert.equal(mapCIStatus('FAILURE'), 'fail');
  assert.equal(mapCIStatus('ERROR'), 'fail');
  assert.equal(mapCIStatus('PENDING'), 'pending');
  assert.equal(mapCIStatus('EXPECTED'), 'pending');
  assert.equal(mapCIStatus(null), 'unknown');
  assert.equal(mapCIStatus(undefined), 'unknown');
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
        { number: 1, title: 'Fix bug', url: 'http://x/1', updatedAt: '2026-06-12T00:00:00Z',
          isDraft: false, state: 'OPEN', reviewDecision: 'APPROVED',
          repository: { nameWithOwner: 'ACME/web' },
          comments: { totalCount: 0 }, reviews: { totalCount: 1 },
          commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] } },
        { number: 2, title: 'Add feature', url: 'http://x/2', updatedAt: '2026-06-11T00:00:00Z',
          isDraft: true, state: 'OPEN', reviewDecision: null,
          repository: { nameWithOwner: 'ACME/api' },
          comments: { totalCount: 0 }, reviews: { totalCount: 0 },
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

  const pr2 = prs.find(p => p.number === 2);
  assert.equal(pr2.ci, 'unknown');
  assert.equal(pr2.review, 'none');
  assert.deepEqual(pr2.labels, ['assignee']);
});

test('parseGraphQLResponse tolerates null nodes', () => {
  const json = { data: { main: { nodes: [null] }, byAuthor: { nodes: [] },
    byAssignee: { nodes: [] }, byMention: { nodes: [] }, byCommenter: { nodes: [] } } };
  assert.deepEqual(parseGraphQLResponse(json), []);
});
