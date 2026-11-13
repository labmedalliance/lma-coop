// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Suggestion mode ("Änderungen vorschlagen") on top of @handlewithcare/prosemirror-suggest-changes.
import { Extension, Mark } from '@tiptap/core';
import { EditorState, Plugin } from '@tiptap/pm/state';
import {
  insertion, deletion, modification, suggestChanges, suggestChangesKey, isSuggestChangesEnabled,
  transformToSuggestionTransaction, revertSuggestions,
} from '@handlewithcare/prosemirror-suggest-changes';
import { t } from './i18n.js';
import { stripCommentMarks } from './comment-mark.js';

const SUGGESTION_MARKS = { insertion, deletion, modification };

const jsonAttr = (name, fallback = null) => ({
  default: fallback,
  rendered: false,
  parseHTML: (el) => {
    const raw = el.getAttribute(name);
    try { return raw === null ? fallback : JSON.parse(raw); } catch { return raw; }
  },
});

/**
 * The library's insertion/deletion/modification marks as TipTap marks (same names, attrs and
 * exclusions). Shared by browser and server via schema.js.
 */
export const SuggestionMarks = [
  Mark.create({
    name: 'insertion',
    inclusive: false,
    excludes: insertion.excludes,
    addAttributes: () => ({ id: jsonAttr('data-id') }),
    parseHTML: () => [{ tag: 'ins[data-id]' }],
    renderHTML: ({ mark }) => ['ins', { 'data-id': JSON.stringify(mark.attrs.id), title: t('Vorgeschlagene Einfügung') }, 0],
  }),
  Mark.create({
    name: 'deletion',
    inclusive: false,
    excludes: deletion.excludes,
    addAttributes: () => ({ id: jsonAttr('data-id') }),
    parseHTML: () => [{ tag: 'del[data-id]' }],
    renderHTML: ({ mark }) => ['del', { 'data-id': JSON.stringify(mark.attrs.id), title: t('Vorgeschlagene Löschung') }, 0],
  }),
  Mark.create({
    name: 'modification',
    inclusive: false,
    excludes: modification.excludes,
    addAttributes: () => ({
      id: jsonAttr('data-id'),
      type: jsonAttr('data-mod-type'),
      attrName: jsonAttr('data-mod-attr'),
      previousValue: jsonAttr('data-mod-prev-val'),
      newValue: jsonAttr('data-mod-new-val'),
    }),
    parseHTML: () => [{ tag: 'span[data-type="modification"]' }, { tag: 'div[data-type="modification"]' }],
    renderHTML: ({ mark }) => ['span', {
      'data-type': 'modification',
      'data-id': JSON.stringify(mark.attrs.id),
      title: t('Vorgeschlagene Formatänderung'),
    }, 0],
  }),
];

// Yjs (y-tiptap) only syncs marks on text, not on other nodes. Block-level suggestions (deleted
// paragraph, new list item, heading change) and suggested images are therefore mirrored into this
// node attribute.
const NODE_MARKS_ATTR = 'suggestionMarks';
const BLOCK_TYPES = ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem',
  'table', 'tableRow', 'tableCell', 'tableHeader', 'codeBlock', 'horizontalRule', 'image'];
const isSuggestionMark = (mark) => mark.type.name in SUGGESTION_MARKS;

export const SuggestionNodeMarksAttr = Extension.create({
  name: 'suggestionNodeMarksAttr',
  addGlobalAttributes: () => [{
    types: BLOCK_TYPES,
    attributes: { [NODE_MARKS_ATTR]: { default: null, rendered: false, keepOnSplit: false } },
  }],
});

/**
 * Adds steps to `tr` that bring block-node suggestion marks and the mirror attribute in line.
 * fromRemote = true: the attribute (synced via Yjs) wins; otherwise the marks win.
 */
export function syncNodeMarks(doc, tr, fromRemote) {
  const { schema } = doc.type;
  doc.descendants((node, pos) => {
    if (node.isText || !(NODE_MARKS_ATTR in node.attrs)) return true;
    const own = node.marks.filter(isSuggestionMark).map((m) => m.toJSON());
    const stored = node.attrs[NODE_MARKS_ATTR] || [];
    if (JSON.stringify(own) === JSON.stringify(stored)) return true;
    if (fromRemote) {
      const marks = [...node.marks.filter((m) => !isSuggestionMark(m)), ...stored.map((j) => schema.markFromJSON(j))];
      tr.setNodeMarkup(tr.mapping.map(pos), null, node.attrs, marks);
    } else {
      tr.setNodeAttribute(tr.mapping.map(pos), NODE_MARKS_ATTR, own.length ? own : null);
    }
    return true;
  });
  return tr;
}

/** Removes the mirror attribute everywhere (used before comparing documents). */
export function stripNodeMarksAttr(doc, tr) {
  doc.descendants((node, pos) => {
    if (node.attrs?.[NODE_MARKS_ATTR]) tr.setNodeAttribute(pos, NODE_MARKS_ATTR, null);
    return true;
  });
  return tr;
}

const revertCache = new WeakMap();

/**
 * The document with all suggestions reverted, without the mirror attribute and without comment anchors —
 * the "accepted text". Comment anchors are left out, so every role may comment.
 * Returns null if the library cannot revert the suggestions.
 */
export function revertDoc(doc) {
  if (revertCache.has(doc)) return revertCache.get(doc);
  let result = null;
  try {
    let state = EditorState.create({ doc });
    revertSuggestions(state, (tr) => { state = state.apply(tr); });
    state = state.apply(stripNodeMarksAttr(state.doc, state.tr));
    result = state.apply(stripCommentMarks(state.doc, state.tr)).doc;
  } catch {
    result = null;
  }
  revertCache.set(doc, result);
  return result;
}

/** True if `after` differs from `before` only in suggestions (same rule as the server). */
export function onlySuggestionsChanged(before, after) {
  const a = revertDoc(before);
  const b = revertDoc(after);
  return !!a && !!b && a.eq(b);
}

/** Plugin that keeps block-node suggestion marks and their Yjs mirror attribute in sync. */
export function nodeMarksSyncPlugin() {
  return new Plugin({
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((t) => t.docChanged)) return null;
      const fromRemote = transactions.some((t) => (t.getMeta('y-sync$') ?? {}).isChangeOrigin);
      const tr = syncNodeMarks(newState.doc, newState.tr, fromRemote);
      if (!tr.docChanged) return null;
      return tr.setMeta('addToHistory', false).setMeta(suggestChangesKey, { skip: true });
    },
  });
}

/**
 * Editor behaviour: when suggestion mode is on, local edits are turned into suggestions.
 * Option `generateId` creates ids that encode the author (see suggestionAuthor()).
 */
export const SuggestChanges = Extension.create({
  name: 'suggestChanges',
  addOptions: () => ({ generateId: undefined }),
  addProseMirrorPlugins: () => [suggestChanges(), nodeMarksSyncPlugin()],
  dispatchTransaction({ transaction, next }) {
    const state = this.editor.state;
    const ySync = transaction.getMeta('y-sync$') ?? {};
    const skip = 'skip' in (transaction.getMeta(suggestChangesKey) ?? {});
    if (transaction.docChanged && isSuggestChangesEnabled(state) && !ySync.isChangeOrigin
      && !ySync.isUndoRedoOperation && !skip) {
      let tracked = null;
      try {
        tracked = transformToSuggestionTransaction(transaction, state, this.options.generateId);
      } catch {
        tracked = null;
      }
      // Drop changes that cannot be represented as a clean suggestion (the server would reject them).
      if (!tracked || !onlySuggestionsChanged(state.doc, state.apply(tracked).doc)) {
        this.editor.emit('suggestionBlocked');
        return;
      }
      next(tracked);
      return;
    }
    next(transaction);
  },
});

/** Suggestion ids look like "u12x4f9a1c": author user id 12 plus a random part. */
export function suggestionIdFor(userId) {
  return () => `u${userId}x${Math.random().toString(36).slice(2, 10)}`;
}

export function suggestionAuthor(id) {
  const match = /^u(\d+)x/.exec(String(id));
  return match ? Number(match[1]) : null;
}

/** Tracked changes imported from Word without a matching account keep the Word author: "w|<name>|<random>". */
export function suggestionAuthorName(id) {
  const match = /^w\|([^|]*)\|/.exec(String(id));
  try { return match ? decodeURIComponent(match[1]) || null : null; } catch { return null; }
}

/**
 * Lists all suggestions in document order:
 * [{ id, authorId, authorName, inserted, deleted, modified, from }]. Zero-width spaces used for paragraph breaks are dropped.
 */
export function collectSuggestions(doc) {
  const byId = new Map();
  doc.descendants((node, pos) => {
    for (const mark of node.marks) {
      if (!(mark.type.name in SUGGESTION_MARKS)) continue;
      const id = mark.attrs.id;
      if (!byId.has(id)) {
        byId.set(id, { id, authorId: suggestionAuthor(id), authorName: suggestionAuthorName(id), inserted: '', deleted: '', modified: false, from: pos });
      }
      const entry = byId.get(id);
      const text = node.type.name === 'image' ? `[${t('Bild')}]` : (node.isText ? node.text : node.textContent).replace(/​/g, '');
      if (mark.type.name === 'insertion') entry.inserted += text || (node.isBlock ? '¶' : '');
      else if (mark.type.name === 'deletion') entry.deleted += text || (node.isBlock ? '¶' : '');
      else entry.modified = true;
    }
  });
  return [...byId.values()];
}
