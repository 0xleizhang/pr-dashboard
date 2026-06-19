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
  const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'open';
  const daysParam = Number(url.searchParams.get('days'));
  const days = [7, 14, 30, 90].includes(daysParam) ? daysParam : CONFIG.closedDays;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const prs = await fetchDashboard({
      token, scope, days,
      user: CONFIG.user, org: CONFIG.org,
    });
    res.writeHead(200).end(JSON.stringify({ prs, scope, user: CONFIG.user, org: CONFIG.org }));
  } catch (err) {
    res.writeHead(200).end(JSON.stringify({ error: err.message }));
  }
}

const server = createServer((req, res) => {
  if (req.url.startsWith('/api/prs')) return serveApi(req, res);
  return serveStatic(req, res);
});

server.listen(CONFIG.port, () => {
  const addr = `http://localhost:${CONFIG.port}`;
  console.log(`pr-dashboard for ${CONFIG.user} @ ${CONFIG.org} → ${addr}`);
  exec(`open ${addr}`); // macOS: open in default browser
});
