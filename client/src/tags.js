// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Tags: badges for the document list and the tag dialog in the document header.
// The server keeps one shared list of tags (server/docs.js); a tag disappears once no document uses it.
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
 * Tag button and dialog on the document page. `canEdit` allows changes (owner and editor); everyone else
 * sees the tags in the dialog without controls.
 */
export function setupTags({ docId, tags: initial, canEdit }) {
  const button = document.getElementById('doc-tags');
  const count = document.getElementById('doc-tags-count');
  const dialog = document.getElementById('tags-dialog');
  const current = document.getElementById('tags-current');
  const none = document.getElementById('tags-none');
  const input = document.getElementById('tags-input');
  const suggestions = document.getElementById('tags-suggest');
  const editRow = document.getElementById('tags-edit');
  let tags = initial;
  let known = []; // all tag names the user may see, loaded when the dialog opens

  editRow.hidden = !canEdit;

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
    // Existing tags that are not on this document yet, filtered by what is typed.
    const q = input.value.trim().toLowerCase();
    const offer = known.filter((name) => !tags.some((n) => sameName(n, name)) && name.toLowerCase().includes(q));
    suggestions.replaceChildren(...offer.slice(0, 30).map((name) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'btn btn-sm tag-suggestion';
      chip.innerHTML = '<i class="ti ti-plus me-1"></i>';
      chip.append(name);
      chip.addEventListener('click', () => add(name));
      return chip;
    }));
  }

  async function save(next) {
    try {
      ({ tags } = await api(`/api/docs/${docId}/tags`, { method: 'PUT', body: { tags: next } }));
      for (const name of tags) if (!known.some((n) => sameName(n, name))) known.push(name);
      known.sort((a, b) => a.localeCompare(b));
    } catch (err) {
      toast(err.message);
    }
    renderButton();
    renderDialog();
  }

  function add(raw) {
    const name = raw.replace(/\s+/g, ' ').trim();
    if (!name) return;
    if (name.length > MAX_TAG_LENGTH) return toast(t('Höchstens 20 Tags mit je höchstens 40 Zeichen'));
    input.value = '';
    if (tags.some((n) => sameName(n, name))) return renderDialog();
    if (tags.length >= MAX_TAGS) return toast(t('Höchstens 20 Tags mit je höchstens 40 Zeichen'));
    save([...tags, name]);
    input.focus();
  }

  button.addEventListener('click', async () => {
    input.value = '';
    renderDialog();
    dialog.showModal();
    try {
      known = await api('/api/docs/tags');
      renderDialog();
    } catch { /* suggestions are optional */ }
  });
  input.addEventListener('input', renderDialog);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); // Enter adds the tag instead of closing the dialog.
    add(input.value);
  });
  document.getElementById('tags-add').addEventListener('click', () => add(input.value));

  renderButton();
}
