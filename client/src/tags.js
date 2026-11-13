// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Tags: badges for the document list and the tag dialog in the document header.
// The server keeps one shared tag list. Only admins create, rename and delete tags (admin page, server/admin.js).
import { api, toast } from './base.js';
import { t } from './i18n.js';

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

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

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * Tag button and dialog on the document page. `canEdit` allows choosing tags from the shared list (owner and
 * editor); everyone else sees the tags without controls. Only `isAdmin` creates new tags, also from this dialog.
 */
export function setupTags({ docId, tags: initial, canEdit, isAdmin }) {
  const button = document.getElementById('doc-tags');
  const count = document.getElementById('doc-tags-count');
  const dialog = document.getElementById('tags-dialog');
  const current = document.getElementById('tags-current');
  const none = document.getElementById('tags-none');
  const input = document.getElementById('tags-input');
  const addBtn = document.getElementById('tags-add');
  const hint = document.getElementById('tags-hint');
  const suggestions = document.getElementById('tags-suggest');
  let tags = initial;
  let known = []; // the shared tag list, loaded when the dialog opens

  document.getElementById('tags-edit').hidden = !canEdit;
  addBtn.hidden = !isAdmin;
  input.placeholder = isAdmin ? t('Tag suchen oder neu anlegen') : t('Tag suchen');

  function renderButton() {
    count.textContent = String(tags.length);
    count.hidden = tags.length === 0;
    button.title = tags.length ? `${t('Tags')}: ${tags.join(', ')}` : t('Tags');
    button.setAttribute('aria-label', button.title);
  }

  function renderDialog() {
    none.hidden = tags.length > 0;
    current.replaceChildren(...tags.map((name) => {
      const badge = tagBadge(name);
      if (!canEdit) return badge;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'tag-remove';
      remove.setAttribute('aria-label', t('Tag „{name}" entfernen', { name }));
      remove.innerHTML = '<i class="ti ti-x"></i>';
      remove.addEventListener('click', () => save(tags.filter((n) => n !== name)));
      badge.append(remove);
      return badge;
    }));
    // Tags from the list that are not on this document yet, filtered by what is typed.
    const q = input.value.trim().toLowerCase();
    const offer = known.filter((name) => !tags.some((n) => sameName(n, name)) && name.toLowerCase().includes(q));
    suggestions.replaceChildren(...offer.map((name) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'btn btn-sm tag-suggestion';
      chip.innerHTML = '<i class="ti ti-plus me-1"></i>';
      chip.append(name);
      chip.addEventListener('click', () => add(name));
      return chip;
    }));
    if (isAdmin) hint.textContent = t('Ein neuer Name legt den Tag in der gemeinsamen Liste an.');
    else if (!known.length) hint.textContent = t('Es gibt noch keine Tags. Tags legt ein Admin an.');
    else if (!offer.length && q) hint.textContent = t('Kein passender Tag. Neue Tags legt ein Admin an.');
    else hint.textContent = '';
  }

  async function save(next) {
    try {
      ({ tags } = await api(`/api/docs/${docId}/tags`, { method: 'PUT', body: { tags: next } }));
    } catch (err) {
      toast(err.message);
    }
    renderButton();
    renderDialog();
  }

  async function add(raw) {
    const typed = raw.replace(/\s+/g, ' ').trim();
    if (!typed) return;
    let name = known.find((n) => sameName(n, typed));
    if (!name) {
      // Unknown name: admins create it; everyone else gets the only match, if there is exactly one.
      const offer = known.filter((n) => n.toLowerCase().includes(typed.toLowerCase()) && !tags.some((m) => sameName(m, n)));
      if (isAdmin) {
        if (typed.length > MAX_TAG_LENGTH) return toast(t('Tag: 1–40 Zeichen'));
        try {
          ({ name } = await api('/api/admin/tags', { method: 'POST', body: { name: typed } }));
        } catch (err) {
          return toast(err.message);
        }
        known = [...known, name].sort((a, b) => a.localeCompare(b));
      } else if (offer.length === 1) {
        [name] = offer;
      } else {
        return renderDialog();
      }
    }
    input.value = '';
    if (tags.some((n) => sameName(n, name))) return renderDialog();
    if (tags.length >= MAX_TAGS) return toast(t('Höchstens 20 Tags mit je höchstens 40 Zeichen'));
    await save([...tags, name]);
    input.focus();
  }

  button.addEventListener('click', async () => {
    input.value = '';
    renderDialog();
    dialog.showModal();
    try {
      known = await api('/api/docs/tags');
      renderDialog();
    } catch { /* the list only offers choices */ }
  });
  input.addEventListener('input', renderDialog);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); // Enter adds the tag instead of closing the dialog.
    add(input.value);
  });
  addBtn.addEventListener('click', () => add(input.value));

  renderButton();
}
