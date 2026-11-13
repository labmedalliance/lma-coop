// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Administration (admins only): accounts, account permissions, document access per person and the tag list.
import { Router } from 'express';
import { db } from './db.js';
import { hashPassword, deleteUserSessions, MIN_PASSWORD_LENGTH, USERNAME_RE } from './auth.js';
import { ROLES, allTags, cleanTagName } from './docs.js';

// Account permissions: request field → column.
const PERMISSIONS = { canCreate: 'can_create', canRequest: 'can_request', seeOthers: 'see_others' };

const listUsers = () => db.prepare(`
  SELECT u.id, u.username, u.name, u.is_admin AS isAdmin, u.created_at,
    u.can_create AS canCreate, u.can_request AS canRequest, u.see_others AS seeOthers,
    (SELECT COUNT(*) FROM documents d WHERE d.owner_id = u.id AND d.deleted_at IS NULL) AS ownedDocs,
    (SELECT COUNT(*) FROM document_members m JOIN documents d ON d.id = m.doc_id
      WHERE m.user_id = u.id AND d.deleted_at IS NULL) AS sharedDocs
  FROM users u ORDER BY u.name`).all()
  .map((u) => ({ ...u, isAdmin: !!u.isAdmin, canCreate: !!u.canCreate, canRequest: !!u.canRequest, seeOthers: !!u.seeOthers }));

const checkPassword = (pw) => typeof pw === 'string' && pw.length >= MIN_PASSWORD_LENGTH;

/**
 * Router for /api/admin. `onUsersChanged({ docId, userId })` closes that user's open connections (in one document
 * or in all). `onRequestsChange({ docId })` tells the owner's open document that its requests changed.
 */
export function adminRouter({ onUsersChanged, onRequestsChange = () => {} }) {
  const router = Router();

  router.use((req, res, next) => (req.user.isAdmin ? next() : res.status(403).json({ error: 'Nur für Admins' })));

  router.get('/users', (req, res) => res.json(listUsers()));

  router.post('/users', (req, res) => {
    const username = String(req.body?.username || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim().slice(0, 100) || username;
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Benutzername: 2–40 Zeichen, nur Buchstaben, Ziffern, Punkt, Binde- und Unterstrich' });
    }
    if (!checkPassword(req.body?.password)) {
      return res.status(400).json({ error: `Passwort: mindestens ${MIN_PASSWORD_LENGTH} Zeichen` });
    }
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      return res.status(409).json({ error: 'Benutzername ist vergeben' });
    }
    db.prepare('INSERT INTO users (username, name, pw_hash, created_at, is_admin) VALUES (?, ?, ?, ?, ?)')
      .run(username, name, hashPassword(req.body.password), Date.now(), req.body?.isAdmin ? 1 : 0);
    res.status(201).json({ ok: true });
  });

  router.patch('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) return res.status(404).json({ error: 'Nicht gefunden' });
    const { name, password, isAdmin } = req.body || {};
    for (const [field, column] of Object.entries(PERMISSIONS)) {
      if (typeof req.body?.[field] === 'boolean') db.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).run(req.body[field] ? 1 : 0, id);
    }
    if (isAdmin === false && id === req.user.id) {
      return res.status(400).json({ error: 'Du kannst dir die Admin-Rolle nicht selbst entziehen' });
    }
    if (password !== undefined && !checkPassword(password)) {
      return res.status(400).json({ error: `Passwort: mindestens ${MIN_PASSWORD_LENGTH} Zeichen` });
    }
    if (typeof name === 'string' && name.trim()) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim().slice(0, 100), id);
    if (typeof isAdmin === 'boolean') db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, id);
    if (password !== undefined) {
      db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(hashPassword(password), id);
      if (id !== req.user.id) deleteUserSessions(id);
    }
    res.json({ ok: true });
  });

  // Every document with this person's role in it (null without access). Titles are no secret to admins: the
  // document list shows them to every account. Contents stay closed: admins only set who may open what.
  router.get('/users/:id/docs', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(db.prepare(`
      SELECT d.id, d.title, d.status, u.name AS owner,
        CASE WHEN d.owner_id = ? THEN 'owner' ELSE m.role END AS role
      FROM documents d
      LEFT JOIN users u ON u.id = d.owner_id
      LEFT JOIN document_members m ON m.doc_id = d.id AND m.user_id = ?
      WHERE d.deleted_at IS NULL
      ORDER BY d.title COLLATE NOCASE`).all(id, id));
  });

  // Sets the person's role in a document (Lesen / Vorschlagen / Bearbeiten), or removes access with role null.
  // Not for yourself, so admins cannot open documents of others this way.
  router.put('/users/:id/docs/:docId', (req, res) => {
    const id = Number(req.params.id);
    const { docId } = req.params;
    const role = req.body?.role ?? null;
    if (role !== null && !ROLES.includes(role)) return res.status(400).json({ error: 'Unbekannte Rolle' });
    if (id === req.user.id) return res.status(400).json({ error: 'Deine eigenen Zugriffe vergibt die Eigentümer:in' });
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) return res.status(404).json({ error: 'Nicht gefunden' });
    const doc = db.prepare('SELECT owner_id FROM documents WHERE id = ? AND deleted_at IS NULL').get(docId);
    if (!doc) return res.status(404).json({ error: 'Nicht gefunden' });
    if (doc.owner_id === id) return res.status(400).json({ error: 'Die Eigentümer:in hat immer vollen Zugriff' });
    if (role) {
      db.prepare(`INSERT INTO document_members (doc_id, user_id, role) VALUES (?, ?, ?)
        ON CONFLICT(doc_id, user_id) DO UPDATE SET role = excluded.role`).run(docId, id, role);
    } else {
      db.prepare('DELETE FROM document_members WHERE doc_id = ? AND user_id = ?').run(docId, id);
    }
    // Like the owner's sharing dialog: setting a role answers an open request of that person.
    if (db.prepare('DELETE FROM access_requests WHERE doc_id = ? AND user_id = ?').run(docId, id).changes) onRequestsChange({ docId });
    onUsersChanged({ docId, userId: id });
    res.json({ ok: true });
  });

  // Documents of the deleted user move to the admin who deletes, so nothing becomes unreachable.
  router.delete('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'Du kannst dich nicht selbst löschen' });
    const moved = db.prepare('UPDATE documents SET owner_id = ? WHERE owner_id = ?').run(req.user.id, id).changes;
    db.prepare('DELETE FROM document_members WHERE user_id = ? AND doc_id IN (SELECT id FROM documents WHERE owner_id = ?)')
      .run(req.user.id, req.user.id);
    const r = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (!r.changes) return res.status(404).json({ error: 'Nicht gefunden' });
    onUsersChanged({ userId: id });
    res.json({ ok: true, movedDocs: moved });
  });

  // --- Tags -------------------------------------------------------------------

  const TAG_NAME_ERROR = 'Tag: 1–40 Zeichen';
  const TAG_EXISTS = 'Diesen Tag gibt es schon';
  const tagNameTaken = (name, exceptId = 0) => !!db.prepare('SELECT 1 FROM tags WHERE name = ? AND id != ?').get(name, exceptId);

  router.get('/tags', (req, res) => res.json(allTags()));

  router.post('/tags', (req, res) => {
    const name = cleanTagName(req.body?.name);
    if (!name) return res.status(400).json({ error: TAG_NAME_ERROR });
    if (tagNameTaken(name)) return res.status(409).json({ error: TAG_EXISTS });
    const { lastInsertRowid } = db.prepare('INSERT INTO tags (name) VALUES (?)').run(name);
    res.status(201).json({ id: Number(lastInsertRowid), name, docs: 0 });
  });

  // Renaming changes the tag on every document that carries it.
  router.patch('/tags/:id', (req, res) => {
    const id = Number(req.params.id);
    const name = cleanTagName(req.body?.name);
    if (!name) return res.status(400).json({ error: TAG_NAME_ERROR });
    if (tagNameTaken(name, id)) return res.status(409).json({ error: TAG_EXISTS });
    const r = db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, id);
    return r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Nicht gefunden' });
  });

  // Deleting removes the tag from all documents (ON DELETE CASCADE).
  router.delete('/tags/:id', (req, res) => {
    const r = db.prepare('DELETE FROM tags WHERE id = ?').run(Number(req.params.id));
    return r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Nicht gefunden' });
  });

  return router;
}
