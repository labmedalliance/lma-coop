// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Comments in the margin panel, like Google Docs: comment on selected text, reply, edit, resolve, delete.
// Works in editing and in suggestion mode and for every role. Threads live on the server; the text keeps
// only the anchor (comment mark, see comment-mark.js).
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { suggestChangesKey } from '@handlewithcare/prosemirror-suggest-changes';
import { api, toast, colorFor, initials } from './base.js';
import { t, locale } from './i18n.js';
import { commentRanges } from './comment-mark.js';

const $ = (id) => document.getElementById(id);
const highlightKey = new PluginKey('commentHighlight');

/**
 * Highlights the anchors of open threads and the draft range of a new comment.
 * Meta { open: Set, active: id|null, draft: {from,to}|null } updates the state; the draft follows edits.
 */
export const CommentHighlight = Extension.create({
  name: 'commentHighlight',
  addProseMirrorPlugins: () => [new Plugin({
    key: highlightKey,
    state: {
      init: () => ({ open: new Set(), active: null, draft: null, decorations: DecorationSet.empty }),
      apply(tr, value, _old, newState) {
        const meta = tr.getMeta(highlightKey);
        if (!meta && !tr.docChanged) return value;
        const next = { ...value, ...meta };
        if (!meta?.draft && next.draft && tr.docChanged) {
          const from = tr.mapping.map(next.draft.from, 1);
          const to = tr.mapping.map(next.draft.to, -1);
          next.draft = from < to ? { from, to } : null;
        }
        const decorations = [];
        for (const [id, { from, to }] of commentRanges(newState.doc)) {
          if (!next.open.has(id)) continue;
          decorations.push(Decoration.inline(from, to, {
            class: id === next.active ? 'comment-anchor is-active' : 'comment-anchor',
          }));
        }
        if (next.draft) decorations.push(Decoration.inline(next.draft.from, next.draft.to, { class: 'comment-anchor is-active' }));
        next.decorations = DecorationSet.create(newState.doc, decorations);
        return next;
      },
    },
    props: { decorations: (state) => highlightKey.getState(state).decorations },
  })],
});

const formatTime = (ms) => new Date(ms).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(icon, label, className = 'btn-ghost-secondary') {
  const btn = el('button', `btn btn-icon btn-sm ${className}`);
  btn.type = 'button';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.innerHTML = `<i class="ti ti-${icon}"></i>`;
  return btn;
}

function avatar(name) {
  const span = el('span', 'avatar avatar-xs', initials(name));
  span.style.backgroundColor = colorFor(name);
  span.style.color = '#fff';
  return span;
}

/** Textarea plus buttons; resolves `onSubmit(text)` and clears on success. */
function textForm({ key, placeholder, submitLabel, value = '', onSubmit, onCancel }) {
  const form = el('form', 'comment-form');
  const input = el('textarea', 'form-control form-control-sm');
  input.rows = 2;
  input.dataset.key = key; // lets render() keep text and focus while the list is rebuilt
  input.placeholder = placeholder;
  input.setAttribute('aria-label', placeholder);
  input.value = value;
  input.maxLength = 5000;
  const actions = el('div', 'comment-form-actions');
  const submit = el('button', 'btn btn-sm btn-primary', submitLabel);
  submit.type = 'submit';
  actions.append(submit);
  if (onCancel) {
    const cancel = el('button', 'btn btn-sm', t('Abbrechen'));
    cancel.type = 'button';
    cancel.addEventListener('click', onCancel);
    actions.append(cancel);
  }
  const sync = () => { submit.disabled = !input.value.trim(); };
  input.addEventListener('input', sync);
  sync();
  // Ctrl+Enter sends, Escape cancels.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
    if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    submit.disabled = true;
    // Cleared first, so a list rebuild during onSubmit does not carry the sent text over.
    input.value = '';
    try {
      await onSubmit(text);
    } catch (err) {
      input.value = text;
      toast(err.message);
    } finally {
      sync();
    }
  });
  form.append(input, actions);
  return { form, input };
}

/**
 * Sets up the comment panel. `canEdit` (owner/editor) may delete comments of others.
 * Returns { threads() } for the Word export.
 */
export function setupComments({ editor, docId, me, canEdit, provider }) {
  const panel = $('comments-panel');
  const toggleBtn = $('toggle-comments');
  const list = $('comment-list');
  const showResolved = $('comments-show-resolved');
  const base = `/api/docs/${docId}/comments`;
  let threads = [];
  let active = null;
  let editing = null; // id of the comment being edited
  let draft = null; // { from, to, quote } while writing a new comment

  // --- Panel ---
  function togglePanel(show = panel.hidden) {
    panel.hidden = !show;
    toggleBtn.setAttribute('aria-pressed', String(show));
    if (show) {
      for (const [p, b] of [['refs-panel', 'toggle-refs'], ['suggestions-panel', 'toggle-suggestions']]) {
        $(p).hidden = true;
        $(b).setAttribute('aria-pressed', 'false');
      }
    }
  }
  toggleBtn.addEventListener('click', () => togglePanel());
  $('close-comments').addEventListener('click', () => togglePanel(false));
  // Other panels close this one.
  for (const id of ['toggle-refs', 'toggle-suggestions']) {
    $(id).addEventListener('click', () => {
      panel.hidden = true;
      toggleBtn.setAttribute('aria-pressed', 'false');
    });
  }
  showResolved.addEventListener('change', render);

  // --- Highlight in the text ---
  const setHighlight = (meta) => editor.view.dispatch(editor.state.tr.setMeta(highlightKey, meta).setMeta('addToHistory', false));
  const openIds = () => new Set(threads.filter((th) => !th.resolvedAt).map((th) => th.id));

  function setActive(id, { scrollCard = false } = {}) {
    active = id;
    setHighlight({ active });
    list.querySelectorAll('.comment-thread').forEach((li) => li.classList.toggle('is-active', li.dataset.id === id));
    if (scrollCard && id) list.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function selectAnchor(id) {
    const range = commentRanges(editor.state.doc).get(id);
    if (!range) return;
    editor.chain().setTextSelection(range).scrollIntoView().run();
  }

  // Clicking commented text opens its thread, like Google Docs.
  editor.on('selectionUpdate', () => queueMicrotask(openThreadAtCursor));
  function openThreadAtCursor() {
    if (draft) return;
    const { from, empty } = editor.state.selection;
    if (!empty) return;
    const open = openIds();
    const $pos = editor.state.doc.resolve(from);
    const marks = [...($pos.nodeAfter?.marks || []), ...($pos.nodeBefore?.marks || [])];
    const hit = marks.find((m) => m.type.name === 'comment' && open.has(m.attrs.threadId));
    if (!hit) return;
    togglePanel(true);
    if (active !== hit.attrs.threadId) setActive(hit.attrs.threadId, { scrollCard: true });
  }

  // --- New comment ---
  const addBtn = document.querySelector('#toolbar button[data-cmd="comment"]');
  function updateAddButton() {
    addBtn.disabled = editor.state.selection.empty;
  }
  editor.on('selectionUpdate', updateAddButton);
  editor.on('transaction', updateAddButton);
  updateAddButton();

  function startComment() {
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      toast(t('Markiere zuerst den Text, den du kommentieren willst.'));
      return;
    }
    draft = { from, to, quote: editor.state.doc.textBetween(from, to, ' ', ' ').replace(/​/g, '').slice(0, 500) };
    setHighlight({ draft: { from, to }, active: null });
    togglePanel(true);
    render();
    list.querySelector('.comment-draft textarea')?.focus();
  }

  function cancelDraft() {
    draft = null;
    setHighlight({ draft: null });
    render();
    editor.commands.focus();
  }

  async function submitDraft(body) {
    const range = highlightKey.getState(editor.state).draft;
    const id = crypto.randomUUID();
    await api(base, { method: 'POST', body: { id, body, quote: draft.quote } });
    draft = null;
    // The anchor is not an edit: no undo step and no suggestion, also in suggestion mode.
    let tr = editor.state.tr.setMeta(highlightKey, { draft: null }).setMeta('addToHistory', false)
      .setMeta(suggestChangesKey, { skip: true });
    if (range) tr = tr.addMark(range.from, range.to, editor.schema.marks.comment.create({ threadId: id }));
    editor.view.dispatch(tr);
    active = id;
    await load();
  }

  // --- Actions ---
  const act = async (fn) => {
    try { await fn(); await load(); } catch (err) { toast(err.message); }
  };
  const resolve = (thread, resolved) => act(async () => {
    await api(`${base}/${thread.id}/resolve`, { method: 'POST', body: { resolved } });
    if (resolved) {
      if (active === thread.id) active = null;
      toast(t('Kommentar als erledigt markiert'), {
        actionLabel: t('Rückgängig'),
        onAction: () => act(() => api(`${base}/${thread.id}/resolve`, { method: 'POST', body: { resolved: false } })),
      });
    }
  });
  const remove = (comment, isThread) => act(async () => {
    await api(`${base}/${comment.id}`, { method: 'DELETE' });
    toast(t(isThread ? 'Kommentar gelöscht' : 'Antwort gelöscht'), {
      actionLabel: t('Rückgängig'),
      onAction: () => act(() => api(`${base}/${comment.id}/restore`, { method: 'POST' })),
    });
  });

  // --- Rendering ---
  function renderComment(thread, comment, index) {
    const isRoot = index === 0;
    const box = el('div', 'comment');
    const head = el('div', 'comment-head');
    const name = comment.author || t('Unbekannt');
    const who = el('div', 'comment-who');
    who.append(avatar(name), el('strong', '', name));
    const when = el('span', 'text-secondary small', formatTime(comment.createdAt) + (comment.editedAt ? ` · ${t('bearbeitet')}` : ''));
    who.append(when);
    head.append(who);

    const tools = el('div', 'comment-tools');
    if (isRoot && !thread.resolvedAt) {
      const done = iconButton('check', t('Erledigt'), 'btn-ghost-success');
      done.addEventListener('click', (e) => { e.stopPropagation(); resolve(thread, true); });
      tools.append(done);
    }
    if (comment.authorId === me.id) {
      const edit = iconButton('pencil', t('Bearbeiten'));
      edit.addEventListener('click', (e) => { e.stopPropagation(); editing = comment.id; render(); });
      tools.append(edit);
    }
    if (comment.authorId === me.id || canEdit) {
      const del = iconButton('trash', t(isRoot ? 'Kommentar löschen' : 'Antwort löschen'), 'btn-ghost-danger');
      del.addEventListener('click', (e) => { e.stopPropagation(); remove(comment, isRoot); });
      tools.append(del);
    }
    head.append(tools);
    box.append(head);

    if (editing === comment.id) {
      const { form, input } = textForm({
        key: `edit:${comment.id}`,
        placeholder: t('Kommentar'),
        submitLabel: t('Speichern'),
        value: comment.body,
        onSubmit: async (body) => {
          await api(`${base}/${comment.id}`, { method: 'PATCH', body: { body } });
          editing = null;
          await load();
        },
        onCancel: () => { editing = null; render(); },
      });
      box.append(form);
      requestAnimationFrame(() => input.focus());
    } else {
      box.append(el('div', 'comment-body', comment.body));
    }
    return box;
  }

  function renderThread(thread, anchored) {
    const li = el('li', 'comment-thread');
    li.dataset.id = thread.id;
    li.classList.toggle('is-active', thread.id === active);
    li.classList.toggle('is-resolved', !!thread.resolvedAt);
    if (thread.quote) {
      const quote = el('div', 'comment-quote', thread.quote);
      if (!anchored) quote.title = t('Der kommentierte Text ist nicht mehr im Dokument.');
      quote.classList.toggle('is-orphan', !anchored);
      li.append(quote);
    }
    thread.comments.forEach((c, i) => li.append(renderComment(thread, c, i)));
    if (thread.resolvedAt) {
      const row = el('div', 'comment-resolved small text-secondary');
      row.append(el('span', '', t('Erledigt von {name}', { name: thread.resolvedBy || t('Unbekannt') })));
      const reopen = el('button', 'btn btn-sm btn-ghost-primary', t('Wieder öffnen'));
      reopen.type = 'button';
      reopen.addEventListener('click', (e) => { e.stopPropagation(); resolve(thread, false); });
      row.append(reopen);
      li.append(row);
    } else {
      const { form } = textForm({
        key: `reply:${thread.id}`,
        placeholder: t('Antworten …'),
        submitLabel: t('Antworten'),
        onSubmit: async (body) => {
          await api(`${base}/${thread.id}/replies`, { method: 'POST', body: { body } });
          await load();
        },
      });
      form.classList.add('comment-reply');
      li.append(form);
    }
    li.addEventListener('click', (e) => {
      if (e.target.closest('button, textarea, form')) {
        if (active !== thread.id) setActive(thread.id);
        return;
      }
      setActive(thread.id);
      selectAnchor(thread.id);
    });
    return li;
  }

  function render() {
    const ranges = commentRanges(editor.state.doc);
    const open = threads.filter((th) => !th.resolvedAt);
    const count = $('comment-count');
    count.hidden = open.length === 0;
    count.textContent = String(open.length);

    // Document order; threads without anchor (text deleted or not yet saved) at the end.
    const order = [...ranges.keys()];
    const pos = (th) => (ranges.has(th.id) ? order.indexOf(th.id) : 1e9 + th.createdAt);
    const shown = threads.filter((th) => showResolved.checked || !th.resolvedAt).sort((a, b) => pos(a) - pos(b));

    const items = [];
    if (draft) {
      const li = el('li', 'comment-thread comment-draft is-active');
      if (draft.quote) li.append(el('div', 'comment-quote', draft.quote));
      const { form } = textForm({
        key: 'draft',
        placeholder: t('Kommentar hinzufügen …'),
        submitLabel: t('Kommentieren'),
        onSubmit: submitDraft,
        onCancel: cancelDraft,
      });
      li.append(form);
      items.push(li);
    }
    items.push(...shown.map((th) => renderThread(th, ranges.has(th.id))));
    if (!items.length) {
      items.push(el('li', 'text-secondary small', t(threads.length
        ? 'Keine offenen Kommentare.'
        : 'Noch keine Kommentare. Markiere Text und klicke auf „Kommentar“.')));
    }
    // Keep text and focus of every form while the list is rebuilt.
    const typed = new Map([...list.querySelectorAll('textarea')].filter((x) => x.value).map((x) => [x.dataset.key, x.value]));
    const focusedKey = list.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    list.replaceChildren(...items);
    for (const area of list.querySelectorAll('textarea')) {
      if (typed.has(area.dataset.key)) {
        area.value = typed.get(area.dataset.key);
        area.dispatchEvent(new Event('input'));
      }
      if (area.dataset.key === focusedKey) area.focus();
    }
    lastLayout = layoutOf();
  }

  // Order of anchored threads; the list only needs a rebuild when it changes.
  let lastLayout = '';
  const layoutOf = () => [...commentRanges(editor.state.doc).keys()].join();

  async function load() {
    threads = await api(base);
    if (active && !threads.some((th) => th.id === active && !th.resolvedAt)) active = null;
    setHighlight({ open: openIds(), active });
    render();
  }

  // Re-render when anchors move or disappear, at most once per frame.
  let scheduled = false;
  editor.on('update', () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (layoutOf() !== lastLayout) render();
    });
  });

  provider.on('stateless', ({ payload }) => {
    if (payload === 'comments') load().catch(() => {});
  });
  load().catch((err) => toast(err.message));

  return {
    start: startComment,
    threads: () => threads,
  };
}
