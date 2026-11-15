// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
import { api, logout, toast } from './base.js';
import { t, locale } from './i18n.js';
import { url } from './paths.js';
import { statusBadge } from './status.js';
import { tagBadge, setupTagDialog, setupTagManager } from './tags.js';
import { savePendingImport } from './pending-import.js';
import { kindOf, kindIcon } from './file-kinds.js';

const grid = document.getElementById('doc-grid');
const empty = document.getElementById('empty-state');
const filter = document.getElementById('filter');
const stateFilter = document.getElementById('state-filter');
const tagFilter = document.getElementById('tag-filter');
let docs = [];
let others = [];
let canRequest = true;

const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
const ROLE_BADGES = {
  editor: [t('Bearbeiten'), 'bg-blue-lt'], suggester: [t('Vorschlagen'), 'bg-orange-lt'], viewer: [t('Lesen'), 'bg-secondary-lt'],
};

// "active" hides archived documents; "all" shows everything; otherwise exactly that status.
// The search matches the title, the tags and the type ("Excel", "PDF").
function matches(d, q) {
  const state = stateFilter.value;
  const stateOk = state === 'all' || (state === 'active' ? d.status !== 'archived' : d.status === state);
  const tag = tagFilter.value.toLowerCase();
  const tagOk = !tag || d.tags.some((name) => name.toLowerCase() === tag);
  const textOk = d.title.toLowerCase().includes(q) || d.tags.some((name) => name.toLowerCase().includes(q))
    || kindOf(d).label.toLowerCase().includes(q);
  return stateOk && tagOk && textOk;
}

/** Row of tag badges for a card, or nothing without tags. */
function tagRow(d) {
  if (!d.tags.length) return [];
  const row = document.createElement('div');
  row.className = 'tag-list';
  row.append(...d.tags.map(tagBadge));
  return [row];
}

// Tags below the card body. Owner and editors get a button that opens the tag dialog.
function tagArea(d) {
  const area = document.createElement('div');
  area.className = 'doc-card-tags';
  area.append(...d.tags.map(tagBadge));
  if (d.role === 'owner' || d.role === 'editor') {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn btn-sm btn-ghost-secondary tag-edit';
    edit.setAttribute('aria-label', t('Tags von „{title}" bearbeiten', { title: d.title }));
    edit.innerHTML = d.tags.length ? '<i class="ti ti-pencil"></i>' : '<i class="ti ti-tag me-1"></i>';
    if (!d.tags.length) edit.append(t('Tag'));
    edit.title = t('Tags bearbeiten');
    edit.addEventListener('click', () => openTagDialog?.(d));
    area.append(edit);
  }
  return area;
}

// Tag filter: all tags on the listed documents. Hidden while no document has tags.
function fillTagFilter() {
  const names = new Map();
  for (const d of [...docs, ...others]) for (const name of d.tags) names.set(name.toLowerCase(), name);
  const selected = tagFilter.value || savedTag;
  const sorted = [...names.values()].sort((a, b) => a.localeCompare(b, locale));
  tagFilter.replaceChildren(new Option(t('Alle Tags'), ''), ...sorted.map((name) => new Option(name, name)));
  tagFilter.value = sorted.find((name) => name.toLowerCase() === selected.toLowerCase()) ?? '';
  tagFilter.hidden = sorted.length === 0;
}

// Text documents open in the editor, files with versions on the file page.
const docUrl = (d) => url(d.kind === 'file' ? `/f/${d.id}` : `/d/${d.id}`);

/**
 * Head of a card: coloured type icon, title and type ("Excel · Version 3", "Textdokument"), so the kind of
 * entry is clear at a glance.
 */
function cardHead(d) {
  const head = document.createElement('div');
  head.className = 'd-flex align-items-center gap-2 mb-2';
  const text = document.createElement('div');
  text.className = 'min-w-0';
  const title = document.createElement('div');
  title.className = 'fw-bold text-truncate';
  title.textContent = d.title;
  const type = document.createElement('div');
  type.className = 'small text-secondary';
  const { label } = kindOf(d);
  type.textContent = d.kind === 'file' && d.version ? `${label} · ${t('Version {v}', { v: d.version })}` : label;
  text.append(title, type);
  head.append(kindIcon(d), text);
  return head;
}

function render() {
  const q = filter.value.trim().toLowerCase();
  const shown = docs.filter((d) => matches(d, q));
  grid.replaceChildren(...shown.map((d) => {
    const card = document.createElement('div');
    card.className = 'card card-link doc-card';
    const link = document.createElement('a');
    link.href = docUrl(d);
    link.className = 'card-body text-reset text-decoration-none';
    const meta = document.createElement('div');
    meta.className = 'text-secondary small';
    meta.textContent = `${d.owner || '–'} · ${dateFmt.format(d.updated_at)}`;
    link.append(cardHead(d), meta);
    if (d.checkout) {
      const badge = document.createElement('span');
      badge.className = 'badge bg-purple-lt d-inline-block mt-2 me-1';
      badge.innerHTML = '<i class="ti ti-lock me-1"></i>';
      badge.append(t('In Bearbeitung: {name}', { name: d.checkout }));
      link.append(badge);
    }
    const state = statusBadge(d.status);
    if (state) link.append(state);
    if (ROLE_BADGES[d.role]) {
      const [text, cls] = ROLE_BADGES[d.role];
      const badge = document.createElement('span');
      badge.className = `badge ${cls} d-inline-block mt-2 ms-1`;
      badge.textContent = t('Geteilt · {role}', { role: text });
      link.append(badge);
    }
    if (d.requests) {
      const badge = document.createElement('span');
      badge.className = 'badge bg-red-lt d-inline-block mt-2 ms-1';
      badge.textContent = d.requests === 1 ? t('1 offener Antrag') : t('{n} offene Anträge', { n: d.requests });
      link.append(badge);
    }
    card.append(link, tagArea(d));
    if (d.role !== 'owner') return card;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-ghost-danger btn-icon doc-delete';
    del.setAttribute('aria-label', t('„{title}" löschen', { title: d.title }));
    del.innerHTML = '<i class="ti ti-trash"></i>';
    del.addEventListener('click', () => confirmRemove(d));
    card.append(del);
    return card;
  }));
  empty.classList.toggle('d-none', docs.length > 0);
  const hiddenEl = document.getElementById('state-empty');
  hiddenEl.hidden = !(docs.length > 0 && shown.length === 0);
  renderOthers(q);
}

// Documents of others: title and owner only; the card opens the access request page.
function renderOthers(q) {
  const shown = others.filter((d) => matches(d, q));
  document.getElementById('other-section').hidden = !shown.length;
  document.getElementById('other-grid').replaceChildren(...shown.map((d) => {
    const card = document.createElement('div');
    card.className = 'card card-link doc-card doc-card-locked';
    const link = document.createElement('a');
    link.href = docUrl(d);
    link.className = 'card-body text-reset text-decoration-none';
    const title = cardHead(d);
    const meta = document.createElement('div');
    meta.className = 'text-secondary small';
    meta.textContent = `${d.owner || '–'} · ${dateFmt.format(d.updated_at)}`;
    const action = document.createElement('span');
    if (d.requested) {
      action.className = 'badge bg-yellow-lt d-inline-block mt-2';
      action.textContent = t('Beantragt · {role}', { role: ROLE_BADGES[d.requested][0] });
    } else {
      action.className = `d-inline-block mt-2 small ${canRequest ? 'text-primary' : 'text-secondary'}`;
      action.innerHTML = '<i class="ti ti-lock me-1"></i>';
      action.append(t(canRequest ? 'Zugriff beantragen' : 'Kein Zugriff'));
    }
    const state = statusBadge(d.status);
    link.append(title, meta, ...(state ? [state] : []), action, ...tagRow(d));
    card.append(link);
    return card;
  }));
}

async function load() {
  [docs, others] = await Promise.all([api('/api/docs'), api('/api/docs/discover')]);
  fillTagFilter();
  render();
}

// Only the owner sees the delete button; the server enforces the same rule.
const deleteDialog = document.getElementById('delete-dialog');
let deleteTarget = null;
function confirmRemove(doc) {
  deleteTarget = doc;
  document.getElementById('delete-text').textContent =
    t('„{title}" wird gelöscht. Alle Personen mit Freigabe verlieren den Zugriff.', { title: doc.title });
  deleteDialog.returnValue = '';
  deleteDialog.showModal();
}
deleteDialog.addEventListener('close', () => {
  if (deleteDialog.returnValue === 'ok' && deleteTarget) remove(deleteTarget);
  deleteTarget = null;
});

async function remove(doc) {
  await api(`/api/docs/${doc.id}`, { method: 'DELETE' });
  await load();
  toast(t('„{title}" gelöscht', { title: doc.title }), {
    actionLabel: t('Rückgängig'),
    onAction: async () => { await api(`/api/docs/${doc.id}/restore`, { method: 'POST' }); load(); },
  });
}

document.getElementById('new-doc-btn').addEventListener('click', async () => {
  const { id } = await api('/api/docs', { method: 'POST', body: { title: t('Unbenanntes Dokument') } });
  window.location.href = url(`/d/${id}`);
});
// New document from a Word file: the editor page of the new document imports it.
const importInput = document.getElementById('import-input');
document.getElementById('import-btn').addEventListener('click', () => importInput.click());
importInput.addEventListener('change', async () => {
  const [file] = importInput.files;
  importInput.value = '';
  if (!file) return;
  try {
    const title = file.name.replace(/\.docx$/i, '') || t('Unbenanntes Dokument');
    const { id } = await api('/api/docs', { method: 'POST', body: { title } });
    await savePendingImport(id, file);
    window.location.href = url(`/d/${id}`);
  } catch (err) {
    toast(err.message);
  }
});
// Any other file (Excel, PowerPoint, PDF …) becomes a file with versions.
const fileInput = document.getElementById('file-input');
document.getElementById('file-btn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const [file] = fileInput.files;
  fileInput.value = '';
  if (!file) return;
  try {
    const res = await fetch(url('/api/files'), {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ? t(data.error) : `${t('Fehler')} ${res.status}`);
    window.location.href = url(`/f/${data.id}`);
  } catch (err) {
    toast(err.message);
  }
});
document.getElementById('logout-btn').addEventListener('click', logout);
filter.addEventListener('input', render);
stateFilter.addEventListener('change', () => {
  render();
  try { localStorage.setItem('lma-coop-state-filter', stateFilter.value); } catch { /* storage blocked */ }
});
// The tag filter remembers its choice; the options only exist once the documents are loaded.
let savedTag = '';
try { savedTag = localStorage.getItem('lma-coop-tag-filter') || ''; } catch { /* storage blocked */ }
tagFilter.addEventListener('change', () => {
  savedTag = tagFilter.value;
  render();
  try { localStorage.setItem('lma-coop-tag-filter', tagFilter.value); } catch { /* storage blocked */ }
});
try {
  const saved = localStorage.getItem('lma-coop-state-filter');
  if (saved && [...stateFilter.options].some((o) => o.value === saved)) stateFilter.value = saved;
} catch { /* storage blocked */ }

// Tags: assigning happens on this page only; admins also keep the shared list here.
let openTagDialog = null;
const tagsChanged = () => { fillTagFilter(); render(); };

// Admins can take away creating documents and requesting rights; the server enforces both.
const meLoaded = api('/api/me').then((me) => {
  document.getElementById('me-name').textContent = me.name;
  document.getElementById('admin-link').hidden = !me.isAdmin;
  document.getElementById('new-doc-btn').hidden = !me.canCreate;
  document.getElementById('import-btn').hidden = !me.canCreate;
  document.getElementById('file-btn').hidden = !(me.canCreate && me.canUpload);
  document.getElementById('empty-create-hint').hidden = !me.canCreate;
  canRequest = me.canRequest;
  openTagDialog = setupTagDialog({ isAdmin: me.isAdmin, onChange: tagsChanged });
  if (me.isAdmin) {
    const openManager = setupTagManager({ onChange: load });
    const manageBtn = document.getElementById('manage-tags-btn');
    manageBtn.hidden = false;
    manageBtn.addEventListener('click', openManager);
  }
});
meLoaded.finally(load);
