// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Hands a Word file from the document list to the new document's editor page (IndexedDB keeps File objects).

const open = () => new Promise((resolve, reject) => {
  const req = indexedDB.open('lma-coop-import', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('files');
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

function run(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('files', mode);
    const req = fn(tx.objectStore('files'));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

export const savePendingImport = (docId, file) => run('readwrite', (store) => store.put(file, docId));

/** Returns the file waiting for `docId` (or undefined) and removes it. */
export async function takePendingImport(docId) {
  try {
    const file = await run('readonly', (store) => store.get(docId));
    if (file) await run('readwrite', (store) => store.delete(docId));
    return file;
  } catch {
    return undefined; // storage blocked: nothing to import
  }
}
