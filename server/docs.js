// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Documents, per-document roles and sharing.
//
// Roles: "owner" (everything incl. sharing and deleting), "editor" (edit directly, accept or reject
// suggestions, rename), "suggester" (only suggestions; may add but not remove references), "viewer"
// ("Lesen": read only; sees comments but writes none).
// Logged-in users can request access to a document, or more rights than they have; the owner approves or
// declines. Admins can switch off per account: creating documents, requesting rights, seeing titles of others.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { db } from './db.js';

export const ROLES = ['editor', 'suggester', 'viewer'];
const REQUEST_ROLES = ['editor', 'suggester'];
const RANK = { viewer: 1, suggester: 2, editor: 3, owner: 4 };
export const STATUSES = ['idea', 'wip', 'finished', 'archived'];
// Limits for tags; the error message in PUT /:id/tags names them.
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

const docExists = (docId) => !!db.prepare('SELECT 1 FROM documents WHERE id = ? AND deleted_at IS NULL').get(docId);
const pendingRequest = (docId, userId) => db.prepare('SELECT role, created_at FROM access_requests WHERE doc_id = ? AND user_id = ?')
  .get(docId, userId) ?? null;

/** Tag names per document id, sorted by name. */
function tagsByDoc() {
  const map = new Map();
  const rows = db.prepare(`SELECT dt.doc_id, t.name FROM document_tags dt JOIN tags t ON t.id = dt.tag_id
    ORDER BY t.name COLLATE NOCASE`).all();
  for (const { doc_id: docId, name } of rows) {
    if (!map.has(docId)) map.set(docId, []);
    map.get(docId).push(name);
  }
  return map;
}
const tagsOf = (docId) => db.prepare(`SELECT t.name FROM document_tags dt JOIN tags t ON t.id = dt.tag_id
  WHERE dt.doc_id = ? ORDER BY t.name COLLATE NOCASE`).all(docId).map((r) => r.name);
const withTags = (rows) => {
  const tags = tagsByDoc();
  return rows.map((row) => ({ ...row, tags: tags.get(row.id) ?? [] }));
};

/**
 * Cleans a list of tag names: trims, collapses whitespace, drops empty and duplicate names (case-insensitive).
 * Returns null if the input is not a list or breaks a limit.
 */
export function cleanTags(input) {
  if (!Array.isArray(input)) return null;
  const seen = new Set();
  const names = [];
  for (const raw of input) {
    if (typeof raw !== 'string') return null;
    const name = raw.replace(/\s+/g, ' ').trim();
    if (!name) continue;
    if (name.length > MAX_TAG_LENGTH) return null;
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return names.length > MAX_TAGS ? null : names;
}

/** Replaces the tags of a document. New names create tags; tags no document uses any more disappear. */
function setTags(docId, names) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM document_tags WHERE doc_id = ?').run(docId);
    const insertTag = db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
    const tagId = db.prepare('SELECT id FROM tags WHERE name = ?');
    const link = db.prepare('INSERT OR IGNORE INTO document_tags (doc_id, tag_id) VALUES (?, ?)');
    for (const name of names) {
      insertTag.run(name);
      link.run(docId, tagId.get(name).id);
    }
    db.exec('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM document_tags)');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return tagsOf(docId);
}

/** Role of the user in the document, or null without access (also for deleted documents). */
export function roleFor(userId, docId) {
  const doc = db.prepare('SELECT owner_id FROM documents WHERE id = ? AND deleted_at IS NULL').get(docId);
  if (!doc) return null;
  if (doc.owner_id === userId) return 'owner';
  return db.prepare('SELECT role FROM document_members WHERE doc_id = ? AND user_id = ?').get(docId, userId)?.role ?? null;
}

/**
 * Router for /api/docs. `onAccessChange({ docId, userId })` is called when rights change, so open
 * collaboration connections can be closed and re-authenticated. `onRequestsChange({ docId })` is called
 * when access requests change, so an open document can update its request badge.
 */
export function docsRouter({ onAccessChange, onRequestsChange = () => {} }) {
  const router = Router();

  // Loads the role and rejects with 404 if the user has no access (or 403 below the required role).
  const access = (...allowed) => (req, res, next) => {
    const role = roleFor(req.user.id, req.params.id);
    if (!role) return res.status(404).json({ error: 'Nicht gefunden' });
    if (allowed.length && !allowed.includes(role)) return res.status(403).json({ error: 'Keine Berechtigung' });
    req.role = role;
    next();
  };

  router.get('/', (req, res) => {
    const rows = db.prepare(`
      SELECT d.id, d.title, d.status, d.updated_at, u.name AS owner,
        CASE WHEN d.owner_id = ? THEN 'owner' ELSE m.role END AS role,
        CASE WHEN d.owner_id = ? THEN (SELECT COUNT(*) FROM access_requests r WHERE r.doc_id = d.id) ELSE 0 END AS requests
      FROM documents d
      LEFT JOIN users u ON u.id = d.owner_id
      LEFT JOIN document_members m ON m.doc_id = d.id AND m.user_id = ?
      WHERE d.deleted_at IS NULL AND (d.owner_id = ? OR m.user_id IS NOT NULL)
      ORDER BY d.updated_at DESC`).all(req.user.id, req.user.id, req.user.id, req.user.id);
    res.json(withTags(rows));
  });

  // Documents of others without access: titles are visible to every account, contents only after sharing.
  router.get('/discover', (req, res) => {
    if (!req.user.seeOthers) return res.json([]);
    res.json(withTags(db.prepare(`
      SELECT d.id, d.title, d.status, d.updated_at, u.name AS owner, r.role AS requested
      FROM documents d
      LEFT JOIN users u ON u.id = d.owner_id
      LEFT JOIN document_members m ON m.doc_id = d.id AND m.user_id = ?
      LEFT JOIN access_requests r ON r.doc_id = d.id AND r.user_id = ?
      WHERE d.deleted_at IS NULL AND (d.owner_id IS NULL OR d.owner_id != ?) AND m.user_id IS NULL
      ORDER BY d.updated_at DESC`).all(req.user.id, req.user.id, req.user.id)));
  });

  // Tag names for suggestions: only tags of documents whose titles the user may see.
  router.get('/tags', (req, res) => {
    res.json(db.prepare(`
      SELECT DISTINCT t.name FROM tags t
      JOIN document_tags dt ON dt.tag_id = t.id
      JOIN documents d ON d.id = dt.doc_id AND d.deleted_at IS NULL
      LEFT JOIN document_members m ON m.doc_id = d.id AND m.user_id = ?
      WHERE ? OR d.owner_id = ? OR m.user_id IS NOT NULL
      ORDER BY t.name COLLATE NOCASE`).all(req.user.id, req.user.seeOthers ? 1 : 0, req.user.id).map((r) => r.name));
  });

  router.post('/', (req, res) => {
    if (!req.user.canCreate) return res.status(403).json({ error: 'Du darfst keine neuen Dokumente anlegen' });
    const id = randomUUID();
    const now = Date.now();
    const title = String(req.body?.title || 'Unbenanntes Dokument').slice(0, 200);
    db.prepare("INSERT INTO documents (id, title, status, owner_id, created_at, updated_at) VALUES (?, ?, 'idea', ?, ?, ?)")
      .run(id, title, req.user.id, now, now);
    res.status(201).json({ id, title, status: 'idea', tags: [] });
  });

  router.get('/:id', access(), (req, res) => {
    const row = db.prepare('SELECT id, title, status FROM documents WHERE id = ?').get(req.params.id);
    res.json({ ...row, tags: tagsOf(row.id), role: req.role });
  });

  // Replaces all tags of the document: { tags: ["Review", "Präanalytik"] }. Returns the stored names.
  router.put('/:id/tags', access('owner', 'editor'), (req, res) => {
    const names = cleanTags(req.body?.tags);
    if (!names) {
      return res.status(400).json({ error: 'Höchstens 20 Tags mit je höchstens 40 Zeichen' });
    }
    res.json({ tags: setTags(req.params.id, names) });
  });

  // Title and/or status; either field may be left out.
  router.patch('/:id', access('owner', 'editor'), (req, res) => {
    const body = req.body || {};
    if (body.title === undefined && body.status === undefined) return res.status(400).json({ error: 'Titel fehlt' });
    const title = body.title === undefined ? null : String(body.title).trim().slice(0, 200);
    if (title === '') return res.status(400).json({ error: 'Titel fehlt' });
    if (body.status !== undefined && !STATUSES.includes(body.status)) {
      return res.status(400).json({ error: 'Unbekannter Status' });
    }
    db.prepare('UPDATE documents SET title = COALESCE(?, title), status = COALESCE(?, status) WHERE id = ?')
      .run(title, body.status ?? null, req.params.id);
    res.json({ ok: true });
  });

  // Soft delete, so the list can offer "Rückgängig".
  router.delete('/:id', access('owner'), (req, res) => {
    db.prepare('UPDATE documents SET deleted_at = ? WHERE id = ?').run(Date.now(), req.params.id);
    onAccessChange({ docId: req.params.id });
    res.json({ ok: true });
  });

  // roleFor() ignores deleted documents, so restore checks ownership directly.
  router.post('/:id/restore', (req, res) => {
    const r = db.prepare('UPDATE documents SET deleted_at = NULL WHERE id = ? AND owner_id = ?').run(req.params.id, req.user.id);
    return r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Nicht gefunden' });
  });

  // Everyone with access sees who else has access (needed to show suggestion authors).
  router.get('/:id/members', access(), (req, res) => {
    const owner = db.prepare(`SELECT u.id, u.username, u.name FROM documents d JOIN users u ON u.id = d.owner_id
      WHERE d.id = ?`).get(req.params.id);
    const members = db.prepare(`SELECT u.id, u.username, u.name, m.role FROM document_members m
      JOIN users u ON u.id = m.user_id WHERE m.doc_id = ? ORDER BY u.name`).all(req.params.id);
    res.json({ owner, members, canManage: req.role === 'owner' });
  });

  router.put('/:id/members/:userId', access('owner'), (req, res) => {
    const userId = Number(req.params.userId);
    const role = req.body?.role;
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Unbekannte Rolle' });
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    if (userId === req.user.id) return res.status(400).json({ error: 'Du bist bereits Eigentümer:in' });
    db.prepare(`INSERT INTO document_members (doc_id, user_id, role) VALUES (?, ?, ?)
      ON CONFLICT(doc_id, user_id) DO UPDATE SET role = excluded.role`).run(req.params.id, userId, role);
    // Setting a role answers an open request of that person.
    const answered = db.prepare('DELETE FROM access_requests WHERE doc_id = ? AND user_id = ?').run(req.params.id, userId).changes;
    onAccessChange({ docId: req.params.id, userId });
    if (answered) onRequestsChange({ docId: req.params.id });
    res.json({ ok: true });
  });

  router.delete('/:id/members/:userId', access('owner'), (req, res) => {
    db.prepare('DELETE FROM document_members WHERE doc_id = ? AND user_id = ?').run(req.params.id, Number(req.params.userId));
    onAccessChange({ docId: req.params.id, userId: Number(req.params.userId) });
    res.json({ ok: true });
  });

  // --- Access requests ------------------------------------------------------

  // Own request: title, owner, current role (or null), the pending request and whether requesting is allowed.
  // Without access and without "see others", the document stays hidden.
  router.get('/:id/request', (req, res) => {
    const doc = db.prepare(`SELECT d.title, u.name AS owner FROM documents d LEFT JOIN users u ON u.id = d.owner_id
      WHERE d.id = ? AND d.deleted_at IS NULL`).get(req.params.id);
    const role = doc ? roleFor(req.user.id, req.params.id) : null;
    if (!doc || (!role && !req.user.seeOthers)) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ ...doc, role, pending: pendingRequest(req.params.id, req.user.id), canRequest: req.user.canRequest });
  });

  router.put('/:id/request', (req, res) => {
    const role = req.body?.role;
    if (!REQUEST_ROLES.includes(role)) return res.status(400).json({ error: 'Unbekannte Rolle' });
    if (!docExists(req.params.id)) return res.status(404).json({ error: 'Nicht gefunden' });
    const current = roleFor(req.user.id, req.params.id);
    if (!current && !req.user.seeOthers) return res.status(404).json({ error: 'Nicht gefunden' });
    if (!req.user.canRequest) return res.status(403).json({ error: 'Du darfst keine Rechte beantragen' });
    if (current && RANK[current] >= RANK[role]) return res.status(400).json({ error: 'Diese Rechte hast du bereits' });
    db.prepare(`INSERT INTO access_requests (doc_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(doc_id, user_id) DO UPDATE SET role = excluded.role`).run(req.params.id, req.user.id, role, Date.now());
    onRequestsChange({ docId: req.params.id });
    res.json({ ok: true, pending: pendingRequest(req.params.id, req.user.id) });
  });

  router.delete('/:id/request', (req, res) => {
    db.prepare('DELETE FROM access_requests WHERE doc_id = ? AND user_id = ?').run(req.params.id, req.user.id);
    onRequestsChange({ docId: req.params.id });
    res.json({ ok: true });
  });

  // Owner: open requests with the current role of each person.
  router.get('/:id/requests', access('owner'), (req, res) => {
    res.json(db.prepare(`SELECT u.id, u.username, u.name, r.role, r.created_at, m.role AS current
      FROM access_requests r JOIN users u ON u.id = r.user_id
      LEFT JOIN document_members m ON m.doc_id = r.doc_id AND m.user_id = r.user_id
      WHERE r.doc_id = ? ORDER BY r.created_at`).all(req.params.id));
  });

  // Owner declines a request. Approving uses PUT /members/:userId, which also clears the request.
  router.delete('/:id/requests/:userId', access('owner'), (req, res) => {
    const r = db.prepare('DELETE FROM access_requests WHERE doc_id = ? AND user_id = ?').run(req.params.id, Number(req.params.userId));
    if (r.changes) onRequestsChange({ docId: req.params.id });
    res.json({ ok: true });
  });

  // Owner restores a request (undo after approving or declining).
  router.put('/:id/requests/:userId', access('owner'), (req, res) => {
    const userId = Number(req.params.userId);
    const { role, created_at: createdAt } = req.body || {};
    if (!REQUEST_ROLES.includes(role)) return res.status(400).json({ error: 'Unbekannte Rolle' });
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId) || userId === req.user.id) {
      return res.status(400).json({ error: 'Ungültige Person' });
    }
    db.prepare(`INSERT INTO access_requests (doc_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(doc_id, user_id) DO UPDATE SET role = excluded.role`)
      .run(req.params.id, userId, role, Number(createdAt) || Date.now());
    onRequestsChange({ docId: req.params.id });
    res.json({ ok: true });
  });

  return router;
}
