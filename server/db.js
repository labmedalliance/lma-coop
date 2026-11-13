// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// SQLite storage for users, sessions and documents (built-in node:sqlite).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const dataDir = process.env.DATA_DIR || path.resolve(import.meta.dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'docs.sqlite'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    pw_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    ydoc BLOB
  );
`);

// --- Migrations -----------------------------------------------------------

const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userColumns.includes('is_admin')) db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
// Per-account permissions set by admins: create documents, request more rights, see titles of other documents.
for (const column of ['can_create', 'can_request', 'see_others']) {
  if (!userColumns.includes(column)) db.exec(`ALTER TABLE users ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 1`);
}

// Document status. Documents from before this column count as work in progress; new ones start as "idea".
const docColumns = db.prepare('PRAGMA table_info(documents)').all().map((c) => c.name);
if (!docColumns.includes('status')) db.exec("ALTER TABLE documents ADD COLUMN status TEXT NOT NULL DEFAULT 'wip'");

db.exec(`
  CREATE TABLE IF NOT EXISTS document_members (
    doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('editor', 'suggester', 'viewer')),
    PRIMARY KEY (doc_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS access_requests (
    doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('editor', 'suggester')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (doc_id, user_id)
  );
`);

// Role "viewer" (read only): older databases have a CHECK without it, and SQLite cannot change a CHECK in place.
const membersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'document_members'").get().sql;
if (!membersSql.includes("'viewer'")) {
  db.exec(`
    BEGIN;
    CREATE TABLE document_members_new (
      doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('editor', 'suggester', 'viewer')),
      PRIMARY KEY (doc_id, user_id)
    );
    INSERT INTO document_members_new (doc_id, user_id, role) SELECT doc_id, user_id, role FROM document_members;
    DROP TABLE document_members;
    ALTER TABLE document_members_new RENAME TO document_members;
    COMMIT;
  `);
}

// There is always at least one admin: if none exists, the oldest account becomes admin.
if (!db.prepare('SELECT 1 FROM users WHERE is_admin = 1').get()) {
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = (SELECT MIN(id) FROM users)').run();
}

// Comment threads: the first comment of a thread has thread_id = id and carries the quoted text and
// the resolved state. The anchor in the text is a "comment" mark with the thread id (client/src/comment-mark.js).
db.exec(`
  CREATE TABLE IF NOT EXISTS comments (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    thread_id TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    quote TEXT,
    created_at INTEGER NOT NULL,
    edited_at INTEGER,
    resolved_at INTEGER,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS comments_doc ON comments(doc_id, thread_id);
`);

// Comments imported from Word keep the Word author's name when no account has that name (user_id is then NULL).
const commentColumns = db.prepare('PRAGMA table_info(comments)').all().map((c) => c.name);
if (!commentColumns.includes('author_name')) db.exec('ALTER TABLE comments ADD COLUMN author_name TEXT');

// Images in documents. The document stores only the URL /api/docs/<doc>/images/<id>; the bytes live here.
db.exec(`
  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS images_doc ON images(doc_id);
`);

// Tags: one shared list for all accounts. A tag exists as long as a document uses it (server/docs.js).
db.exec(`
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );
  CREATE TABLE IF NOT EXISTS document_tags (
    doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (doc_id, tag_id)
  );
  CREATE INDEX IF NOT EXISTS document_tags_tag ON document_tags(tag_id);
`);
