// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Files with versions (Excel, PowerPoint, PDF …): download, check out, upload the changed file.
//
// Rules against a version mess:
// 1. Changing needs a checkout ("Zum Bearbeiten herunterladen"). While a file is checked out, only that person
//    may upload; everyone else may still download. The owner can cancel someone else's checkout.
// 2. An upload is accepted only if the checkout was taken on the current version (nobody uploaded in between).
// 3. The server compares the SHA-256 of every upload with all earlier versions and refuses an identical file,
//    e.g. an old download uploaded again by mistake.
// 4. The file extension must stay the same (no .xlsx replaced by a .docx).
// Every version is kept. "Wiederherstellen" makes an old version the newest one; nothing is overwritten.
//
// Roles: owner and "Bearbeiten" check out, upload and restore; "Vorschlagen" and "Lesen" only download.
// The owner can delete old versions (not the current one), e.g. a version with personal data by mistake.
//
// Limits against filling the disk: 25 MB per file, a storage quota per person (FILE_QUOTA_MB, default 500 MB,
// counted over the versions they uploaded) and at most 30 uploads per person and hour. Deleted files are removed
// for good 30 days after deletion (purgeDeletedFiles, run at start and daily).
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import express, { Router } from 'express';
import { db } from './db.js';
import { roleFor } from './docs.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const QUOTA_BYTES = Number(process.env.FILE_QUOTA_MB || 500) * 1024 * 1024;
const UPLOADS_PER_HOUR = 30;
// At most this many file uploads and downloads at the same time: each holds up to 25 MB (or more) in memory.
const MAX_TRANSFERS = Number(process.env.FILE_MAX_TRANSFERS || 3);
export const PURGE_AFTER_DAYS = 30;
const MAX_NOTE = 500;
const CHANGE_ROLES = ['owner', 'editor'];

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** Lower-case extension without the dot ("xlsx"), or "" if the name has none. */
export const extensionOf = (name) => path.extname(String(name || '')).slice(1).toLowerCase();

/** File name from the X-File-Name header (URI-encoded), without directories and control characters. */
export function cleanFileName(header) {
  let name = '';
  try { name = decodeURIComponent(String(header || '')); } catch { name = ''; }
  // eslint-disable-next-line no-control-regex
  name = name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return name.slice(0, 200);
}

function noteFrom(header) {
  try { return decodeURIComponent(String(header || '')).trim().slice(0, MAX_NOTE) || null; } catch { return null; }
}

const current = (docId) => db.prepare(`SELECT version, name, sha256 FROM file_versions WHERE doc_id = ?
  ORDER BY version DESC LIMIT 1`).get(docId);

/** Runs fn inside a transaction. */
function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Stores a new version and ends the checkout. Call inside transaction(). */
function insertVersion({ docId, version, name, data, userId, note = null, restoredFrom = null }) {
  const now = Date.now();
  db.prepare(`INSERT INTO file_versions (doc_id, version, name, size, sha256, user_id, note, restored_from, data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(docId, version, name, data.length, sha256(data), userId, note, restoredFrom, data, now);
  db.prepare(`UPDATE documents SET updated_at = ?, checkout_user = NULL, checkout_version = NULL, checkout_at = NULL
    WHERE id = ?`).run(now, docId);
}

// Running uploads and downloads. A slot is released when the response is finished or the connection closes.
let transfers = 0;
function transferSlot(req, res, next) {
  if (transfers >= MAX_TRANSFERS) {
    res.set('Retry-After', '10');
    return res.status(503).json({ error: 'Gerade laufen viele Übertragungen. Bitte gleich noch einmal versuchen.' });
  }
  transfers += 1;
  let released = false;
  const release = () => { if (!released) { released = true; transfers -= 1; } };
  res.on('finish', release);
  res.on('close', release);
  next();
}

/** A Buffer view on a BLOB from node:sqlite (Uint8Array) without copying 25 MB. */
const asBuffer = (blob) => Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);

const usedBytes = (userId) => db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM file_versions WHERE user_id = ?')
  .get(userId).n;

// Uploads per person within the last hour (in memory; a restart resets it).
const recentUploads = new Map();
function uploadAllowed(userId) {
  const since = Date.now() - 3600_000;
  const times = (recentUploads.get(userId) || []).filter((time) => time > since);
  recentUploads.set(userId, times);
  return times.length < UPLOADS_PER_HOUR;
}
const countUpload = (userId) => recentUploads.get(userId)?.push(Date.now()) ?? recentUploads.set(userId, [Date.now()]);

/**
 * Checks before the body is read: upload rate and quota (with the announced Content-Length).
 * Stops early, so refused uploads do not cost 25 MB of memory.
 */
function uploadLimits(req, res, next) {
  if (!uploadAllowed(req.user.id)) {
    return res.status(429).json({ error: 'Zu viele Uploads. Bitte in einer Stunde erneut versuchen.' });
  }
  const announced = Number(req.get('Content-Length')) || 0;
  if (usedBytes(req.user.id) + announced > QUOTA_BYTES) {
    return res.status(413).json({ error: 'Dein Speicherplatz für Dateien ist voll', code: 'quota', quotaMb: QUOTA_BYTES / 1024 / 1024 });
  }
  next();
}

/**
 * Removes deleted files for good once they have been deleted for PURGE_AFTER_DAYS (versions go with them via
 * ON DELETE CASCADE), then gives the space back. Returns the number of removed files.
 */
export function purgeDeletedFiles(now = Date.now()) {
  const before = now - PURGE_AFTER_DAYS * 86400_000;
  const removed = db.prepare("DELETE FROM documents WHERE kind = 'file' AND deleted_at IS NOT NULL AND deleted_at < ?")
    .run(before).changes;
  if (removed) db.exec('VACUUM');
  return removed;
}

/** State of a file for the file page: versions (without bytes) and the checkout. */
export function fileState(docId) {
  const versions = db.prepare(`SELECT v.version, v.name, v.size, v.note, v.restored_from, v.created_at, u.name AS user
    FROM file_versions v LEFT JOIN users u ON u.id = v.user_id WHERE v.doc_id = ? ORDER BY v.version DESC`).all(docId);
  const row = db.prepare(`SELECT d.checkout_user, d.checkout_version, d.checkout_at, u.name FROM documents d
    LEFT JOIN users u ON u.id = d.checkout_user WHERE d.id = ?`).get(docId);
  const checkout = row?.checkout_user
    ? { userId: row.checkout_user, name: row.name, version: row.checkout_version, at: row.checkout_at }
    : null;
  return { versions, checkout };
}

/** RFC 6266 Content-Disposition with an ASCII fallback and the UTF-8 name. */
function attachment(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Download name: document title plus version, e.g. "Budget 2027_v3.xlsx". */
function downloadName(title, version, ext) {
  const base = String(title || 'Datei').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'Datei';
  return `${base}_v${version}${ext ? `.${ext}` : ''}`;
}

const raw = express.raw({ type: () => true, limit: MAX_FILE_BYTES });
const bodyOf = (req) => (Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));

/** POST /api/files: new file document from an upload (version 1). */
export function newFileRoute() {
  const mayCreate = (req, res, next) => (req.user.canCreate
    ? next() : res.status(403).json({ error: 'Du darfst keine neuen Dokumente anlegen' }));
  return [mayCreate, uploadLimits, transferSlot, raw, (req, res) => {
    const data = bodyOf(req);
    const name = cleanFileName(req.get('X-File-Name'));
    if (!data.length) return res.status(400).json({ error: 'Die Datei ist leer' });
    if (!name) return res.status(400).json({ error: 'Dateiname fehlt' });
    if (usedBytes(req.user.id) + data.length > QUOTA_BYTES) {
      return res.status(413).json({ error: 'Dein Speicherplatz für Dateien ist voll', code: 'quota', quotaMb: QUOTA_BYTES / 1024 / 1024 });
    }
    const id = randomUUID();
    const now = Date.now();
    const title = name.replace(/\.[^.]+$/, '') || name;
    transaction(() => {
      db.prepare(`INSERT INTO documents (id, title, status, kind, owner_id, created_at, updated_at)
        VALUES (?, ?, 'wip', 'file', ?, ?, ?)`).run(id, title, req.user.id, now, now);
      insertVersion({ docId: id, version: 1, name, data, userId: req.user.id, note: noteFrom(req.get('X-Note')) });
    });
    countUpload(req.user.id);
    res.status(201).json({ id, title });
  }];
}

/** Router for /api/docs/:id/file. */
export function filesRouter() {
  const router = Router({ mergeParams: true });

  router.use((req, res, next) => {
    req.role = roleFor(req.user.id, req.params.id);
    const doc = req.role && db.prepare('SELECT kind, title FROM documents WHERE id = ?').get(req.params.id);
    if (!doc || doc.kind !== 'file') return res.status(404).json({ error: 'Nicht gefunden' });
    req.doc = doc;
    next();
  });
  const mayChange = (req, res, next) => (CHANGE_ROLES.includes(req.role)
    ? next() : res.status(403).json({ error: 'Keine Berechtigung' }));

  router.get('/', (req, res) => res.json(fileState(req.params.id)));

  // Download of one version; "latest" is the newest.
  router.get('/versions/:version', transferSlot, (req, res) => {
    const latest = current(req.params.id);
    const version = req.params.version === 'latest' ? latest?.version : Number(req.params.version);
    const row = Number.isInteger(version)
      && db.prepare('SELECT name, data FROM file_versions WHERE doc_id = ? AND version = ?').get(req.params.id, version);
    if (!row) return res.status(404).json({ error: 'Version nicht gefunden' });
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': attachment(downloadName(req.doc.title, version, extensionOf(row.name))),
      'Cache-Control': 'private, no-store',
    });
    res.send(asBuffer(row.data));
  });

  // Check out: reserves the file for this person on the current version.
  router.post('/checkout', mayChange, (req, res) => {
    const latest = current(req.params.id);
    const taken = db.prepare(`UPDATE documents SET checkout_user = ?, checkout_version = ?, checkout_at = ?
      WHERE id = ? AND (checkout_user IS NULL OR checkout_user = ?)`)
      .run(req.user.id, latest.version, Date.now(), req.params.id, req.user.id).changes;
    const state = fileState(req.params.id);
    if (!taken) {
      return res.status(409).json({ error: 'Die Datei wird gerade von jemand anderem bearbeitet', code: 'checked-out', ...state });
    }
    res.json(state);
  });

  // Ends a checkout without uploading: the holder, or the owner for someone else's checkout.
  router.delete('/checkout', (req, res) => {
    const holder = db.prepare('SELECT checkout_user FROM documents WHERE id = ?').get(req.params.id).checkout_user;
    if (holder && holder !== req.user.id && req.role !== 'owner') {
      return res.status(403).json({ error: 'Nur die Eigentümer:in kann eine fremde Bearbeitung aufheben' });
    }
    db.prepare('UPDATE documents SET checkout_user = NULL, checkout_version = NULL, checkout_at = NULL WHERE id = ?')
      .run(req.params.id);
    res.json(fileState(req.params.id));
  });

  // Upload of the changed file: needs the own checkout on the current version, the same file type and new
  // content. Everything that does not need the bytes is checked before the body is read.
  const uploadChecks = (req, res, next) => {
    const name = cleanFileName(req.get('X-File-Name'));
    if (!name) return res.status(400).json({ error: 'Dateiname fehlt' });
    const latest = current(req.params.id);
    const doc = db.prepare('SELECT checkout_user, checkout_version FROM documents WHERE id = ?').get(req.params.id);
    if (doc.checkout_user !== req.user.id) {
      return res.status(409).json({
        error: 'Lade die Datei zuerst mit „Zum Bearbeiten herunterladen“ herunter', code: 'not-checked-out',
        ...fileState(req.params.id),
      });
    }
    if (doc.checkout_version !== latest.version) {
      return res.status(409).json({
        error: 'Inzwischen gibt es eine neuere Version', code: 'outdated', base: doc.checkout_version, current: latest.version,
      });
    }
    if (extensionOf(name) !== extensionOf(latest.name)) {
      return res.status(400).json({
        error: 'Falscher Dateityp', code: 'wrong-type', expected: extensionOf(latest.name), got: extensionOf(name),
      });
    }
    Object.assign(req, { fileName: name, latest });
    next();
  };

  router.post('/versions', mayChange, uploadChecks, uploadLimits, transferSlot, raw, (req, res) => {
    const data = bodyOf(req);
    if (!data.length) return res.status(400).json({ error: 'Die Datei ist leer' });
    if (usedBytes(req.user.id) + data.length > QUOTA_BYTES) {
      return res.status(413).json({ error: 'Dein Speicherplatz für Dateien ist voll', code: 'quota', quotaMb: QUOTA_BYTES / 1024 / 1024 });
    }
    const { latest } = req;
    const same = db.prepare('SELECT version FROM file_versions WHERE doc_id = ? AND sha256 = ? ORDER BY version DESC LIMIT 1')
      .get(req.params.id, sha256(data));
    if (same) {
      return res.status(409).json({
        error: 'Diese Datei gibt es schon als ältere Version', code: same.version === latest.version ? 'unchanged' : 'old-version',
        version: same.version, current: latest.version,
      });
    }
    // Synchronous code: nobody can upload between the checks above and this insert.
    transaction(() => insertVersion({
      docId: req.params.id, version: latest.version + 1, name: req.fileName, data, userId: req.user.id,
      note: noteFrom(req.get('X-Note')),
    }));
    countUpload(req.user.id);
    res.status(201).json(fileState(req.params.id));
  });

  // Owner deletes an old version for good (not the current one), e.g. one with personal data by mistake.
  router.delete('/versions/:version', (req, res) => {
    if (req.role !== 'owner') return res.status(403).json({ error: 'Keine Berechtigung' });
    const version = Number(req.params.version);
    const latest = current(req.params.id);
    if (version === latest.version) return res.status(400).json({ error: 'Die aktuelle Version lässt sich nicht löschen' });
    const removed = Number.isInteger(version)
      && db.prepare('DELETE FROM file_versions WHERE doc_id = ? AND version = ?').run(req.params.id, version).changes;
    if (!removed) return res.status(404).json({ error: 'Version nicht gefunden' });
    res.json(fileState(req.params.id));
  });

  // Makes an old version the newest one again (as a new version). Not while someone else has it checked out.
  router.post('/versions/:version/restore', mayChange, (req, res) => {
    const version = Number(req.params.version);
    const row = Number.isInteger(version)
      && db.prepare('SELECT name, data FROM file_versions WHERE doc_id = ? AND version = ?').get(req.params.id, version);
    if (!row) return res.status(404).json({ error: 'Version nicht gefunden' });
    const holder = db.prepare('SELECT checkout_user FROM documents WHERE id = ?').get(req.params.id).checkout_user;
    if (holder && holder !== req.user.id) {
      return res.status(409).json({ error: 'Die Datei wird gerade von jemand anderem bearbeitet', code: 'checked-out', ...fileState(req.params.id) });
    }
    const latest = current(req.params.id);
    if (version === latest.version) return res.status(400).json({ error: 'Das ist bereits die aktuelle Version' });
    transaction(() => insertVersion({
      docId: req.params.id, version: latest.version + 1, name: row.name, data: asBuffer(row.data),
      userId: req.user.id, restoredFrom: version,
    }));
    res.status(201).json(fileState(req.params.id));
  });

  return router;
}

/** Error handler for uploads that are too large. */
export function fileUploadErrors(err, req, res, next) {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Datei ist zu groß (höchstens 25 MB)' });
  next(err);
}
