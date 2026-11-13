// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Starts the real server on a temp database and checks auth, documents and live sync.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'gdk-test-'));
const PORT = 5300 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${PORT}`;
const PASSWORD = randomUUID();
const env = { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), GDK_PASSWORD: PASSWORD };
let server;

before(async () => {
  execFileSync('node', ['--no-warnings', 'scripts/adduser.js', 'anna', 'Anna'], { cwd: root, env });
  server = spawn('node', ['--no-warnings', 'server/index.js'], { cwd: root, env });
  server.stderr.on('data', (d) => process.stderr.write(d));
  await new Promise((resolve) => server.stdout.once('data', resolve));
});

after(() => {
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
});

async function login(username = 'anna', password = PASSWORD) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

const json = (cookie, url, method = 'GET', body) => fetch(`${base}${url}`, {
  method, headers: { cookie, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
});

/** Connects a Yjs client with the given cookie; resolves once synced or rejects on auth failure. */
function connect(docId, cookie) {
  class CookieWebSocket extends WebSocket {
    constructor(url, protocols) {
      super(url, protocols, { headers: { cookie, origin: base } });
    }
  }
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: `ws://127.0.0.1:${PORT}/collab`, WebSocketPolyfill: CookieWebSocket, maxAttempts: 1,
  });
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({ websocketProvider, name: docId, document: doc, token: 'cookie' });
  provider.attach(); // Needed when the websocket provider is passed in explicitly.
  const closed = new Promise((resolve) => provider.on('close', ({ event }) => resolve(event.reason)));
  return new Promise((resolve, reject) => {
    provider.on('synced', () => resolve({ provider, doc, websocketProvider, closed }));
    provider.on('authenticationFailed', () => { provider.destroy(); websocketProvider.destroy(); reject(new Error('auth failed')); });
  });
}

test('rejects wrong password and unauthenticated API calls', async () => {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'anna', password: 'wrong' }),
  });
  assert.equal(res.status, 401);
  assert.equal((await fetch(`${base}/api/docs`)).status, 401);
});

test('creates, renames, soft-deletes and restores a document', async () => {
  const cookie = await login();
  const { id } = await (await json(cookie, '/api/docs', 'POST', {})).json();
  assert.equal((await json(cookie, `/api/docs/${id}`, 'PATCH', { title: 'Paper' })).status, 200);
  let docs = await (await json(cookie, '/api/docs')).json();
  assert.equal(docs.find((d) => d.id === id).title, 'Paper');
  await json(cookie, `/api/docs/${id}`, 'DELETE');
  docs = await (await json(cookie, '/api/docs')).json();
  assert.ok(!docs.some((d) => d.id === id));
  await json(cookie, `/api/docs/${id}/restore`, 'POST');
  docs = await (await json(cookie, '/api/docs')).json();
  assert.ok(docs.some((d) => d.id === id));
});

test('sets a document status; renaming keeps it', async () => {
  const cookie = await login();
  const { id, status } = await (await json(cookie, '/api/docs', 'POST', {})).json();
  assert.equal(status, 'idea', 'new documents start as idea');
  assert.equal((await json(cookie, `/api/docs/${id}`, 'PATCH', { status: 'finished' })).status, 200);
  assert.equal((await json(cookie, `/api/docs/${id}`, 'PATCH', { title: 'Renamed' })).status, 200);
  const doc = await (await json(cookie, `/api/docs/${id}`)).json();
  assert.equal(doc.status, 'finished');
  assert.equal(doc.title, 'Renamed');
  assert.equal((await (await json(cookie, '/api/docs')).json()).find((d) => d.id === id).status, 'finished');
  assert.equal((await json(cookie, `/api/docs/${id}`, 'PATCH', { status: 'deleted' })).status, 400);
  assert.equal((await json(cookie, `/api/docs/${id}`, 'PATCH', {})).status, 400);
  assert.equal((await json(cookie, `/api/docs/${id}`, 'PATCH', { title: '  ' })).status, 400);
});

test('admins keep the tag list; documents get tags from it', async () => {
  const cookie = await login();
  const { id, tags } = await (await json(cookie, '/api/docs', 'POST', { title: 'Tagged' })).json();
  assert.deepEqual(tags, []);
  const { id: other } = await (await json(cookie, '/api/docs', 'POST', { title: 'Other' })).json();

  // Admin: create, reject duplicates and bad names.
  let res = await json(cookie, '/api/admin/tags', 'POST', { name: '  Review ' });
  assert.equal(res.status, 201);
  const review = await res.json();
  assert.equal(review.name, 'Review');
  assert.equal((await json(cookie, '/api/admin/tags', 'POST', { name: 'review' })).status, 409);
  assert.equal((await json(cookie, '/api/admin/tags', 'POST', { name: ' ' })).status, 400);
  assert.equal((await json(cookie, '/api/admin/tags', 'POST', { name: 'x'.repeat(41) })).status, 400);
  const pre = await (await json(cookie, '/api/admin/tags', 'POST', { name: 'Präanalytik' })).json();

  // Assigning: only tags from the list; the list's spelling wins.
  assert.equal((await json(cookie, `/api/docs/${id}/tags`, 'PUT', { tags: ['Neu'] })).status, 400, 'unknown tag');
  res = await json(cookie, `/api/docs/${id}/tags`, 'PUT', { tags: ['review', 'Präanalytik', 'REVIEW', ''] });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).tags, ['Präanalytik', 'Review']);
  await json(cookie, `/api/docs/${other}/tags`, 'PUT', { tags: ['Review'] });
  assert.deepEqual((await (await json(cookie, `/api/docs/${id}`)).json()).tags, ['Präanalytik', 'Review']);
  assert.deepEqual((await (await json(cookie, '/api/docs')).json()).find((d) => d.id === other).tags, ['Review']);
  assert.ok((await (await json(cookie, '/api/docs/tags')).json()).includes('Präanalytik'));
  assert.equal((await (await json(cookie, '/api/admin/tags')).json()).find((t) => t.id === review.id).docs, 2);

  // Removing a tag from all documents keeps it in the list.
  await json(cookie, `/api/docs/${id}/tags`, 'PUT', { tags: ['Review'] });
  assert.ok((await (await json(cookie, '/api/docs/tags')).json()).includes('Präanalytik'), 'unused tags stay');

  // Rename changes every document; delete removes the tag from every document.
  assert.equal((await json(cookie, `/api/admin/tags/${review.id}`, 'PATCH', { name: 'Präanalytik' })).status, 409);
  assert.equal((await json(cookie, `/api/admin/tags/${review.id}`, 'PATCH', { name: 'Peer Review' })).status, 200);
  assert.deepEqual((await (await json(cookie, `/api/docs/${other}`)).json()).tags, ['Peer Review']);
  assert.equal((await json(cookie, `/api/admin/tags/${review.id}`, 'DELETE')).status, 200);
  assert.deepEqual((await (await json(cookie, `/api/docs/${other}`)).json()).tags, []);
  assert.equal((await json(cookie, `/api/admin/tags/${review.id}`, 'DELETE')).status, 404);
  await json(cookie, `/api/admin/tags/${pre.id}`, 'DELETE');

  assert.equal((await json(cookie, `/api/docs/${id}/tags`, 'PUT', { tags: 'Review' })).status, 400);
  assert.equal((await json(cookie, `/api/docs/${id}/tags`, 'PUT', { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).status, 400);
});

test('blocks cross-origin writes', async () => {
  const cookie = await login();
  const res = await fetch(`${base}/api/docs`, { method: 'POST', headers: { cookie, origin: 'http://evil.example' } });
  assert.equal(res.status, 403);
});

test('syncs edits between two clients and rejects clients without session', async () => {
  const cookie = await login();
  const { id } = await (await json(cookie, '/api/docs', 'POST', {})).json();

  const a = await connect(id, cookie);
  const b = await connect(id, cookie);
  const received = new Promise((resolve) => b.doc.getMap('references').observe(resolve));
  a.doc.getMap('references').set('r1', { title: 'Deep learning' });
  await received;
  assert.equal(b.doc.getMap('references').get('r1').title, 'Deep learning');

  await assert.rejects(connect(id, 'gdk_session=invalid'));
  for (const c of [a, b]) { c.provider.destroy(); c.websocketProvider.destroy(); }
});

test('admin manages users; documents are private until shared; suggesters may only suggest', async () => {
  const anna = await login();
  const me = await (await json(anna, '/api/me')).json();
  assert.equal(me.isAdmin, true, 'first account is admin');

  const benPassword = randomUUID();
  assert.equal((await json(anna, '/api/admin/users', 'POST', { username: 'ben', name: 'Ben', password: benPassword })).status, 201);
  assert.equal((await json(anna, '/api/admin/users', 'POST', { username: 'ben', name: 'Ben', password: benPassword })).status, 409);
  assert.equal((await json(anna, `/api/admin/users/${me.id}`, 'PATCH', { isAdmin: false })).status, 400, 'no self-demotion');
  const ben = await login('ben', benPassword);
  assert.equal((await json(ben, '/api/admin/users')).status, 403, 'non-admin');
  const benId = (await (await json(anna, '/api/users')).json()).find((u) => u.username === 'ben').id;

  const { id } = await (await json(anna, '/api/docs', 'POST', { title: 'Shared paper' })).json();
  assert.equal((await json(ben, `/api/docs/${id}`)).status, 404, 'not shared yet');
  assert.ok(!(await (await json(ben, '/api/docs')).json()).some((d) => d.id === id));
  await assert.rejects(connect(id, ben), 'no websocket access before sharing');

  assert.equal((await json(ben, `/api/docs/${id}/members/${benId}`, 'PUT', { role: 'editor' })).status, 404);
  assert.equal((await json(anna, `/api/docs/${id}/members/${benId}`, 'PUT', { role: 'suggester' })).status, 200);
  const listed = (await (await json(ben, '/api/docs')).json()).find((d) => d.id === id);
  assert.equal(listed.role, 'suggester');
  assert.equal((await json(ben, `/api/docs/${id}`, 'PATCH', { title: 'Hijack' })).status, 403);
  assert.equal((await json(ben, `/api/docs/${id}`, 'PATCH', { status: 'archived' })).status, 403, 'suggester may not set status');
  assert.equal((await json(ben, `/api/docs/${id}/tags`, 'PUT', { tags: ['Hijack'] })).status, 403, 'suggester may not set tags');
  assert.equal((await json(ben, `/api/docs/${id}`, 'DELETE')).status, 403);
  // Only the owner deletes: edit rights are not enough.
  assert.equal((await json(anna, `/api/docs/${id}/members/${benId}`, 'PUT', { role: 'editor' })).status, 200);
  assert.equal((await json(ben, `/api/docs/${id}`, 'DELETE')).status, 403, 'editor may not delete');
  // Editors assign tags from the list, but only admins create tags.
  assert.equal((await json(ben, '/api/admin/tags', 'POST', { name: 'Ben-Tag' })).status, 403, 'non-admin may not create tags');
  const benTag = await (await json(anna, '/api/admin/tags', 'POST', { name: 'Editor-Tag' })).json();
  assert.equal((await json(ben, `/api/docs/${id}/tags`, 'PUT', { tags: ['Editor-Tag'] })).status, 200);
  assert.equal((await json(ben, `/api/docs/${id}/tags`, 'PUT', { tags: ['Ben-Tag'] })).status, 400);
  assert.ok((await (await json(ben, '/api/docs/tags')).json()).includes('Editor-Tag'));
  await json(anna, `/api/admin/tags/${benTag.id}`, 'DELETE');
  assert.equal((await json(anna, `/api/docs/${id}/members/${benId}`, 'PUT', { role: 'suggester' })).status, 200);

  const a = await connect(id, anna);
  a.doc.getMap('references').set('r1', { title: 'Existing' });
  const b = await connect(id, ben);
  await new Promise((r) => setTimeout(r, 200));

  // Adding a reference is allowed for suggesters ...
  const seen = new Promise((resolve) => a.doc.getMap('references').observe(resolve));
  b.doc.getMap('references').set('r2', { title: 'From Ben' });
  await seen;
  assert.equal(a.doc.getMap('references').get('r2').title, 'From Ben');

  // ... removing one is not: the server closes the document connection.
  b.doc.getMap('references').delete('r1');
  assert.equal(await b.closed, 'suggestion-only');
  assert.ok(a.doc.getMap('references').has('r1'));

  // Deleting a user moves their documents to the admin.
  for (const c of [a, b]) { c.provider.destroy(); c.websocketProvider.destroy(); }
  const { id: bensDoc } = await (await json(ben, '/api/docs', 'POST', { title: 'Ben solo' })).json();
  const del = await (await json(anna, `/api/admin/users/${benId}`, 'DELETE')).json();
  assert.equal(del.movedDocs, 1);
  assert.ok((await (await json(anna, '/api/docs')).json()).some((d) => d.id === bensDoc && d.role === 'owner'));
  assert.equal((await json(ben, '/api/me')).status, 401, 'sessions of deleted user are gone');
});

test('users request access or edit rights; the owner approves or declines', async () => {
  const anna = await login();
  const claraPassword = randomUUID();
  assert.equal((await json(anna, '/api/admin/users', 'POST', { username: 'clara', name: 'Clara', password: claraPassword })).status, 201);
  const clara = await login('clara', claraPassword);
  const claraId = (await (await json(anna, '/api/users')).json()).find((u) => u.username === 'clara').id;
  const { id } = await (await json(anna, '/api/docs', 'POST', { title: 'Requested paper' })).json();

  assert.equal((await json(clara, `/api/docs/${randomUUID()}/request`)).status, 404, 'unknown document');
  assert.deepEqual(await (await json(clara, `/api/docs/${id}/request`)).json(),
    { title: 'Requested paper', owner: 'Anna', role: null, pending: null, canRequest: true });
  let other = (await (await json(clara, '/api/docs/discover')).json()).find((d) => d.id === id);
  assert.equal(other.title, 'Requested paper');
  assert.equal(other.requested, null);
  assert.ok(!(await (await json(anna, '/api/docs/discover')).json()).some((d) => d.id === id), 'own documents are not listed');
  assert.equal((await json(clara, `/api/docs/${id}/request`, 'PUT', { role: 'owner' })).status, 400);
  assert.equal((await json(anna, `/api/docs/${id}/request`, 'PUT', { role: 'editor' })).status, 400, 'owner has all rights');
  assert.equal((await json(clara, `/api/docs/${id}/requests`)).status, 404, 'only the owner sees requests');

  // The owner's open editor is told about new requests.
  const a = await connect(id, anna);
  const notified = new Promise((resolve) => a.provider.on('stateless', ({ payload }) => resolve(payload)));
  assert.equal((await json(clara, `/api/docs/${id}/request`, 'PUT', { role: 'suggester' })).status, 200);
  assert.equal(await notified, 'access-requests');
  assert.equal((await (await json(anna, '/api/docs')).json()).find((d) => d.id === id).requests, 1);
  other = (await (await json(clara, '/api/docs/discover')).json()).find((d) => d.id === id);
  assert.equal(other.requested, 'suggester');
  let requests = await (await json(anna, `/api/docs/${id}/requests`)).json();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].role, 'suggester');
  assert.equal(requests[0].current, null);

  // Approving sets the role and clears the request.
  assert.equal((await json(anna, `/api/docs/${id}/members/${claraId}`, 'PUT', { role: 'suggester' })).status, 200);
  assert.equal((await (await json(clara, `/api/docs/${id}/request`)).json()).role, 'suggester');
  assert.ok(!(await (await json(clara, '/api/docs/discover')).json()).some((d) => d.id === id), 'shared documents leave the list');
  assert.equal((await json(clara, `/api/docs/${id}/request`, 'PUT', { role: 'suggester' })).status, 400, 'already has it');

  // A suggester asks for edit rights; the owner declines and can undo that.
  assert.equal((await json(clara, `/api/docs/${id}/request`, 'PUT', { role: 'editor' })).status, 200);
  requests = await (await json(anna, `/api/docs/${id}/requests`)).json();
  assert.equal(requests[0].current, 'suggester');
  assert.equal((await json(anna, `/api/docs/${id}/requests/${claraId}`, 'DELETE')).status, 200);
  assert.equal((await (await json(clara, `/api/docs/${id}/request`)).json()).pending, null);
  assert.equal((await json(anna, `/api/docs/${id}/requests/${claraId}`, 'PUT', { role: 'editor' })).status, 200);
  assert.equal((await (await json(clara, `/api/docs/${id}/request`)).json()).pending.role, 'editor');

  // The requester can withdraw.
  assert.equal((await json(clara, `/api/docs/${id}/request`, 'DELETE')).status, 200);
  assert.equal((await (await json(anna, `/api/docs/${id}/requests`)).json()).length, 0);

  a.provider.destroy();
  a.websocketProvider.destroy();
});

test('role "Lesen": reads the document and comments, changes nothing; may request "Vorschlagen"', async () => {
  const anna = await login();
  const fritzPassword = randomUUID();
  assert.equal((await json(anna, '/api/admin/users', 'POST', { username: 'fritz', name: 'Fritz', password: fritzPassword })).status, 201);
  const fritz = await login('fritz', fritzPassword);
  const fritzId = (await (await json(anna, '/api/users')).json()).find((u) => u.username === 'fritz').id;
  const { id } = await (await json(anna, '/api/docs', 'POST', { title: 'Read me' })).json();
  assert.equal((await json(anna, `/api/docs/${id}/members/${fritzId}`, 'PUT', { role: 'viewer' })).status, 200);
  assert.equal((await (await json(fritz, `/api/docs/${id}`)).json()).role, 'viewer');
  assert.equal((await (await json(fritz, '/api/docs')).json()).find((d) => d.id === id).role, 'viewer');
  assert.equal((await json(fritz, `/api/docs/${id}`, 'PATCH', { title: 'Nope' })).status, 403);

  const a = await connect(id, anna);
  a.doc.getMap('references').set('r1', { title: 'Existing' });
  const f = await connect(id, fritz);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(f.doc.getMap('references').get('r1').title, 'Existing', 'viewer receives the document');
  // The server ignores the viewer's changes.
  f.doc.getMap('references').set('r2', { title: 'From Fritz' });
  f.doc.getMap('references').delete('r1');
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(a.doc.getMap('references').has('r1'));
  assert.ok(!a.doc.getMap('references').has('r2'));
  for (const c of [a, f]) { c.provider.destroy(); c.websocketProvider.destroy(); }

  // Comments: read yes, write no. Images: load yes, upload no.
  const thread = randomUUID();
  assert.equal((await json(anna, `/api/docs/${id}/comments`, 'POST', { id: thread, body: 'Hi', quote: 'x' })).status, 201);
  assert.equal((await (await json(fritz, `/api/docs/${id}/comments`)).json()).length, 1);
  assert.equal((await json(fritz, `/api/docs/${id}/comments`, 'POST', { id: randomUUID(), body: 'Me too' })).status, 403);
  assert.equal((await json(fritz, `/api/docs/${id}/comments/${thread}/replies`, 'POST', { body: 'Re' })).status, 403);
  assert.equal((await json(fritz, `/api/docs/${id}/comments/${thread}/resolve`, 'POST', { resolved: true })).status, 403);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const upload = await fetch(`${base}/api/docs/${id}/images`, { method: 'POST', headers: { cookie: fritz }, body: png });
  assert.equal(upload.status, 403);

  // Next step up is "Vorschlagen" or "Bearbeiten"; "Lesen" cannot be requested.
  assert.equal((await json(fritz, `/api/docs/${id}/request`, 'PUT', { role: 'viewer' })).status, 400);
  assert.equal((await json(fritz, `/api/docs/${id}/request`, 'PUT', { role: 'suggester' })).status, 200);
  assert.equal((await (await json(anna, `/api/docs/${id}/requests`)).json())[0].current, 'viewer');
  assert.equal((await json(fritz, `/api/docs/${id}/request`, 'DELETE')).status, 200);
});

test('admin sets account permissions and document access per person', async () => {
  const anna = await login();
  const annaId = (await (await json(anna, '/api/me')).json()).id;
  const gretaPassword = randomUUID();
  assert.equal((await json(anna, '/api/admin/users', 'POST', { username: 'greta', name: 'Greta', password: gretaPassword })).status, 201);
  const greta = await login('greta', gretaPassword);
  const gretaId = (await (await json(anna, '/api/users')).json()).find((u) => u.username === 'greta').id;
  const { id } = await (await json(anna, '/api/docs', 'POST', { title: 'Admin shared' })).json();

  // Defaults: everything allowed.
  let row = (await (await json(anna, '/api/admin/users')).json()).find((u) => u.id === gretaId);
  assert.deepEqual([row.canCreate, row.canRequest, row.seeOthers, row.sharedDocs], [true, true, true, 0]);
  const me = await (await json(greta, '/api/me')).json();
  assert.deepEqual([me.canCreate, me.canRequest, me.seeOthers], [true, true, true]);

  // 3) Creating documents.
  assert.equal((await json(anna, `/api/admin/users/${gretaId}`, 'PATCH', { canCreate: false })).status, 200);
  assert.equal((await json(greta, '/api/docs', 'POST', { title: 'Mine' })).status, 403);
  assert.equal((await (await json(greta, '/api/me')).json()).canCreate, false);

  // 4) Requesting rights.
  assert.equal((await json(anna, `/api/admin/users/${gretaId}`, 'PATCH', { canRequest: false })).status, 200);
  assert.equal((await json(greta, `/api/docs/${id}/request`, 'PUT', { role: 'suggester' })).status, 403);
  assert.equal((await (await json(greta, `/api/docs/${id}/request`)).json()).canRequest, false);

  // 1) Titles of other documents.
  assert.ok((await (await json(greta, '/api/docs/discover')).json()).some((d) => d.id === id));
  assert.equal((await json(anna, `/api/admin/users/${gretaId}`, 'PATCH', { seeOthers: false })).status, 200);
  assert.deepEqual(await (await json(greta, '/api/docs/discover')).json(), []);
  assert.equal((await json(greta, `/api/docs/${id}/request`)).status, 404, 'hidden documents stay hidden');

  // 1) + 2) Admin grants a document with a role, changes it and removes it.
  const docs = await (await json(anna, `/api/admin/users/${gretaId}/docs`)).json();
  assert.equal(docs.find((d) => d.id === id).role, null);
  assert.equal((await json(anna, `/api/admin/users/${gretaId}/docs/${id}`, 'PUT', { role: 'owner' })).status, 400);
  assert.equal((await json(anna, `/api/admin/users/${gretaId}/docs/${id}`, 'PUT', { role: 'viewer' })).status, 200);
  assert.equal((await (await json(greta, `/api/docs/${id}`)).json()).role, 'viewer');
  assert.equal((await json(greta, `/api/docs/${id}/request`)).status, 200, 'shared documents are visible again');
  assert.equal((await json(anna, `/api/admin/users/${gretaId}/docs/${id}`, 'PUT', { role: 'editor' })).status, 200);
  assert.equal((await (await json(greta, `/api/docs/${id}`)).json()).role, 'editor');
  row = (await (await json(anna, '/api/admin/users')).json()).find((u) => u.id === gretaId);
  assert.equal(row.sharedDocs, 1);
  assert.equal((await json(anna, `/api/admin/users/${gretaId}/docs/${id}`, 'PUT', { role: null })).status, 200);
  assert.equal((await json(greta, `/api/docs/${id}`)).status, 404);

  // Not for the owner of the document, not for yourself, not for non-admins.
  const { id: annas } = await (await json(anna, '/api/docs', 'POST', { title: 'Anna only' })).json();
  assert.equal((await json(anna, `/api/admin/users/${annaId}/docs/${annas}`, 'PUT', { role: 'editor' })).status, 400);
  assert.equal((await json(greta, `/api/admin/users/${gretaId}/docs/${annas}`, 'PUT', { role: 'editor' })).status, 403);
  assert.equal((await json(greta, `/api/admin/users/${gretaId}/docs`)).status, 403);
  const ownerRow = (await (await json(anna, `/api/admin/users/${annaId}/docs`)).json()).find((d) => d.id === annas);
  assert.equal(ownerRow.role, 'owner');
});

test('comments: every role comments, replies and resolves; only authors edit; deleting needs rights', async () => {
  const anna = await login();
  const daniPassword = randomUUID();
  const eliPassword = randomUUID();
  await json(anna, '/api/admin/users', 'POST', { username: 'dani', name: 'Dani', password: daniPassword });
  await json(anna, '/api/admin/users', 'POST', { username: 'eli', name: 'Eli', password: eliPassword });
  const dani = await login('dani', daniPassword);
  const eli = await login('eli', eliPassword);
  const users = await (await json(anna, '/api/users')).json();
  const daniId = users.find((u) => u.username === 'dani').id;
  const { id } = await (await json(anna, '/api/docs', 'POST', { title: 'Commented paper' })).json();
  const base = `/api/docs/${id}/comments`;

  assert.equal((await json(dani, base)).status, 404, 'no access, no comments');
  await json(anna, `/api/docs/${id}/members/${daniId}`, 'PUT', { role: 'suggester' });

  // Open editors are told about changes.
  const a = await connect(id, anna);
  const notified = new Promise((resolve) => a.provider.on('stateless', ({ payload }) => resolve(payload)));
  const threadId = randomUUID();
  assert.equal((await json(dani, base, 'POST', { id: threadId, body: 'Quelle?', quote: 'Wir zeigen' })).status, 201);
  assert.equal(await notified, 'comments');
  assert.equal((await json(dani, base, 'POST', { id: threadId, body: 'again' })).status, 409);
  assert.equal((await json(dani, base, 'POST', { id: 'bad id!', body: 'x' })).status, 400);
  assert.equal((await json(dani, base, 'POST', { id: randomUUID(), body: '   ' })).status, 400);

  const reply = await (await json(anna, `${base}/${threadId}/replies`, 'POST', { body: 'Ergänze ich.' })).json();
  assert.equal((await json(anna, `${base}/${threadId}`, 'PATCH', { body: 'Hijack' })).status, 403, 'not the author');
  assert.equal((await json(dani, `${base}/${threadId}`, 'PATCH', { body: 'Quelle bitte?' })).status, 200);
  assert.equal((await json(eli, `${base}/${threadId}/resolve`, 'POST', {})).status, 404, 'no access');

  let [thread] = await (await json(anna, base)).json();
  assert.equal(thread.quote, 'Wir zeigen');
  assert.deepEqual(thread.comments.map((c) => [c.author, c.body]), [['Dani', 'Quelle bitte?'], ['Anna', 'Ergänze ich.']]);
  assert.ok(thread.comments[0].editedAt);

  // The suggester resolves; a reply reopens the thread.
  assert.equal((await json(dani, `${base}/${threadId}/resolve`, 'POST', { resolved: true })).status, 200);
  [thread] = await (await json(anna, base)).json();
  assert.equal(thread.resolvedBy, 'Dani');
  await json(dani, `${base}/${threadId}/replies`, 'POST', { body: 'Doch noch offen' });
  [thread] = await (await json(anna, base)).json();
  assert.equal(thread.resolvedAt, null);
  assert.equal(thread.comments.length, 3);

  // A suggester may delete only own comments; the owner may delete any. Deletion can be undone.
  assert.equal((await json(dani, `${base}/${reply.id}`, 'DELETE')).status, 403);
  assert.equal((await json(anna, `${base}/${reply.id}`, 'DELETE')).status, 200);
  [thread] = await (await json(anna, base)).json();
  assert.equal(thread.comments.length, 2);
  assert.equal((await json(dani, `${base}/${reply.id}/restore`, 'POST')).status, 403);
  assert.equal((await json(anna, `${base}/${reply.id}/restore`, 'POST')).status, 200);
  assert.equal((await json(dani, `${base}/${threadId}`, 'DELETE')).status, 200, 'own thread');
  assert.deepEqual(await (await json(anna, base)).json(), [], 'deleting the first comment hides the thread');
  assert.equal((await json(dani, `${base}/${threadId}/restore`, 'POST')).status, 200);
  assert.equal((await (await json(anna, base)).json())[0].comments.length, 3);

  a.provider.destroy();
  a.websocketProvider.destroy();
});

test('comments import from Word: keeps authors, dates, replies and done state; not for suggesters', async () => {
  const anna = await login();
  const ginaPassword = randomUUID();
  await json(anna, '/api/admin/users', 'POST', { username: 'gina', name: 'Gina', password: ginaPassword });
  const gina = await login('gina', ginaPassword);
  const ginaId = (await (await json(anna, '/api/users')).json()).find((u) => u.username === 'gina').id;
  const { id } = await (await json(anna, '/api/docs', 'POST', { title: 'Imported paper' })).json();
  await json(anna, `/api/docs/${id}/members/${ginaId}`, 'PUT', { role: 'suggester' });
  const url = `/api/docs/${id}/comments/import`;
  const threadId = randomUUID();
  const threads = [
    { id: threadId, quote: 'Satz', resolved: true, comments: [
      { author: 'Prof. Extern', body: 'Quelle?', createdAt: Date.parse('2026-03-01T10:00:00Z') },
      { author: 'gina', body: 'Ergänzt.', createdAt: Date.parse('2026-03-02T10:00:00Z') },
    ] },
    { id: 'bad id!', comments: [{ author: 'X', body: 'skipped' }] },
    { id: randomUUID(), comments: [{ author: 'X', body: '   ' }] },
  ];
  assert.equal((await json(gina, url, 'POST', { threads })).status, 403, 'suggesters cannot import');
  const res = await json(anna, url, 'POST', { threads });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).count, 1);
  assert.equal((await (await json(anna, url, 'POST', { threads })).json()).count, 0, 'same ids are not imported twice');

  const [thread] = await (await json(anna, `/api/docs/${id}/comments`)).json();
  assert.equal(thread.id, threadId);
  assert.equal(thread.quote, 'Satz');
  assert.ok(thread.resolvedAt);
  assert.deepEqual(thread.comments.map((c) => [c.author, c.authorId, c.body]),
    [['Prof. Extern', null, 'Quelle?'], ['Gina', ginaId, 'Ergänzt.']], 'a matching name links the account');
  assert.equal(thread.comments[0].createdAt, Date.parse('2026-03-01T10:00:00Z'));
  // The linked account may edit its imported comment.
  assert.equal((await json(gina, `/api/docs/${id}/comments/${thread.comments[1].id}`, 'PATCH', { body: 'Ergänzt!' })).status, 200);
});

test('images: members upload and load, others get 404; only real PNG/JPEG/GIF/WebP up to 10 MB', async () => {
  const anna = await login();
  const fynnPassword = randomUUID();
  await json(anna, '/api/admin/users', 'POST', { username: 'fynn', name: 'Fynn', password: fynnPassword });
  const fynn = await login('fynn', fynnPassword);
  const fynnId = (await (await json(anna, '/api/users')).json()).find((u) => u.username === 'fynn').id;
  const { id } = await (await json(anna, '/api/docs', 'POST', { title: 'Figures' })).json();
  const url = `/api/docs/${id}/images`;
  const upload = (cookie, body, type = 'image/png') => fetch(`${base}${url}`, { method: 'POST', headers: { cookie, 'Content-Type': type }, body });
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000'
    + '1f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b00000000049454e44ae426082', 'hex');

  let res = await upload(anna, png);
  assert.equal(res.status, 201);
  const { src } = await res.json();
  assert.match(src, new RegExp(`^/api/docs/${id}/images/[0-9a-f-]{36}$`));
  res = await fetch(`${base}${src}`, { headers: { cookie: anna } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), png);

  assert.equal((await fetch(`${base}${src}`, { headers: { cookie: fynn } })).status, 404, 'no access, no image');
  assert.equal((await fetch(`${base}${src}`)).status, 401, 'not signed in');
  assert.equal((await upload(fynn, png)).status, 404, 'no access, no upload');

  // Suggesters may upload (they suggest images).
  await json(anna, `/api/docs/${id}/members/${fynnId}`, 'PUT', { role: 'suggester' });
  assert.equal((await upload(fynn, png)).status, 201);
  assert.equal((await fetch(`${base}${src}`, { headers: { cookie: fynn } })).status, 200);

  // The file content decides, not the declared type.
  assert.equal((await upload(anna, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'image/svg+xml')).status, 415);
  assert.equal((await upload(anna, 'not an image', 'image/png')).status, 415);
  assert.equal((await upload(anna, Buffer.concat([png, Buffer.alloc(10 * 1024 * 1024)]))).status, 413);
  assert.equal((await fetch(`${base}${url}/not-an-id`, { headers: { cookie: anna } })).status, 404);
});
