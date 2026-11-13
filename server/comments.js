// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Comment threads per document: create, reply, edit, resolve, delete (with undo).
//
// Everyone with access to the document may comment, reply and resolve, in both editing and
// suggestion mode. Editing a comment is only allowed for its author. Deleting is allowed for the
// author and for owners and editors. Deleting the first comment of a thread deletes the thread.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { db } from './db.js';
import { roleFor } from './docs.js';

const MAX_BODY = 5000;
const MAX_QUOTE = 500;
const MAX_IMPORT = 200; // threads per import request
const THREAD_ID = /^[A-Za-z0-9-]{8,40}$/;

const findComment = (docId, id) => db.prepare('SELECT * FROM comments WHERE id = ? AND doc_id = ?').get(id, docId);

/** All threads of the document that are not deleted, each with its comments in order. */
export function listThreads(docId) {
  const rows = db.prepare(`
    SELECT c.id, c.thread_id, c.user_id, COALESCE(u.name, c.author_name) AS author, c.body, c.quote, c.created_at, c.edited_at,
      c.resolved_at, r.name AS resolved_by
    FROM comments c
    LEFT JOIN users u ON u.id = c.user_id
    LEFT JOIN users r ON r.id = c.resolved_by
    WHERE c.doc_id = ? AND c.deleted_at IS NULL
    ORDER BY c.created_at, c.rowid`).all(docId);
  const threads = new Map();
  for (const row of rows) {
    const comment = {
      id: row.id, authorId: row.user_id, author: row.author, body: row.body,
      createdAt: row.created_at, editedAt: row.edited_at,
    };
    if (row.id === row.thread_id) {
      threads.set(row.id, {
        id: row.id, quote: row.quote, createdAt: row.created_at,
        resolvedAt: row.resolved_at, resolvedBy: row.resolved_by, comments: [comment],
      });
    } else {
      threads.get(row.thread_id)?.comments.push(comment); // replies of a deleted thread stay hidden
    }
  }
  return [...threads.values()];
}

const cleanBody = (value) => String(value ?? '').trim().slice(0, MAX_BODY);

/** Router for /api/docs/:id/comments. `onChange({ docId })` tells open editors to reload the comments. */
export function commentsRouter({ onChange = () => {} } = {}) {
  const router = Router({ mergeParams: true });

  router.use((req, res, next) => {
    req.role = roleFor(req.user.id, req.params.id);
    if (!req.role) return res.status(404).json({ error: 'Nicht gefunden' });
    // "Lesen" sees comments but does not write any.
    if (req.role === 'viewer' && req.method !== 'GET') return res.status(403).json({ error: 'Keine Berechtigung' });
    next();
  });

  const changed = (req, res, data = { ok: true }) => {
    onChange({ docId: req.params.id });
    res.json(data);
  };

  // Loads the comment (or thread root) from the URL; 404 if missing or deleted.
  const load = (req, res, next) => {
    const comment = findComment(req.params.id, req.params.commentId);
    if (!comment || comment.deleted_at) return res.status(404).json({ error: 'Kommentar nicht gefunden' });
    req.comment = comment;
    next();
  };

  const mayDelete = (req, comment) => comment.user_id === req.user.id || req.role !== 'suggester';

  router.get('/', (req, res) => res.json(listThreads(req.params.id)));

  // New thread. The client picks the id, because it also puts it into the text as anchor.
  router.post('/', (req, res) => {
    const id = String(req.body?.id || '');
    const body = cleanBody(req.body?.body);
    if (!THREAD_ID.test(id)) return res.status(400).json({ error: 'Ungültige Kommentar-ID' });
    if (!body) return res.status(400).json({ error: 'Kommentar ist leer' });
    if (db.prepare('SELECT 1 FROM comments WHERE id = ?').get(id)) return res.status(409).json({ error: 'Kommentar existiert bereits' });
    const quote = String(req.body?.quote ?? '').slice(0, MAX_QUOTE);
    db.prepare(`INSERT INTO comments (id, doc_id, thread_id, user_id, body, quote, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, req.params.id, id, req.user.id, body, quote, Date.now());
    res.status(201);
    changed(req, res, { id });
  });

  // Threads from a Word file (owner and "Bearbeiten"). Each comment keeps its Word author and date; an author
  // whose name matches an account is linked to it. Body: { threads: [{ id, quote, resolved, comments: [{ author, body, createdAt }] }] }.
  router.post('/import', (req, res) => {
    if (req.role === 'suggester') return res.status(403).json({ error: 'Keine Berechtigung' });
    const threads = Array.isArray(req.body?.threads) ? req.body.threads.slice(0, MAX_IMPORT) : [];
    const userByName = new Map(db.prepare('SELECT id, name FROM users').all().map((u) => [u.name.toLowerCase(), u.id]));
    const insert = db.prepare(`INSERT INTO comments (id, doc_id, thread_id, user_id, author_name, body, quote, created_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const exists = db.prepare('SELECT 1 FROM comments WHERE id = ?');
    let count = 0;
    db.exec('BEGIN');
    try {
      for (const thread of threads) {
        const id = String(thread?.id || '');
        const comments = (Array.isArray(thread?.comments) ? thread.comments : [])
          .map((c) => ({ ...c, body: cleanBody(c?.body) })).filter((c) => c.body);
        if (!THREAD_ID.test(id) || !comments.length || exists.get(id)) continue;
        const quote = String(thread.quote ?? '').slice(0, MAX_QUOTE);
        comments.forEach((c, i) => {
          const author = String(c.author ?? '').trim().slice(0, 200);
          const createdAt = Number.isFinite(c.createdAt) ? c.createdAt : Date.now();
          const resolvedAt = i === 0 && thread.resolved ? Date.now() : null;
          insert.run(i === 0 ? id : randomUUID(), req.params.id, id, userByName.get(author.toLowerCase()) ?? null,
            author || null, c.body, i === 0 ? quote : null, createdAt, resolvedAt);
        });
        count++;
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.status(201);
    changed(req, res, { count });
  });

  // Reply. Like Google Docs, a reply reopens a resolved thread.
  router.post('/:commentId/replies', load, (req, res) => {
    const body = cleanBody(req.body?.body);
    if (!body) return res.status(400).json({ error: 'Kommentar ist leer' });
    const threadId = req.comment.thread_id;
    const id = randomUUID();
    db.prepare(`INSERT INTO comments (id, doc_id, thread_id, user_id, body, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, req.params.id, threadId, req.user.id, body, Date.now());
    db.prepare('UPDATE comments SET resolved_at = NULL, resolved_by = NULL WHERE id = ?').run(threadId);
    res.status(201);
    changed(req, res, { id });
  });

  router.patch('/:commentId', load, (req, res) => {
    if (req.comment.user_id !== req.user.id) return res.status(403).json({ error: 'Nur eigene Kommentare lassen sich bearbeiten' });
    const body = cleanBody(req.body?.body);
    if (!body) return res.status(400).json({ error: 'Kommentar ist leer' });
    db.prepare('UPDATE comments SET body = ?, edited_at = ? WHERE id = ?').run(body, Date.now(), req.comment.id);
    changed(req, res);
  });

  // Resolve ({ resolved: true }) or reopen ({ resolved: false }) a thread.
  router.post('/:commentId/resolve', load, (req, res) => {
    const resolved = req.body?.resolved !== false;
    db.prepare('UPDATE comments SET resolved_at = ?, resolved_by = ? WHERE id = ?')
      .run(resolved ? Date.now() : null, resolved ? req.user.id : null, req.comment.thread_id);
    changed(req, res);
  });

  // Soft delete, so the client can offer "Rückgängig".
  router.delete('/:commentId', load, (req, res) => {
    if (!mayDelete(req, req.comment)) return res.status(403).json({ error: 'Keine Berechtigung' });
    db.prepare('UPDATE comments SET deleted_at = ? WHERE id = ?').run(Date.now(), req.comment.id);
    changed(req, res);
  });

  router.post('/:commentId/restore', (req, res) => {
    const comment = findComment(req.params.id, req.params.commentId);
    if (!comment?.deleted_at) return res.status(404).json({ error: 'Kommentar nicht gefunden' });
    if (!mayDelete(req, comment)) return res.status(403).json({ error: 'Keine Berechtigung' });
    db.prepare('UPDATE comments SET deleted_at = NULL WHERE id = ?').run(comment.id);
    changed(req, res);
  });

  return router;
}
