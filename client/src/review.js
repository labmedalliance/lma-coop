// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Suggestion mode switch and the "Vorschläge" panel (accept / reject).
import {
  enableSuggestChanges, disableSuggestChanges, isSuggestChangesEnabled,
  applySuggestion, revertSuggestion, applySuggestions, revertSuggestions, selectSuggestion,
} from '@handlewithcare/prosemirror-suggest-changes';
import { api, toast } from './base.js';
import { t } from './i18n.js';
import { collectSuggestions, suggestionAuthor, suggestionAuthorName } from './suggestions.js';

const $ = (id) => document.getElementById(id);
const MODE_KEY = 'gdk-mode';

const excerpt = (text, max = 80) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Sets up the mode switch and the suggestions panel.
 * Suggesters are always in suggestion mode; owners and editors can switch.
 * Returns { suggesting() }.
 */
export function setupReview({ editor, role, docId, onModeChange }) {
  const canDecide = role === 'owner' || role === 'editor';
  const run = (command) => command(editor.state, editor.view.dispatch, editor.view);
  const authors = new Map();

  // Author names come from the member list; reload it when a suggestion by someone new shows up.
  let loading = null;
  function loadAuthors() {
    loading ??= api(`/api/docs/${docId}/members`).then(({ owner, members }) => {
      for (const u of [owner, ...members].filter(Boolean)) authors.set(u.id, u.name);
      render();
    }).catch(() => {}).finally(() => { setTimeout(() => { loading = null; }, 5000); });
  }
  loadAuthors();

  // --- Mode ---
  const select = $('mode-select');
  function setSuggesting(on) {
    if (on !== isSuggestChangesEnabled(editor.state)) run(on ? enableSuggestChanges : disableSuggestChanges);
    document.body.classList.toggle('is-suggesting', on);
    onModeChange();
  }
  if (canDecide) {
    select.hidden = false;
    let saved = 'edit';
    try { saved = localStorage.getItem(`${MODE_KEY}:${docId}`) || 'edit'; } catch { /* storage unavailable */ }
    select.value = saved;
    setSuggesting(saved === 'suggest');
    select.addEventListener('change', () => {
      setSuggesting(select.value === 'suggest');
      try { localStorage.setItem(`${MODE_KEY}:${docId}`, select.value); } catch { /* storage unavailable */ }
      editor.commands.focus();
    });
  } else if (role === 'viewer') {
    $('mode-badge').textContent = t('Nur lesen');
    $('mode-badge').classList.replace('bg-orange-lt', 'bg-secondary-lt');
    $('mode-badge').hidden = false;
  } else {
    $('mode-badge').hidden = false;
    setSuggesting(true);
  }

  // --- Panel ---
  const panel = $('suggestions-panel');
  const toggleBtn = $('toggle-suggestions');
  function togglePanel(show = panel.hidden) {
    panel.hidden = !show;
    toggleBtn.setAttribute('aria-pressed', String(show));
    if (show) {
      $('refs-panel').hidden = true;
      $('toggle-refs').setAttribute('aria-pressed', 'false');
    }
  }
  toggleBtn.addEventListener('click', () => togglePanel());
  $('close-suggestions').addEventListener('click', () => togglePanel(false));
  $('suggestions-bulk').hidden = !canDecide;

  $('accept-all').addEventListener('click', () => { run(applySuggestions); toast(t('Alle Vorschläge angenommen')); });
  $('reject-all').addEventListener('click', () => { run(revertSuggestions); toast(t('Alle Vorschläge abgelehnt')); });

  function describe(s) {
    if (s.inserted && s.deleted) {
      return t('Ersetzt „{old}“ durch „{new}“', { old: excerpt(s.deleted, 40), new: excerpt(s.inserted, 40) });
    }
    if (s.inserted) return t('Fügt ein: „{text}“', { text: excerpt(s.inserted) });
    if (s.deleted) return t('Löscht: „{text}“', { text: excerpt(s.deleted) });
    return t('Ändert die Formatierung');
  }

  function render() {
    const list = collectSuggestions(editor.state.doc);
    if (list.some((s) => s.authorId && !authors.has(s.authorId))) loadAuthors();
    const count = $('suggestion-count');
    count.hidden = list.length === 0;
    count.textContent = String(list.length);
    $('accept-all').disabled = $('reject-all').disabled = list.length === 0;
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'text-secondary small';
      li.textContent = t('Keine offenen Vorschläge.');
      $('suggestion-list').replaceChildren(li);
      return;
    }
    $('suggestion-list').replaceChildren(...list.map((s) => {
      const li = document.createElement('li');
      li.className = 'suggestion-item';
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'suggestion-text';
      const who = document.createElement('strong');
      who.textContent = authors.get(s.authorId) || s.authorName || t('Unbekannt');
      const what = document.createElement('span');
      what.textContent = describe(s);
      head.append(who, what);
      head.addEventListener('click', () => { run(selectSuggestion(s.id)); editor.commands.scrollIntoView(); editor.commands.focus(); });
      li.append(head);
      if (canDecide) {
        const actions = document.createElement('div');
        actions.className = 'suggestion-actions';
        const accept = document.createElement('button');
        accept.type = 'button';
        accept.className = 'btn btn-sm btn-ghost-success';
        accept.innerHTML = '<i class="ti ti-check me-1"></i>';
        accept.append(t('Annehmen'));
        accept.addEventListener('click', () => run(applySuggestion(s.id)));
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'btn btn-sm btn-ghost-danger';
        reject.innerHTML = '<i class="ti ti-x me-1"></i>';
        reject.append(t('Ablehnen'));
        reject.addEventListener('click', () => run(revertSuggestion(s.id)));
        actions.append(accept, reject);
        li.append(actions);
      }
      return li;
    }));
  }

  let scheduled = false;
  editor.on('transaction', () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; render(); });
  });
  render();

  return {
    suggesting: () => isSuggestChangesEnabled(editor.state),
    authorOf: (id) => authors.get(suggestionAuthor(id)) || suggestionAuthorName(id) || t('Unbekannt'),
  };
}
