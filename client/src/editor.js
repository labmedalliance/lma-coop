// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Collaborative document page: TipTap editor synced via Hocuspocus, toolbar, citations, export.
import { api, toast, colorFor, initials } from './base.js';
import { STATUSES } from './status.js';
import { setupTags } from './tags.js';
import { t, locale } from './i18n.js';
import { url } from './paths.js';
import './editor.css';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { Editor } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import { renumber, formatReference, shortReference } from './citations.js';
import { schemaExtensions } from './schema.js';
import { SuggestChanges, suggestionIdFor } from './suggestions.js';
import { setupReview } from './review.js';
import { setupSharing } from './share.js';
import { showNoAccess, setupEditRequest } from './access.js';
import { CommentHighlight, setupComments } from './comments.js';
import { setupSelectionMenu } from './selection-menu.js';
import { ImageUpload, insertImages, uploadImage } from './images.js';
import { IMAGE_WIDTHS } from './image-node.js';
import { setupReferenceForm } from './reference-form.js';
import { Slice } from '@tiptap/pm/model';
import { suggestChangesKey } from '@handlewithcare/prosemirror-suggest-changes';
import { takePendingImport } from './pending-import.js';

const docId = window.location.pathname.split('/').pop();
const $ = (id) => document.getElementById(id);

let me;
let meta;
try {
  [me, meta] = await Promise.all([api('/api/me'), api(`/api/docs/${docId}`)]);
} catch {
  // No access (never shared, access removed or document deleted): offer to request access.
  // The editor below must not start, so this module waits forever.
  await showNoAccess(docId);
  await new Promise(() => {});
}
const myColor = colorFor(me.name);
const role = meta.role; // owner | editor | suggester | viewer
const canEdit = role === 'owner' || role === 'editor';
const readOnly = role === 'viewer'; // "Lesen": no changes, no comments
if (readOnly) {
  // The server ignores changes from this connection anyway; these controls would only mislead.
  document.querySelectorAll('#toolbar, .autosave-switch, #refs-add, #refs-manual').forEach((node) => { node.hidden = true; });
}

// --- Title ------------------------------------------------------------------

const titleInput = $('doc-title');
titleInput.value = meta.title;
titleInput.readOnly = !canEdit;
document.title = `${meta.title} – LMA Coop`;
titleInput.addEventListener('change', async () => {
  const title = titleInput.value.trim() || t('Unbenanntes Dokument');
  titleInput.value = title;
  document.title = `${title} – LMA Coop`;
  await api(`/api/docs/${docId}`, { method: 'PATCH', body: { title } });
});
titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') titleInput.blur(); });

// --- Status -----------------------------------------------------------------

const stateSelect = $('doc-state');
stateSelect.append(...Object.entries(STATUSES).map(([value, s]) => new Option(s.label, value)));
stateSelect.value = meta.status;
stateSelect.disabled = !canEdit;
stateSelect.dataset.state = meta.status;
stateSelect.addEventListener('change', async () => {
  const previous = stateSelect.dataset.state;
  try {
    await api(`/api/docs/${docId}`, { method: 'PATCH', body: { status: stateSelect.value } });
    stateSelect.dataset.state = stateSelect.value;
  } catch (err) {
    stateSelect.value = previous;
    toast(err.message);
  }
});

// --- Tags -------------------------------------------------------------------

setupTags({ docId, tags: meta.tags, canEdit, isAdmin: me.isAdmin });

// --- Collaboration ----------------------------------------------------------

// The editor works on `ydoc`. The provider syncs `sharedDoc` with the server. Remote changes flow into
// `ydoc` at once; local changes flow into `sharedDoc` at once with autosave, otherwise on "Speichern".
const ydoc = new Y.Doc();
const sharedDoc = new Y.Doc();
const references = ydoc.getMap('references');
const FROM_SERVER = Symbol('from-server');
const FROM_EDITOR = Symbol('from-editor');
let pending = []; // local updates not yet handed to the provider
let savePending = false; // show the save icon once the server confirms
const autosaveKey = 'autosave';
let autosave = true;
try { autosave = localStorage.getItem(autosaveKey) !== 'off'; } catch { /* storage blocked: keep default */ }

const provider = new HocuspocusProvider({
  url: `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${url('/collab')}`,
  name: docId,
  document: sharedDoc,
  token: 'cookie', // The server authenticates via the session cookie.
});

sharedDoc.on('update', (update, origin) => {
  if (origin !== FROM_EDITOR) Y.applyUpdate(ydoc, update, FROM_SERVER);
});
ydoc.on('update', (update, origin) => {
  if (origin === FROM_SERVER) return;
  pending.push(update);
  if (autosave) save();
  else updateSyncStatus();
});

function save() {
  if (!pending.length) return;
  const update = Y.mergeUpdates(pending);
  pending = [];
  savePending = true;
  Y.applyUpdate(sharedDoc, update, FROM_EDITOR);
  updateSyncStatus();
}

const syncStatus = $('sync-status');
const saveIcon = $('save-icon');
const saveBtn = $('save-btn');
const autosaveToggle = $('autosave-toggle');
let connection = 'connecting';
let saveIconTimer;

function showSaved() {
  saveIcon.hidden = false;
  clearTimeout(saveIconTimer);
  saveIconTimer = setTimeout(() => { saveIcon.hidden = true; }, 3000);
}

function updateSyncStatus() {
  saveBtn.hidden = autosave;
  saveBtn.disabled = !pending.length;
  if (connection === 'connecting') syncStatus.textContent = t('Verbinde …');
  else if (pending.length) syncStatus.textContent = t('Nicht gespeichert');
  else if (connection !== 'connected') syncStatus.textContent = t('Offline – Änderungen werden nachgereicht');
  else if (provider.hasUnsyncedChanges) syncStatus.textContent = t('Speichert …');
  else {
    syncStatus.textContent = t('Gespeichert');
    // The server confirmed our changes.
    if (savePending) { savePending = false; showSaved(); }
  }
}
provider.on('status', ({ status }) => { connection = status; updateSyncStatus(); });
provider.on('synced', updateSyncStatus);
provider.on('unsyncedChanges', updateSyncStatus);

autosaveToggle.checked = autosave;
autosaveToggle.addEventListener('change', () => {
  autosave = autosaveToggle.checked;
  try { localStorage.setItem(autosaveKey, autosave ? 'on' : 'off'); } catch { /* not persisted */ }
  if (autosave) save();
  updateSyncStatus();
});
saveBtn.addEventListener('click', save);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  }
});
window.addEventListener('beforeunload', (e) => {
  if (pending.length) e.preventDefault();
});
updateSyncStatus();
provider.on('authenticationFailed', () => {
  syncStatus.textContent = t('Kein Zugriff');
  toast(t('Kein Zugriff auf dieses Dokument. Vielleicht wurde die Freigabe entfernt.'));
});
// The server closes the document connection when roles change or a change was not a pure suggestion.
// Reloading picks up the new role and drops the rejected local change.
// Plain network drops are not handled here: the provider reconnects and syncs offline changes.
provider.on('close', ({ event }) => {
  if (event?.reason === 'suggestion-only') {
    toast(t('Diese Änderung war kein reiner Vorschlag und wurde verworfen. Lade neu …'));
  } else if (event?.reason === 'Reset Connection') {
    toast(t('Die Freigabe für dieses Dokument wurde geändert. Lade neu …'));
  } else {
    return;
  }
  setTimeout(() => window.location.reload(), 1500);
});

provider.on('awarenessChange', ({ states }) => {
  const users = states.map((s) => s.user).filter(Boolean);
  const unique = [...new Map(users.map((u) => [u.name, u])).values()];
  $('presence').replaceChildren(...unique.map((u) => {
    const el = document.createElement('span');
    el.className = 'avatar avatar-sm';
    el.style.backgroundColor = u.color;
    el.style.color = '#fff';
    el.title = u.name;
    el.textContent = initials(u.name);
    return el;
  }));
});

// --- Editor -----------------------------------------------------------------

// Assigned below; updateToolbar() may run before setupReview() during editor creation.
let review = { suggesting: () => false };
const editor = new Editor({
  element: $('editor'),
  extensions: [
    ...schemaExtensions,
    Collaboration.configure({ document: ydoc }),
    CollaborationCaret.configure({ provider, user: { name: me.name, color: myColor } }),
    CharacterCount,
    Placeholder.configure({ placeholder: t('Titel, Abstract, Einleitung …') }),
    SuggestChanges.configure({ generateId: suggestionIdFor(me.id) }),
    CommentHighlight,
    ImageUpload.configure({ docId }),
  ],
  editable: !readOnly,
  editorProps: { attributes: { class: 'prose', spellcheck: 'true', lang: 'de' } },
});

// --- Toolbar ----------------------------------------------------------------

const chain = () => editor.chain().focus();
// Aligning the paragraph of a selected image keeps the image selected, so its tools stay open.
function align(value) {
  const { selection } = editor.state;
  const c = chain().setTextAlign(value);
  (selection.node?.type.name === 'image' ? c.setNodeSelection(selection.from) : c).run();
}
const commands = {
  undo: () => chain().undo().run(),
  redo: () => chain().redo().run(),
  bold: () => chain().toggleBold().run(),
  italic: () => chain().toggleItalic().run(),
  underline: () => chain().toggleUnderline().run(),
  strike: () => chain().toggleStrike().run(),
  superscript: () => chain().unsetSubscript().toggleSuperscript().run(),
  subscript: () => chain().unsetSuperscript().toggleSubscript().run(),
  bulletList: () => chain().toggleBulletList().run(),
  orderedList: () => chain().toggleOrderedList().run(),
  blockquote: () => chain().toggleBlockquote().run(),
  left: () => align('left'),
  center: () => align('center'),
  right: () => align('right'),
  justify: () => align('justify'),
  table: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  addRow: () => chain().addRowAfter().run(),
  addCol: () => chain().addColumnAfter().run(),
  delRow: () => chain().deleteRow().run(),
  delCol: () => chain().deleteColumn().run(),
  delTable: () => chain().deleteTable().run(),
  image: () => imageInput.click(),
  imageWidth: (btn) => {
    const width = Number(btn.dataset.width);
    chain().updateAttributes('image', { width: width === 100 ? null : width }).run();
  },
  imageAlt: () => {
    const alt = window.prompt(t('Bildbeschreibung (für Screenreader und Word):'), editor.getAttributes('image').alt || '');
    if (alt !== null) chain().updateAttributes('image', { alt: alt.trim() || null }).run();
  },
  link: () => {
    const prev = editor.getAttributes('link').href || 'https://';
    const href = window.prompt(t('Link-Adresse (leer lassen zum Entfernen):'), prev);
    if (href === null) return;
    if (!href.trim()) chain().extendMarkRange('link').unsetLink().run();
    else chain().extendMarkRange('link').setLink({ href: href.trim() }).run();
  },
  cite: () => openCiteDialog(),
  comment: () => comments.start(),
};
const activeChecks = {
  bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strike', superscript: 'superscript',
  subscript: 'subscript', link: 'link', bulletList: 'bulletList', orderedList: 'orderedList', blockquote: 'blockquote',
};

$('toolbar').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-cmd]');
  if (btn) commands[btn.dataset.cmd](btn);
});

const imageInput = $('image-input');
imageInput.addEventListener('change', () => {
  insertImages(editor, docId, imageInput.files);
  imageInput.value = '';
});

const blockType = $('block-type');
blockType.addEventListener('change', () => {
  if (blockType.value === 'p') chain().setParagraph().run();
  else chain().toggleHeading({ level: Number(blockType.value) }).run();
});

function updateToolbar() {
  document.querySelectorAll('#toolbar button[data-cmd]').forEach((btn) => {
    const cmd = btn.dataset.cmd;
    let active = false;
    if (activeChecks[cmd]) active = editor.isActive(activeChecks[cmd]);
    else if (['left', 'center', 'right', 'justify'].includes(cmd)) active = editor.isActive({ textAlign: cmd });
    else if (cmd === 'imageWidth') active = imageWidth() === Number(btn.dataset.width);
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  const level = [1, 2, 3].find((l) => editor.isActive('heading', { level: l }));
  blockType.value = level ? String(level) : 'p';
  $('table-tools').hidden = !editor.isActive('table') || review.suggesting();
  // Size and description change the image directly; in suggestion mode only insert or delete it.
  $('image-tools').hidden = !editor.isActive('image') || review.suggesting();
  // Lists, quotes and tables cannot be suggested (see suggestions.js), only edited directly.
  for (const cmd of STRUCTURAL) {
    const btn = document.querySelector(`#toolbar button[data-cmd="${cmd}"]`);
    btn.disabled = review.suggesting();
    btn.title = review.suggesting() ? t('Im Vorschlagsmodus nicht möglich') : btn.dataset.title || btn.title;
  }
}
const STRUCTURAL = ['bulletList', 'orderedList', 'blockquote', 'table'];
const imageWidth = () => (IMAGE_WIDTHS.includes(editor.getAttributes('image').width) ? editor.getAttributes('image').width : 100);
document.querySelectorAll('#toolbar button[data-cmd]').forEach((btn) => { btn.dataset.title = btn.title; });

// --- Citations, bibliography and reference panel ----------------------------

let numbers = new Map();

function renderBibliography() {
  const cited = [...numbers.entries()].sort((a, b) => a[1] - b[1]);
  $('bibliography').hidden = cited.length === 0;
  $('bib-list').replaceChildren(...cited.map(([id]) => {
    const li = document.createElement('li');
    const ref = references.get(id);
    li.textContent = ref ? formatReference(ref) : t('(Quelle wurde aus der Literaturliste entfernt)');
    return li;
  }));
}

function renderRefsPanel() {
  const entries = [...references.entries()].sort(([a], [b]) => (numbers.get(a) || 1e9) - (numbers.get(b) || 1e9));
  $('refs-list').replaceChildren(...entries.map(([id, ref]) => {
    const li = document.createElement('li');
    const num = document.createElement('span');
    num.className = 'refs-num';
    num.textContent = numbers.has(id) ? numbers.get(id) : '–';
    num.title = t(numbers.has(id) ? 'Im Text zitiert' : 'Noch nicht zitiert');
    const text = document.createElement('div');
    text.className = 'refs-text';
    text.textContent = formatReference(ref);
    const actions = document.createElement('div');
    actions.className = 'refs-actions';
    li.append(num, text, actions);
    // Changing an entry is direct editing; the server allows "Vorschlagen" only to add entries.
    if (canEdit) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn btn-ghost-secondary btn-icon btn-sm';
      edit.setAttribute('aria-label', t('Quelle bearbeiten'));
      edit.title = t('Quelle bearbeiten');
      edit.innerHTML = '<i class="ti ti-pencil"></i>';
      edit.addEventListener('click', async () => {
        const changed = await openReferenceForm(references.get(id) || ref);
        if (changed) references.set(id, changed);
      });
      actions.append(edit);
    }
    if (!numbers.has(id) && canEdit) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn-ghost-danger btn-icon btn-sm';
      del.setAttribute('aria-label', t('Quelle entfernen'));
      del.innerHTML = '<i class="ti ti-trash"></i>';
      del.addEventListener('click', () => {
        references.delete(id);
        toast(t('Quelle entfernt'), { actionLabel: t('Rückgängig'), onAction: () => references.set(id, ref) });
      });
      actions.append(del);
    }
    return li;
  }));
}

function refresh() {
  numbers = renumber(editor);
  renderBibliography();
  renderRefsPanel();
}

/** Adds a reference by DOI/PMID; reuses an existing entry with the same DOI or PMID. */
async function addReference(q) {
  return storeReference(await api(`/api/cite?q=${encodeURIComponent(q)}`));
}

/** Stores `ref` and returns its id; an entry with the same DOI or PMID is reused. */
function storeReference(ref) {
  for (const [id, existing] of references.entries()) {
    if ((ref.doi && existing.doi?.toLowerCase() === ref.doi.toLowerCase()) || (ref.pmid && existing.pmid === ref.pmid)) {
      return id;
    }
  }
  const id = crypto.randomUUID().slice(0, 8);
  references.set(id, ref);
  return id;
}

$('refs-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.elements.q;
  try {
    await addReference(input.value);
    input.value = '';
  } catch (err) {
    toast(err.message);
  }
});

const openReferenceForm = setupReferenceForm($('ref-dialog'));

/** Manual entry: opens the form and stores the result. Returns the new id or null. */
async function addManualReference() {
  const ref = await openReferenceForm();
  return ref ? storeReference(ref) : null;
}
$('refs-manual').addEventListener('click', addManualReference);

const refsPanel = $('refs-panel');
function toggleRefs(show = refsPanel.hidden) {
  refsPanel.hidden = !show;
  $('toggle-refs').setAttribute('aria-pressed', String(show));
  if (show) {
    $('suggestions-panel').hidden = true;
    $('toggle-suggestions').setAttribute('aria-pressed', 'false');
  }
}
$('toggle-refs').addEventListener('click', () => toggleRefs());
$('close-refs').addEventListener('click', () => toggleRefs(false));

// Citation dialog
const dialog = $('cite-dialog');
const citeOptions = $('cite-options');
const citeFilter = $('cite-filter');
const citeError = $('cite-error');
let selected = new Set();

function renderCiteOptions() {
  const q = citeFilter.value.trim().toLowerCase();
  const entries = [...references.entries()].filter(([, r]) => formatReference(r).toLowerCase().includes(q));
  if (!entries.length) {
    const li = document.createElement('li');
    li.className = 'text-secondary';
    li.textContent = t(references.size ? 'Kein Treffer.' : 'Noch keine Quellen. Füge oben eine DOI oder PMID hinzu oder gib sie manuell ein.');
    citeOptions.replaceChildren(li);
    return;
  }
  citeOptions.replaceChildren(...entries.map(([id, ref]) => {
    const li = document.createElement('li');
    const label = document.createElement('label');
    label.className = 'form-check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'form-check-input';
    box.checked = selected.has(id);
    box.addEventListener('change', () => (box.checked ? selected.add(id) : selected.delete(id)));
    const span = document.createElement('span');
    span.className = 'form-check-label';
    span.textContent = shortReference(ref);
    span.title = formatReference(ref);
    label.append(box, span);
    li.append(label);
    return li;
  }));
}

function openCiteDialog() {
  const current = editor.state.selection.node;
  selected = new Set(current?.type.name === 'citation' ? current.attrs.refIds : []);
  citeFilter.value = '';
  citeError.textContent = '';
  renderCiteOptions();
  dialog.showModal();
  $('cite-lookup').focus();
}
editor.on('openCitationDialog', openCiteDialog);

async function lookupInDialog() {
  const input = $('cite-lookup');
  if (!input.value.trim()) return;
  citeError.textContent = '';
  try {
    selected.add(await addReference(input.value));
    input.value = '';
    renderCiteOptions();
  } catch (err) {
    citeError.textContent = err.message;
  }
}
$('cite-lookup-btn').addEventListener('click', lookupInDialog);
$('cite-lookup').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); lookupInDialog(); }
});
citeFilter.addEventListener('input', renderCiteOptions);
$('cite-manual').addEventListener('click', async () => {
  const id = await addManualReference();
  if (id) { selected.add(id); renderCiteOptions(); }
});

dialog.addEventListener('close', () => {
  if (dialog.returnValue !== 'ok' || !selected.size) { editor.commands.focus(); return; }
  // Keep the order of the reference list so numbering stays predictable.
  const refIds = [...references.keys()].filter((id) => selected.has(id));
  const current = editor.state.selection.node;
  if (current?.type.name === 'citation') chain().updateAttributes('citation', { refIds }).run();
  else chain().insertContent({ type: 'citation', attrs: { refIds } }).run();
});

// --- Status bar, export, print ----------------------------------------------

function updateStatusbar() {
  const words = editor.storage.characterCount.words();
  const chars = editor.storage.characterCount.characters();
  $('word-count').textContent = t('{words} Wörter · {chars} Zeichen', {
    words: words.toLocaleString(locale), chars: chars.toLocaleString(locale),
  });
}

$('export-docx').addEventListener('click', async () => {
  const { exportDocx } = await import('./export-docx.js');
  await exportDocx(editor, references, renumber(editor), titleInput.value, review.authorOf, comments.threads());
});
$('print').addEventListener('click', () => window.print());

// --- Word import --------------------------------------------------------------

/**
 * Imports a .docx: images go to the server, references into the reference list, comments to the server,
 * then the content replaces an empty document or goes in at the cursor. Tracked changes arrive as
 * suggestions, so they can be accepted or rejected here. Owners and "Bearbeiten" only.
 */
async function importWord(file) {
  toast(t('Word-Datei wird importiert …'), { timeout: 2500 });
  const { parseDocx } = await import('./import-docx.js');
  const result = parseDocx(new Uint8Array(await file.arrayBuffer()));
  const { stats } = result;
  // Checked before anything is stored, so a file the editor cannot hold changes nothing.
  editor.schema.nodeFromJSON({ type: 'doc', content: result.content }).check();

  const srcs = new Map();
  for (const image of result.images) {
    try {
      srcs.set(`import:${image.key}`, await uploadImage(docId, new File([image.data], image.name, { type: image.mime })));
    } catch {
      // Left out; counted below.
    }
  }
  const refIds = new Map(result.references.map(({ key, ref }) => [key, storeReference(ref)]));
  let images = 0;
  const fix = (nodes) => nodes.flatMap((n) => {
    if (n.type === 'image') {
      if (!srcs.has(n.attrs.src)) return [];
      images++;
      return [{ ...n, attrs: { ...n.attrs, src: srcs.get(n.attrs.src) } }];
    }
    if (n.type === 'citation') return [{ ...n, attrs: { refIds: n.attrs.refIds.map((key) => refIds.get(key)) } }];
    return [n.content ? { ...n, content: fix(n.content) } : n];
  });
  const content = editor.schema.nodeFromJSON({ type: 'doc', content: fix(result.content) });

  // Comments in chunks, so each request stays below the server's body limit.
  let chunk = [];
  const sendChunk = async () => {
    if (chunk.length) await api(`/api/docs/${docId}/comments/import`, { method: 'POST', body: { threads: chunk } });
    chunk = [];
  };
  for (const thread of result.threads) {
    chunk.push(thread);
    if (chunk.length >= 50 || JSON.stringify(chunk).length > 60_000) await sendChunk();
  }
  await sendChunk();

  // Inserted directly, also in suggestion mode: the Word changes already are suggestions.
  const { state } = editor;
  const empty = state.doc.childCount === 1 && state.doc.firstChild.content.size === 0;
  const tr = empty
    ? state.tr.replaceWith(0, state.doc.content.size, content.content)
    : state.tr.replaceSelection(new Slice(content.content, 0, 0));
  editor.view.dispatch(tr.setMeta(suggestChangesKey, { skip: true }).scrollIntoView());

  if (empty && titleInput.value === t('Unbenanntes Dokument')) {
    titleInput.value = file.name.replace(/\.docx$/i, '');
    titleInput.dispatchEvent(new Event('change'));
  }
  const lost = stats.images - images;
  toast([
    t('Word-Datei importiert: {changes} Änderungen, {comments} Kommentare, {citations} Zitate, {images} Bilder.', {
      changes: stats.changes, comments: stats.comments, citations: stats.citations, images,
    }),
    lost && t('{n} Bilder fehlen (nur PNG, JPEG, GIF und WebP möglich).', { n: lost }),
    stats.footnotes && t('Fußnoten werden nicht übernommen ({n}).', { n: stats.footnotes }),
  ].filter(Boolean).join(' '), { timeout: 10_000 });
}

const docxInput = $('docx-input');
$('import-docx').hidden = !canEdit;
$('import-docx').addEventListener('click', () => docxInput.click());
const runImport = (file) => importWord(file).catch((err) => toast(t(err.message)));
docxInput.addEventListener('change', () => {
  const [file] = docxInput.files;
  docxInput.value = '';
  if (file) runImport(file);
});

review = setupReview({ editor, role, docId, onModeChange: updateToolbar });
setupSharing({ docId, role, provider });
const comments = setupComments({ editor, docId, me, canEdit, canComment: !readOnly, provider });
setupSelectionMenu({ editor, readOnly, onComment: () => comments.start() });
// Ctrl+Alt+M adds a comment, as in Google Docs.
document.addEventListener('keydown', (e) => {
  if (!readOnly && (e.ctrlKey || e.metaKey) && e.altKey && e.code === 'KeyM') {
    e.preventDefault();
    comments.start();
  }
});
if ((role === 'suggester' || role === 'viewer') && me.canRequest) setupEditRequest(docId, role);
editor.on('suggestionBlocked', () => {
  toast(t('Listen, Zitatblöcke und Tabellen lassen sich nicht als Vorschlag ändern.'));
});

editor.on('transaction', () => { updateToolbar(); refresh(); });
editor.on('update', updateStatusbar);
references.observe(refresh);
provider.on('synced', () => { refresh(); updateStatusbar(); });
// A Word file chosen in the document list ("Word importieren") goes in once the empty document is loaded.
if (canEdit) {
  provider.on('synced', async function importPending() {
    provider.off('synced', importPending);
    const file = await takePendingImport(docId);
    if (file) runImport(file);
  });
}
updateToolbar();
