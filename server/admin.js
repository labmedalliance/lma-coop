// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// User and role administration (admins only).
import { Router } from 'express';
import { db } from './db.js';
import { hashPassword, deleteUserSessions, MIN_PASSWORD_LENGTH, USERNAME_RE } from './auth.js';

const listUsers = () => db.prepare(`
  SELECT u.id, u.username, u.name, u.is_admin = 1 AS isAdmin, u.created_at,
    (SELECT COUNT(*) FROM documents d WHERE d.owner_id = u.id AND d.deleted_at IS NULL) AS ownedDocs
  FROM users u ORDER BY u.name`).all().map((u) => ({ ...u, isAdmin: !!u.isAdmin }));

const checkPassword = (pw) => typeof pw === 'string' && pw.length >= MIN_PASSWORD_LENGTH;

/** Router for /api/admin. `onUsersChanged({ userId })` closes that user's open connections. */
export function adminRouter({ onUsersChanged }) {
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

  return router;
}
