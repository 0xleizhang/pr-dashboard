import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapReviewStatus, mapCIStatus, isNewActivity } from '../public/shared.js';

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
