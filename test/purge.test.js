// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Deleted documents and files are removed for good after 30 days, together with versions, comments and images.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'gdk-purge-'));
const { db } = await import('../server/db.js');
const { purgeDeleted, PURGE_AFTER_DAYS } = await import('../server/docs.js');

test('purgeDeleted removes documents and files deleted longer than 30 days ago', () => {
  const now = Date.now();
  const old = now - (PURGE_AFTER_DAYS + 1) * 86400_000;
  const recent = now - 86400_000;
  const insert = db.prepare(`INSERT INTO documents (id, title, kind, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  insert.run('old-file', 'a', 'file', old, old, old);
  insert.run('recent-file', 'b', 'file', now, now, recent);
  insert.run('old-doc', 'c', 'doc', old, old, old);
  insert.run('live-doc', 'd', 'doc', old, old, null);
  db.prepare(`INSERT INTO comments (id, doc_id, thread_id, body, created_at) VALUES ('c1', 'old-doc', 'c1', 'x', ?)`).run(old);
  db.prepare(`INSERT INTO file_versions (doc_id, version, name, size, sha256, data, created_at)
    VALUES ('old-file', 1, 'a.xlsx', 1, 'x', x'00', ?)`).run(old);

  assert.equal(purgeDeleted(now), 2);
  const ids = db.prepare('SELECT id FROM documents ORDER BY id').all().map((r) => r.id);
  assert.deepEqual(ids, ['live-doc', 'recent-file']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM file_versions WHERE doc_id = 'old-file'").get().n, 0);
});
