// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Documents, per-document roles and sharing.
//
// Roles: "owner" (everything incl. sharing and deleting), "editor" (edit directly, accept or reject
// suggestions, rename), "suggester" (only suggestions; may add but not remove references).
// Logged-in users can request access to a document, or "editor" instead of "suggester"; the owner
// approves or declines.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { db } from './db.js';

export const ROLES = ['editor', 'suggester'];
const RANK = { suggester: 1, editor: 2, owner: 3 };
export const STATUSES = ['idea', 'wip', 'finished', 'archived'];

const docExists = (docId) => !!db.prepare('SELECT 1 FROM documents WHERE id = ? AND deleted_at IS NULL').get(docId);
const pendingRequest = (docId, userId) => db.prepare('SELECT role, created_at FROM access_requests WHERE doc_id = ? AND user_id = ?')
  .get(docId, userId) ?? null;

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
    res.json(rows);
  });

  // Documents of others without access: titles are visible to every account, contents only after sharing.
  router.get('/discover', (req, res) => {
    res.json(db.prepare(`
      SELECT d.id, d.title, d.status, d.updated_at, u.name AS owner, r.role AS requested
      FROM documents d
      LEFT JOIN users u ON u.id = d.owner_id
      LEFT JOIN document_members m ON m.doc_id = d.id AND m.user_id = ?
      LEFT JOIN access_requests r ON r.doc_id = d.id AND r.user_id = ?
      WHERE d.deleted_at IS NULL AND (d.owner_id IS NULL OR d.owner_id != ?) AND m.user_id IS NULL
      ORDER BY d.updated_at DESC`).all(req.user.id, req.user.id, req.user.id));
  });

  router.post('/', (req, res) => {
    const id = randomUUID();
    const now = Date.now();
    const title = String(req.body?.title || 'Unbenanntes Dokument').slice(0, 200);
    db.prepare("INSERT INTO documents (id, title, status, owner_id, created_at, updated_at) VALUES (?, ?, 'idea', ?, ?, ?)")
      .run(id, title, req.user.id, now, now);
    res.status(201).json({ id, title, status: 'idea' });
  });

  router.get('/:id', access(), (req, res) => {
    const row = db.prepare('SELECT id, title, status FROM documents WHERE id = ?').get(req.params.id);
    res.json({ ...row, role: req.role });
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

  // Own request: title, owner, current role (or null) and the pending request.
  router.get('/:id/request', (req, res) => {
    const doc = db.prepare(`SELECT d.title, u.name AS owner FROM documents d LEFT JOIN users u ON u.id = d.owner_id
      WHERE d.id = ? AND d.deleted_at IS NULL`).get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json({ ...doc, role: roleFor(req.user.id, req.params.id), pending: pendingRequest(req.params.id, req.user.id) });
  });

  router.put('/:id/request', (req, res) => {
    const role = req.body?.role;
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Unbekannte Rolle' });
    if (!docExists(req.params.id)) return res.status(404).json({ error: 'Nicht gefunden' });
    const current = roleFor(req.user.id, req.params.id);
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
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Unbekannte Rolle' });
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
