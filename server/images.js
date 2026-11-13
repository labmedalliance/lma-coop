// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Images in documents: upload and delivery.
//
// Everyone who may change the document may upload, also "suggest only" users (they suggest images), not "Lesen".
// The type is taken from the file content, not from the browser: only PNG, JPEG, GIF and WebP.
// SVG is not accepted, because it can carry scripts.
import { randomUUID } from 'node:crypto';
import express, { Router } from 'express';
import { db } from './db.js';
import { roleFor } from './docs.js';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_ID = /^[0-9a-f-]{36}$/;

const startsWith = (buf, bytes, offset = 0) => bytes.every((b, i) => buf[offset + i] === b);

/** Detects the image type from the first bytes; null if it is not a supported image. */
export function sniffImageType(buf) {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

/** Router for /api/docs/:id/images. */
export function imagesRouter() {
  const router = Router({ mergeParams: true });

  router.use((req, res, next) => {
    req.role = roleFor(req.user.id, req.params.id);
    if (!req.role) return res.status(404).json({ error: 'Nicht gefunden' });
    next();
  });

  const mayUpload = (req, res, next) => (req.role === 'viewer' ? res.status(403).json({ error: 'Keine Berechtigung' }) : next());

  router.post('/', mayUpload, express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }), (req, res) => {
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const mime = sniffImageType(data);
    if (!mime) return res.status(415).json({ error: 'Nur PNG, JPEG, GIF oder WebP möglich' });
    const id = randomUUID();
    db.prepare('INSERT INTO images (id, doc_id, user_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, req.params.id, req.user.id, mime, data, Date.now());
    res.status(201).json({ id, src: `/api/docs/${req.params.id}/images/${id}` });
  });

  router.get('/:imageId', (req, res) => {
    const row = IMAGE_ID.test(req.params.imageId)
      && db.prepare('SELECT mime, data FROM images WHERE id = ? AND doc_id = ?').get(req.params.imageId, req.params.id);
    if (!row) return res.status(404).json({ error: 'Bild nicht gefunden' });
    // Images never change, so the browser may keep them; "private" keeps them out of shared caches.
    res.set({ 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Disposition': 'inline' });
    res.send(Buffer.from(row.data));
  });

  return router;
}

/** Error handler for uploads that are too large. */
export function imageUploadErrors(err, req, res, next) {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Bild ist zu groß (höchstens 10 MB)' });
  next(err);
}
