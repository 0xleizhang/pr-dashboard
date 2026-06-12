import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveToken } from '../lib/token.js';

test('resolveToken: prefers GITHUB_TOKEN env', () => {
  const t = resolveToken({ env: { GITHUB_TOKEN: 'env-tok' }, runGh: () => 'gh-tok' });
  assert.equal(t, 'env-tok');
});
test('resolveToken: trims env token', () => {
  assert.equal(resolveToken({ env: { GITHUB_TOKEN: '  spaced  ' }, runGh: () => '' }), 'spaced');
});
test('resolveToken: falls back to gh CLI', () => {
  const t = resolveToken({ env: {}, runGh: () => 'gh-tok\n' });
  assert.equal(t, 'gh-tok');
});
test('resolveToken: throws helpful error when none available', () => {
  assert.throws(
    () => resolveToken({ env: {}, runGh: () => { throw new Error('gh not found'); } }),
    /No GitHub token/
  );
});
test('resolveToken: throws when gh returns empty', () => {
  assert.throws(() => resolveToken({ env: {}, runGh: () => '   ' }), /No GitHub token/);
});
