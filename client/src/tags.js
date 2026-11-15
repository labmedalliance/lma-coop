// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Tags on the document list: badges, the dialog that assigns tags to one document, and the admin dialog that
// keeps the shared tag list. Only admins create, rename and delete tags (server/admin.js); owners and editors
// assign tags from the list (server/docs.js).
import { api, toast } from './base.js';
import { t } from './i18n.js';

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

const $ = (id) => document.getElementById(id);
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
const byName = (a, b) => a.localeCompare(b);

// Each tag name always gets the same colour, in every browser.
const COLORS = ['azure', 'indigo', 'purple', 'pink', 'teal', 'cyan', 'lime', 'orange'];
function colorOf(name) {
  let hash = 0;
  for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

/** Badge element for a tag name. */
export function tagBadge(name) {
  const badge = document.createElement('span');
  badge.className = `badge bg-${colorOf(name)}-lt tag-badge`;
  badge.textContent = name;
  return badge;
}

/**
 * Dialog that assigns tags to one document. Returns `open(doc)`; `doc` needs id, title and tags.
 * After each change `doc.tags` holds the stored names and `onChange()` runs. Admins may also create a new tag.
 */
export function setupTagDialog({ isAdmin, onChange }) {
  const dialog = $('tags-dialog');
  const input = $('tags-input');
  const addBtn = $('tags-add');
  let doc = null;
  let known = []; // the shared tag list, loaded when the dialog opens

  addBtn.hidden = !isAdmin;
  input.placeholder = isAdmin ? t('Tag suchen oder neu anlegen') : t('Tag suchen');

  function render() {
    $('tags-none').hidden = doc.tags.length > 0;
    $('tags-current').replaceChildren(...doc.tags.map((name) => {
      const badge = tagBadge(name);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'tag-remove';
      remove.setAttribute('aria-label', t('Tag „{name}" entfernen', { name }));
      remove.innerHTML = '<i class="ti ti-x"></i>';
      remove.addEventListener('click', () => save(doc.tags.filter((n) => n !== name)));
      badge.append(remove);
      return badge;
    }));
    // Tags from the list that are not on this document yet, filtered by what is typed.
    const q = input.value.trim().toLowerCase();
    const offer = known.filter((name) => !doc.tags.some((n) => sameName(n, name)) && name.toLowerCase().includes(q));
    $('tags-suggest').replaceChildren(...offer.map((name) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'btn btn-sm tag-suggestion';
      chip.innerHTML = '<i class="ti ti-plus me-1"></i>';
      chip.append(name);
      chip.addEventListener('click', () => add(name));
      return chip;
    }));
    const hint = $('tags-hint');
    if (isAdmin) hint.textContent = t('Ein neuer Name legt den Tag in der gemeinsamen Liste an.');
    else if (!known.length) hint.textContent = t('Es gibt noch keine Tags. Tags legt ein Admin an.');
    else if (!offer.length && q) hint.textContent = t('Kein passender Tag. Neue Tags legt ein Admin an.');
    else hint.textContent = '';
  }

  async function save(next) {
    try {
      ({ tags: doc.tags } = await api(`/api/docs/${doc.id}/tags`, { method: 'PUT', body: { tags: next } }));
      onChange();
    } catch (err) {
      toast(err.message);
    }
    render();
  }

  async function add(raw) {
    const typed = raw.replace(/\s+/g, ' ').trim();
    if (!typed) return;
    let name = known.find((n) => sameName(n, typed));
    if (!name) {
      // Unknown name: admins create it; everyone else gets the only match, if there is exactly one.
      const offer = known.filter((n) => n.toLowerCase().includes(typed.toLowerCase()) && !doc.tags.some((m) => sameName(m, n)));
      if (isAdmin) {
        if (typed.length > MAX_TAG_LENGTH) return toast(t('Tag: 1–40 Zeichen'));
        try {
          ({ name } = await api('/api/admin/tags', { method: 'POST', body: { name: typed } }));
        } catch (err) {
          return toast(err.message);
        }
        known = [...known, name].sort(byName);
      } else if (offer.length === 1) {
        [name] = offer;
      } else {
        return render();
      }
    }
    input.value = '';
    if (doc.tags.some((n) => sameName(n, name))) return render();
    if (doc.tags.length >= MAX_TAGS) return toast(t('Höchstens 20 Tags mit je höchstens 40 Zeichen'));
    await save([...doc.tags, name]);
    input.focus();
  }

  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); // Enter adds the tag instead of closing the dialog.
    add(input.value);
  });
  addBtn.addEventListener('click', () => add(input.value));

  return async function open(target) {
    doc = target;
    input.value = '';
    $('tags-doc').textContent = doc.title;
    render();
    dialog.showModal();
    try {
      known = await api('/api/docs/tags');
      render();
    } catch { /* the list only offers choices */ }
  };
}

/** Admin dialog for the shared tag list. `onChange()` runs after a rename or delete, so the cards update. */
export function setupTagManager({ onChange }) {
  const dialog = $('manage-tags-dialog');
  const nameInput = $('new-tag-name');

  async function load() {
    const tags = await api('/api/admin/tags');
    $('tags-empty').hidden = tags.length > 0;
    $('tag-rows').replaceChildren(...tags.map((tag) => {
      const li = document.createElement('li');
      li.className = 'tag-row';
      const name = document.createElement('input');
      name.className = 'form-control form-control-sm';
      name.value = tag.name;
      name.maxLength = MAX_TAG_LENGTH;
      name.setAttribute('aria-label', t('Tag „{name}" umbenennen', { name: tag.name }));
      name.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault(); // Enter saves the name instead of closing the dialog.
        name.blur();
      });
      name.addEventListener('change', async () => {
        try {
          await api(`/api/admin/tags/${tag.id}`, { method: 'PATCH', body: { name: name.value } });
          toast(t('Tag umbenannt'));
          onChange();
        } catch (err) {
          toast(err.message);
        }
        load();
      });
      const docs = document.createElement('span');
      docs.className = 'text-secondary small text-nowrap';
      docs.textContent = tag.docs === 1 ? t('1 Dokument') : t('{n} Dokumente', { n: tag.docs });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn-ghost-danger btn-icon';
      del.setAttribute('aria-label', t('Tag „{name}" löschen', { name: tag.name }));
      del.innerHTML = '<i class="ti ti-trash"></i>';
      del.addEventListener('click', () => remove(tag));
      li.append(name, docs, del);
      return li;
    }));
  }

  // Deleting removes the tag from every document, so it asks first when documents carry it.
  async function remove(tag) {
    if (tag.docs && !window.confirm(t('Tag „{name}" löschen? Er verschwindet aus {n} Dokument(en).', { name: tag.name, n: tag.docs }))) return;
    try {
      await api(`/api/admin/tags/${tag.id}`, { method: 'DELETE' });
      toast(t('Tag „{name}" gelöscht', { name: tag.name }));
      onChange();
    } catch (err) {
      toast(err.message);
    }
    load();
  }

  async function create() {
    if (!nameInput.value.trim()) return;
    try {
      const { name } = await api('/api/admin/tags', { method: 'POST', body: { name: nameInput.value } });
      nameInput.value = '';
      toast(t('Tag „{name}" angelegt', { name }));
      load();
    } catch (err) {
      toast(err.message);
    }
  }

  $('new-tag-btn').addEventListener('click', create);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    create();
  });

  return async function open() {
    nameInput.value = '';
    dialog.showModal();
    try {
      await load();
    } catch (err) {
      toast(err.message);
    }
  };
}
