import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchDashboard } from '../lib/github.js';

function mockFetch(responder) {
  return async (url, opts) => responder(url, opts);
}

const okBody = {
  data: {
    main: { nodes: [
      { number: 1, title: 'T', url: 'http://x/1', updatedAt: '2026-06-12T00:00:00Z',
        isDraft: false, state: 'OPEN', reviewDecision: 'APPROVED',
        repository: { nameWithOwner: 'ACME/web' },
        comments: { totalCount: 0 }, reviews: { totalCount: 1 },
        commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [
          { __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' },
        ] } } } }] } },
    ]},
    byAuthor: { nodes: [{ number: 1, repository: { nameWithOwner: 'ACME/web' } }] },
    byAssignee: { nodes: [] }, byMention: { nodes: [] }, byCommenter: { nodes: [] },
  },
};

test('fetchDashboard posts a GraphQL query with bearer token and returns parsed PRs', async () => {
  let captured;
  const fetchImpl = mockFetch(async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 200, json: async () => okBody };
  });
  const prs = await fetchDashboard({
    token: 'tok', scope: 'open', user: 'me', org: 'ACME',
    now: new Date('2026-06-12T00:00:00Z'), fetchImpl,
  });
  assert.equal(captured.url, 'https://api.github.com/graphql');
  assert.equal(captured.opts.method, 'POST');
  assert.equal(captured.opts.headers.Authorization, 'bearer tok');
  assert.ok(JSON.parse(captured.opts.body).query.includes('involves:me'));
  assert.equal(prs.length, 1);
  assert.deepEqual(prs[0].labels, ['author']);
});

test('fetchDashboard throws on non-ok HTTP', async () => {
  const fetchImpl = mockFetch(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  await assert.rejects(
    () => fetchDashboard({ token: 't', scope: 'open', user: 'm', org: 'O', fetchImpl }),
    /401/
  );
});

test('fetchDashboard throws on GraphQL errors', async () => {
  const fetchImpl = mockFetch(async () => ({ ok: true, status: 200,
    json: async () => ({ errors: [{ message: 'bad query' }] }) }));
  await assert.rejects(
    () => fetchDashboard({ token: 't', scope: 'open', user: 'm', org: 'O', fetchImpl }),
    /bad query/
  );
});
