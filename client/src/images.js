// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Inserting images: toolbar button (file picker), paste from the clipboard and drag and drop.
// Files go to the server first (POST /api/docs/:id/images); the document only stores the URL.
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { toast } from './base.js';
import { t } from './i18n.js';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;

const imageFiles = (list) => [...(list || [])].filter((f) => f.type.startsWith('image/'));

/** Uploads one file; returns the image URL. Throws with a message for the user. */
export async function uploadImage(docId, file) {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error(t('Nur PNG, JPEG, GIF oder WebP möglich'));
  if (file.size > MAX_BYTES) throw new Error(t('Bild ist zu groß (höchstens 10 MB)'));
  const res = await fetch(`/api/docs/${docId}/images`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ? t(data.error) : `${t('Fehler')} ${res.status}`);
  return data.src;
}

/**
 * Uploads the files and inserts the images at `pos` (default: the cursor).
 * Images uploaded together are inserted together, in the order of the files.
 */
export async function insertImages(editor, docId, files, pos) {
  const images = imageFiles(files);
  if (!images.length) return;
  toast(t(images.length > 1 ? 'Bilder werden hochgeladen …' : 'Bild wird hochgeladen …'), { timeout: 2500 });
  const nodes = [];
  for (const file of images) {
    try {
      nodes.push({ type: 'image', attrs: { src: await uploadImage(docId, file) } });
    } catch (err) {
      toast(`${file.name}: ${err.message}`);
    }
  }
  if (!nodes.length || editor.isDestroyed) return;
  const chain = editor.chain().focus();
  (pos === undefined ? chain.insertContent(nodes) : chain.insertContentAt(pos, nodes)).run();
}

/**
 * Editor extension: pasted and dropped image files are uploaded and inserted.
 * Pasted text that also brings an image (e.g. from Word) is pasted as text.
 */
export const ImageUpload = Extension.create({
  name: 'imageUpload',
  addOptions: () => ({ docId: null }),
  addProseMirrorPlugins() {
    const { editor, options } = this;
    return [new Plugin({
      props: {
        handlePaste(view, event) {
          const files = imageFiles(event.clipboardData?.files);
          if (!files.length || event.clipboardData.getData('text/plain').trim()) return false;
          insertImages(editor, options.docId, files);
          return true;
        },
        handleDrop(view, event, slice, moved) {
          const files = imageFiles(event.dataTransfer?.files);
          if (moved || !files.length) return false;
          event.preventDefault();
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          insertImages(editor, options.docId, files, pos);
          return true;
        },
      },
    })];
  },
});
