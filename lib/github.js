import { buildGraphQLQuery, parseGraphQLResponse } from '../public/shared.js';

export async function fetchDashboard({
  token, scope, states, meOnly = false, days = 7, user, org, now = new Date(), fetchImpl = fetch,
}) {
  const query = buildGraphQLQuery({ user, org, scope, states, meOnly, days, now });
  const res = await fetchImpl('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'pr-dashboard',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error(`GitHub API returned HTTP ${res.status}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error('GraphQL error: ' + json.errors.map(e => e.message).join('; '));
  }
  return parseGraphQLResponse(json);
}
