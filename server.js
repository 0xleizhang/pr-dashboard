#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize, relative, isAbsolute } from 'node:path';
import { resolveToken } from './lib/token.js';
import { fetchDashboard } from './lib/github.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');

const CONFIG = {
  user: process.env.GH_USER || '0xleizhang',
  org: process.env.GH_ORG || 'UrbanCompass',
  port: Number(process.env.PORT) || 4317,
  closedDays: Number(process.env.CLOSED_DAYS) || 7,
};

// SSE clients and poll state
const sseClients = new Set();
let lastPollPrs = null; // Map<key, latestComment.createdAt> from previous poll

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
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const prs = await fetchDashboard({
      token, scope, days: CONFIG.closedDays,
      user: CONFIG.user, org: CONFIG.org,
    });
    res.writeHead(200).end(JSON.stringify({ prs, scope, user: CONFIG.user, org: CONFIG.org }));
  } catch (err) {
    res.writeHead(200).end(JSON.stringify({ error: err.message }));
  }
}

function serveSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(':\n\n'); // initial heartbeat
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
}

function pushSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

async function pollForNewComments() {
  try {
    const prs = await fetchDashboard({
      token, scope: 'all', days: CONFIG.closedDays,
      user: CONFIG.user, org: CONFIG.org,
    });
    const currentMap = new Map(prs.map(pr => [pr.key, pr.latestComment?.createdAt ?? null]));
    if (lastPollPrs !== null) {
      for (const [key, createdAt] of currentMap) {
        const prev = lastPollPrs.get(key);
        if (createdAt && (!prev || createdAt > prev)) {
          const pr = prs.find(p => p.key === key);
          const snip = (pr.latestComment?.body ?? '').replace(/\s+/g, ' ').slice(0, 100);
          pushSSE('new-comment', {
            prTitle: pr.title,
            commentAuthor: pr.latestComment?.author ?? 'unknown',
            commentSnip: snip,
            prUrl: pr.url,
          });
        }
      }
    }
    lastPollPrs = currentMap;
  } catch (err) {
    console.error('[poll] error:', err.message);
  }
}

const server = createServer((req, res) => {
  if (req.url.startsWith('/api/events')) return serveSSE(req, res);
  if (req.url.startsWith('/api/prs')) return serveApi(req, res);
  return serveStatic(req, res);
});

server.listen(CONFIG.port, () => {
  const addr = `http://localhost:${CONFIG.port}`;
  console.log(`pr-dashboard for ${CONFIG.user} @ ${CONFIG.org} → ${addr}`);
  pollForNewComments(); // seed baseline immediately
  setInterval(pollForNewComments, 5 * 60 * 1000);
});
