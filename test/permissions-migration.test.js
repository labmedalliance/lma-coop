// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// An existing database (before role "Lesen" and account permissions) keeps its shares and gains the new columns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(import.meta.dirname, '..');

test('migrates document_members to allow "viewer" and adds permission columns', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'gdk-migrate-'));
  try {
    const file = path.join(dataDir, 'docs.sqlite');
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        pw_hash TEXT NOT NULL, created_at INTEGER NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE documents (id TEXT PRIMARY KEY, title TEXT NOT NULL, owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER, ydoc BLOB);
      CREATE TABLE document_members (
        doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('editor', 'suggester')),
        PRIMARY KEY (doc_id, user_id));
      INSERT INTO users VALUES (1, 'anna', 'Anna', 'x', 0, 1), (2, 'ben', 'Ben', 'x', 0, 0);
      INSERT INTO documents VALUES ('d1', 'Paper', 1, 0, 0, NULL, NULL);
      INSERT INTO document_members VALUES ('d1', 2, 'suggester');
    `);
    old.close();

    execFileSync('node', ['--no-warnings', '--input-type=module', '-e', "await import('./server/db.js')"],
      { cwd: root, env: { ...process.env, DATA_DIR: dataDir } });
    // Runs twice: the second start must not migrate again.
    execFileSync('node', ['--no-warnings', '--input-type=module', '-e', "await import('./server/db.js')"],
      { cwd: root, env: { ...process.env, DATA_DIR: dataDir } });

    const db = new DatabaseSync(file);
    assert.deepEqual({ ...db.prepare('SELECT doc_id, user_id, role FROM document_members').get() },
      { doc_id: 'd1', user_id: 2, role: 'suggester' });
    db.prepare("UPDATE document_members SET role = 'viewer'").run();
    assert.throws(() => db.prepare("UPDATE document_members SET role = 'owner'").run(), /CHECK/);
    const ben = db.prepare('SELECT can_create, can_request, see_others FROM users WHERE id = 2').get();
    assert.deepEqual({ ...ben }, { can_create: 1, can_request: 1, see_others: 1 });
    db.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
