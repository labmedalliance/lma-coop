// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Server behind a proxy that serves it below /write and removes the prefix (BASE_PATH).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'gdk-base-'));
const PORT = 5800 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${PORT}`;
const PASSWORD = randomUUID();
const env = { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), GDK_PASSWORD: PASSWORD, BASE_PATH: '/write/' };
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

test('redirects point below the base path', async () => {
  const get = (url) => fetch(`${base}${url}`, { redirect: 'manual' });
  assert.equal((await get('/')).headers.get('location'), '/write/login');
  assert.equal((await get('/d/x')).headers.get('location'), '/write/login');
  assert.equal((await get('/favicon.ico')).headers.get('location'), '/write/img/favicon-32.png');
});

test('pages of the same origin may frame the app (start page with iframes)', async () => {
  const res = await fetch(`${base}/login`);
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'self'/);
});

test('session cookie is limited to the base path', async () => {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'anna', password: PASSWORD }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /Path=\/write;/);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const admin = await fetch(`${base}/admin`, { headers: { cookie } });
  assert.equal(admin.status, 200, 'first account is admin');
  const logout = await fetch(`${base}/api/logout`, { method: 'POST', headers: { cookie } });
  assert.match(logout.headers.get('set-cookie'), /Path=\/write;/);
});
