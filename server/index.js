// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// HTTP API, static frontend and the Hocuspocus (Yjs) collaboration endpoint on one port.
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Hocuspocus } from '@hocuspocus/server';
import { ResetConnection } from '@hocuspocus/common';
import { Database } from '@hocuspocus/extension-database';
import { db } from './db.js';
import {
  SESSION_COOKIE, DUMMY_HASH, sessionToken, verifyPassword, createSession, deleteSession, userFromCookieHeader,
  isRateLimited, recordFailure, clearFailures,
} from './auth.js';
import { lookup } from './cite.js';
import { docsRouter, roleFor } from './docs.js';
import { adminRouter } from './admin.js';
import { commentsRouter } from './comments.js';
import { imagesRouter, imageUploadErrors } from './images.js';
import { isSuggestionOnly } from './suggestion-guard.js';

const PORT = Number(process.env.PORT || 5200);
const HOST = process.env.HOST || '127.0.0.1';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const DIST = path.resolve(import.meta.dirname, '..', 'dist');
// Public path below which the proxy serves the app, e.g. "/write" (empty at the root). The proxy removes the
// prefix, so routes stay the same; only redirects and the cookie path need it. Must match the build (vite.config.js).
const BASE = (process.env.BASE_PATH || '').replace(/^\/+|\/+$/g, '').replace(/^(?=.)/, '/');
const COOKIE_PATH = BASE || '/';
const to = (route) => (BASE && route === '/' ? `${BASE}/` : BASE + route);

// Close reason for a rejected change from a "suggest only" connection; the client reloads.
const SUGGESTION_ONLY = 'suggestion-only';
const SYNC_STEP_2 = 1;
const SYNC_UPDATE = 2;

// --- Collaboration --------------------------------------------------------

const hocuspocus = new Hocuspocus({
  timeout: 30_000,
  debounce: 2000,
  maxDebounce: 10_000,
  async onAuthenticate({ request, documentName }) {
    const user = userFromCookieHeader(request.headers.get('cookie'));
    const role = user && roleFor(user.id, documentName);
    if (!role) throw new Error('Unauthorized');
    return { user, role };
  },
  // "Suggest only" users: every incoming change must consist of suggestions only.
  async beforeSync({ context, type, payload, document }) {
    if (context.role !== 'suggester' || (type !== SYNC_STEP_2 && type !== SYNC_UPDATE)) return;
    if (!isSuggestionOnly(document, payload)) {
      throw Object.assign(new Error(SUGGESTION_ONLY), { code: 4409, reason: SUGGESTION_ONLY });
    }
  },
  extensions: [
    new Database({
      fetch: async ({ documentName }) => {
        const row = db.prepare('SELECT ydoc FROM documents WHERE id = ?').get(documentName);
        return row?.ydoc ? new Uint8Array(row.ydoc) : null;
      },
      store: async ({ documentName, state }) => {
        db.prepare('UPDATE documents SET ydoc = ?, updated_at = ? WHERE id = ?')
          .run(state, Date.now(), documentName);
      },
    }),
  ],
});

// --- HTTP API -------------------------------------------------------------

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
app.use(express.json({ limit: '100kb' }));

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; "
      + "font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  if (COOKIE_SECURE) res.set('Strict-Transport-Security', 'max-age=31536000');
  req.user = userFromCookieHeader(req.headers.cookie);
  next();
});

const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Nicht angemeldet' }));

// Blocks cross-site form posts (in addition to SameSite=Lax cookies).
const sameOrigin = (req, res, next) => {
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin && new URL(origin).host !== req.headers.host) {
    return res.status(403).json({ error: 'Fremde Herkunft' });
  }
  next();
};
app.use('/api', sameOrigin);

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Zu viele Fehlversuche. Bitte später erneut versuchen.' });
  const { username = '', password = '' } = req.body || {};
  const row = db.prepare('SELECT id, pw_hash FROM users WHERE username = ?').get(String(username).trim().toLowerCase());
  const valid = verifyPassword(String(password), row?.pw_hash || DUMMY_HASH);
  if (!row || !valid) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Benutzername oder Passwort falsch' });
  }
  clearFailures(ip);
  const { token, maxAge } = createSession(row.id);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: COOKIE_SECURE, maxAge: maxAge * 1000, path: COOKIE_PATH,
  });
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const token = sessionToken(req.headers.cookie);
  if (token) deleteSession(token);
  res.clearCookie(SESSION_COOKIE, { path: COOKIE_PATH });
  res.json({ ok: true });
});

app.get('/api/me', requireUser, (req, res) => res.json(req.user));

app.get('/api/users', requireUser, (req, res) => {
  res.json(db.prepare('SELECT id, username, name FROM users ORDER BY name').all());
});

/**
 * Closes open collaboration connections so they re-authenticate with current rights.
 * Without userId all connections of the document are closed; without docId those in every document.
 */
function closeConnectionsOf({ docId, userId }) {
  hocuspocus.documents.forEach((document) => {
    if (docId && document.name !== docId) return;
    document.connections.forEach((_clients, connection) => {
      if (!userId || connection.context?.user?.id === userId) connection.close(ResetConnection);
    });
  });
}

// Tells the owner's open editor that access requests changed; the client reloads the list.
function notifyRequestsChange({ docId }) {
  hocuspocus.documents.get(docId)?.broadcastStateless('access-requests', (conn) => conn.context?.role === 'owner');
}

// Tells every open editor of the document that comments changed; the client reloads them.
function notifyCommentsChange({ docId }) {
  hocuspocus.documents.get(docId)?.broadcastStateless('comments');
}

app.use('/api/docs/:id/comments', requireUser, commentsRouter({ onChange: notifyCommentsChange }));
app.use('/api/docs/:id/images', requireUser, imagesRouter(), imageUploadErrors);
app.use('/api/docs', requireUser, docsRouter({ onAccessChange: closeConnectionsOf, onRequestsChange: notifyRequestsChange }));
app.use('/api/admin', requireUser, adminRouter({ onUsersChanged: closeConnectionsOf }));

app.get('/api/cite', requireUser, async (req, res) => {
  try {
    res.json(await lookup(req.query.q));
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
});

// --- Pages ----------------------------------------------------------------

const page = (file) => (req, res) => res.sendFile(path.join(DIST, file));
app.get('/login', page('login.html'));
app.get('/', (req, res, next) => (req.user ? next() : res.redirect(to('/login'))), page('index.html'));
app.get('/d/:id', (req, res, next) => (req.user ? next() : res.redirect(to('/login'))), page('doc.html'));
app.get('/admin', (req, res, next) => (req.user?.isAdmin ? next() : res.redirect(to('/'))), page('admin.html'));
// Public: licence and source offer must be reachable without an account (NOTICE term 1(b), AGPL section 13).
app.get('/about', page('about.html'));
app.get('/manifest.json', page('manifest.json'));
app.get('/favicon.ico', (req, res) => res.redirect(301, to('/img/favicon-32.png')));
app.use('/img', express.static(path.join(DIST, 'img'), { maxAge: '1d' }));
app.use('/assets', express.static(path.join(DIST, 'assets'), { immutable: true, maxAge: '1y' }));

// --- Server + WebSocket ---------------------------------------------------

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 10 * 1024 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;
  const sameHost = origin && new URL(origin).host === req.headers.host;
  if (!req.url.startsWith('/collab') || !sameHost) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const request = new Request(`http://${req.headers.host}${req.url}`, { headers: { cookie: req.headers.cookie || '' } });
    const conn = hocuspocus.handleConnection(ws, request);
    ws.on('message', (data) => conn.handleMessage(new Uint8Array(data)));
    ws.on('close', (code, reason) => conn.handleClose({ code, reason: reason.toString() }));
    ws.on('pong', () => conn.touch());
  });
});

// Keeps idle but healthy connections alive.
setInterval(() => wss.clients.forEach((ws) => ws.ping()), 10_000).unref();

const shutdown = () => {
  hocuspocus.flushPendingStores();
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, HOST, () => console.log(`LMA Coop listening on http://${HOST}:${PORT}`));
