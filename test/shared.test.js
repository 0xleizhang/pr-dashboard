import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapReviewStatus, mapCIStatus, isNewActivity, daysAgoISO, buildSearchQuery, buildGraphQLQuery } from '../public/shared.js';

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
