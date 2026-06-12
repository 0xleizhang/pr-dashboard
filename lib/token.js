import { execFileSync } from 'node:child_process';

function defaultRunGh() {
  return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' });
}

export function resolveToken({ env = process.env, runGh = defaultRunGh } = {}) {
  const envTok = (env.GITHUB_TOKEN || '').trim();
  if (envTok) return envTok;
  try {
    const ghTok = (runGh() || '').trim();
    if (ghTok) return ghTok;
  } catch {
    // fall through to error below
  }
  throw new Error(
    'No GitHub token found. Set GITHUB_TOKEN, or run `gh auth login` so `gh auth token` works.'
  );
}
