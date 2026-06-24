#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize, relative, isAbsolute } from 'node:path';
import { exec } from 'node:child_process';
import { resolveToken } from './lib/token.js';
import { fetchDashboard } from './lib/github.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');

const CONFIG = {
  user: process.env.GH_USER || '0xleizhang',
  org: process.env.GH_ORG || 'UrbanCompass',
  port: Number(process.env.PORT) || 4317,
  closedDays: Number(process.env.CLOSED_DAYS) || 14,
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

let token;
try {
  token = resolveToken();
} catch (err) {
  console.error('\n' + err.message + '\n');
  process.exit(1);
}

const CACHE_TTL_MS = 60 * 1000; // 1 minute
const cache = new Map(); // key -> { data, expiresAt }

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data;
}

function cacheSet(key, data) {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function serveStatic(req, res) {
  let urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  // prevent path traversal
  const filePath = normalize(join(PUBLIC_DIR, urlPath));
  const rel = relative(PUBLIC_DIR, filePath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

async function serveApi(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const VALID_STATES = new Set(['open', 'draft', 'closed', 'merged']);
  const statesParam = url.searchParams.get('states');
  const states = statesParam
    ? statesParam.split(',').filter(s => VALID_STATES.has(s))
    : null;
  const meOnly = url.searchParams.get('meOnly') === 'true';
  const daysParam = Number(url.searchParams.get('days'));
  const days = [7, 14, 30, 90].includes(daysParam) ? daysParam : CONFIG.closedDays;
  const cacheKey = `${states?.join(',') ?? ''}|${meOnly}|${days}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log(`[cache] hit  ${cacheKey}`);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(cached);
    return;
  }
  try {
    const prs = await fetchDashboard({
      token, states, meOnly, days,
      user: CONFIG.user, org: CONFIG.org,
    });
    const body = JSON.stringify({ prs, user: CONFIG.user, org: CONFIG.org });
    cacheSet(cacheKey, body);
    console.log(`[cache] miss ${cacheKey} (${prs.length} PRs)`);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(body);
  } catch (err) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: err.message }));
  }
}

const server = createServer((req, res) => {
  if (req.url.startsWith('/api/prs')) return serveApi(req, res);
  return serveStatic(req, res);
});

function startServer(port) {
  server.listen(port, () => {
    const addr = `http://localhost:${port}`;
    console.log(`pr-dashboard for ${CONFIG.user} @ ${CONFIG.org} → ${addr}`);
    exec(`open ${addr}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} in use, trying ${port + 1}...`);
      server.removeAllListeners('error');
      startServer(port + 1);
    } else {
      throw err;
    }
  });
}

startServer(CONFIG.port);
