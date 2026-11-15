// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Files with versions: checkout, upload rules against a version mess, restore, roles.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'gdk-files-'));
const PORT = 5850 + Math.floor(Math.random() * 100);
const base = `http://127.0.0.1:${PORT}`;
const PASSWORD = randomUUID();
const env = { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), GDK_PASSWORD: PASSWORD };
let server;
let anna;
let ben;
let carl;

async function login(username) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: PASSWORD }),
  });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

before(async () => {
  for (const [user, name] of [['anna', 'Anna'], ['ben', 'Ben'], ['carl', 'Carl']]) {
    execFileSync('node', ['--no-warnings', 'scripts/adduser.js', user, name], { cwd: root, env });
  }
  server = spawn('node', ['--no-warnings', 'server/index.js'], { cwd: root, env });
  server.stderr.on('data', (d) => process.stderr.write(d));
  await new Promise((resolve) => server.stdout.once('data', resolve));
  [anna, ben, carl] = await Promise.all(['anna', 'ben', 'carl'].map(login));
});

after(() => {
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
});

const json = (cookie, url, method = 'GET', body) => fetch(`${base}${url}`, {
  method, headers: { cookie, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
});
const upload = (cookie, url, name, content, note) => fetch(`${base}${url}`, {
  method: 'POST',
  headers: {
    cookie, 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name),
    ...(note ? { 'X-Note': encodeURIComponent(note) } : {}),
  },
  body: Buffer.from(content),
});
const userId = async (username) => (await (await json(anna, '/api/users')).json()).find((u) => u.username === username).id;

test('versioned file: checkout, upload rules, restore, roles', async () => {
  // Version 1 from an upload; the list shows it as a file.
  let res = await upload(anna, '/api/files', 'Budget 2027.xlsx', 'v1');
  assert.equal(res.status, 201);
  const { id, title } = await res.json();
  assert.equal(title, 'Budget 2027');
  const listed = (await (await json(anna, '/api/docs')).json()).find((d) => d.id === id);
  assert.equal(listed.kind, 'file');
  assert.equal(listed.version, 1);
  assert.equal((await (await json(anna, `/api/docs/${id}`)).json()).kind, 'file');

  // Download carries title and version in the name.
  res = await fetch(`${base}/api/docs/${id}/file/versions/latest`, { headers: { cookie: anna } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /Budget 2027_v1\.xlsx/);
  assert.equal(await res.text(), 'v1');

  await json(anna, `/api/docs/${id}/members/${await userId('ben')}`, 'PUT', { role: 'editor' });
  await json(anna, `/api/docs/${id}/members/${await userId('carl')}`, 'PUT', { role: 'viewer' });
  const fileUrl = `/api/docs/${id}/file`;

  // Without checkout no upload.
  res = await upload(ben, `${fileUrl}/versions`, 'Budget 2027_v1.xlsx', 'ben');
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, 'not-checked-out');

  // Ben checks out; Anna can no longer check out or upload, but can download.
  assert.equal((await json(ben, `${fileUrl}/checkout`, 'POST')).status, 200);
  res = await json(anna, `${fileUrl}/checkout`, 'POST');
  assert.equal(res.status, 409);
  assert.equal((await res.json()).checkout.name, 'Ben');
  assert.equal((await upload(anna, `${fileUrl}/versions`, 'x.xlsx', 'anna')).status, 409);
  assert.equal((await fetch(`${base}${fileUrl}/versions/1`, { headers: { cookie: anna } })).status, 200);

  // The unchanged download, an old version and a different file type are refused.
  res = await upload(ben, `${fileUrl}/versions`, 'Budget 2027_v1.xlsx', 'v1');
  assert.deepEqual([res.status, (await res.json()).code], [409, 'unchanged']);
  res = await upload(ben, `${fileUrl}/versions`, 'Budget.docx', 'ben');
  assert.deepEqual([res.status, (await res.json()).code], [400, 'wrong-type']);

  // The changed file becomes version 2 and ends the checkout.
  res = await upload(ben, `${fileUrl}/versions`, 'Budget 2027_v1.xlsx', 'v2 by ben', 'Zahlen Q1');
  assert.equal(res.status, 201);
  let state = await res.json();
  assert.equal(state.versions[0].version, 2);
  assert.equal(state.versions[0].user, 'Ben');
  assert.equal(state.versions[0].note, 'Zahlen Q1');
  assert.equal(state.checkout, null);

  // Anna re-uploads her old v1 copy: refused with the version it matches.
  await json(anna, `${fileUrl}/checkout`, 'POST');
  res = await upload(anna, `${fileUrl}/versions`, 'Budget 2027_v1.xlsx', 'v1');
  assert.deepEqual(await res.json().then((b) => [res.status, b.code, b.version, b.current]), [409, 'old-version', 1, 2]);

  // Owner cancels her checkout; Ben checks out, Anna (owner) cancels his; his upload is then refused.
  await json(anna, `${fileUrl}/checkout`, 'DELETE');
  await json(ben, `${fileUrl}/checkout`, 'POST');
  assert.equal((await json(carl, `${fileUrl}/checkout`, 'DELETE')).status, 403);
  assert.equal((await json(anna, `${fileUrl}/checkout`, 'DELETE')).status, 200);
  res = await upload(ben, `${fileUrl}/versions`, 'b.xlsx', 'late');
  assert.equal((await res.json()).code, 'not-checked-out');

  // Anna uploads version 3.
  await json(anna, `${fileUrl}/checkout`, 'POST');
  assert.equal((await upload(anna, `${fileUrl}/versions`, 'a.xlsx', 'v3 by anna')).status, 201);

  // Restore makes v1 the newest version (v4); nothing is lost.
  res = await json(ben, `${fileUrl}/versions/1/restore`, 'POST');
  assert.equal(res.status, 201);
  state = await res.json();
  assert.deepEqual(state.versions.map((v) => v.version), [4, 3, 2, 1]);
  assert.equal(state.versions[0].restored_from, 1);
  assert.equal(await (await fetch(`${base}${fileUrl}/versions/latest`, { headers: { cookie: ben } })).text(), 'v1');

  // "Lesen" downloads but does not check out, upload or restore.
  assert.equal((await fetch(`${base}${fileUrl}/versions/2`, { headers: { cookie: carl } })).status, 200);
  assert.equal((await json(carl, `${fileUrl}/checkout`, 'POST')).status, 403);
  assert.equal((await json(carl, `${fileUrl}/versions/2/restore`, 'POST')).status, 403);

  // Text documents have no file API, files have no collaboration text.
  const { id: docId } = await (await json(anna, '/api/docs', 'POST', { title: 'Text' })).json();
  assert.equal((await json(anna, `/api/docs/${docId}/file`)).status, 404);
});

test('stale checkout: upload after someone else uploaded is refused', async () => {
  const { id } = await (await upload(anna, '/api/files', 'Plan.xlsx', 'p1')).json();
  const fileUrl = `/api/docs/${id}/file`;
  await json(anna, `/api/docs/${id}/members/${await userId('ben')}`, 'PUT', { role: 'editor' });
  // Ben checks out v1, the owner takes the file over and uploads v2, Ben's checkout is gone.
  await json(ben, `${fileUrl}/checkout`, 'POST');
  await json(anna, `${fileUrl}/checkout`, 'DELETE');
  await json(anna, `${fileUrl}/checkout`, 'POST');
  await upload(anna, `${fileUrl}/versions`, 'Plan.xlsx', 'p2');
  // Ben checks out again (now v2) and uploads his old download of v1: refused.
  await json(ben, `${fileUrl}/checkout`, 'POST');
  const res = await upload(ben, `${fileUrl}/versions`, 'Plan_v1.xlsx', 'p1');
  assert.deepEqual([res.status, (await res.json()).code], [409, 'old-version']);
});

test('upload limits: empty file and missing name', async () => {
  assert.equal((await upload(anna, '/api/files', 'x.xlsx', '')).status, 400);
  assert.equal((await upload(anna, '/api/files', '', 'abc')).status, 400);
});
