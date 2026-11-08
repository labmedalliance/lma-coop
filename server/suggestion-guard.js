// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Server-side check that a "suggest only" user changes nothing but suggestions.
//
// Rule: after reverting all suggestions, the document must look exactly as before the update.
// So the user may add or withdraw suggestions, but may not change the accepted text, accept a
// suggestion or edit formatting directly. In the reference list they may only add entries.
import * as Y from 'yjs';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { yXmlFragmentToProsemirror } from '@tiptap/y-tiptap';
import { schemaExtensions } from '../client/src/schema.js';
import { syncNodeMarks, onlySuggestionsChanged } from '../client/src/suggestions.js';

const schema = getSchema(schemaExtensions);

function copyDoc(ydoc) {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(ydoc));
  return copy;
}

/** The document as editors see it, with block-level suggestion marks restored from the mirror attribute. */
export function syncedContent(ydoc) {
  const doc = yXmlFragmentToProsemirror(schema, ydoc.getXmlFragment('default'));
  const state = EditorState.create({ doc });
  return state.apply(syncNodeMarks(state.doc, state.tr, true)).doc;
}

function referencesOnlyAdded(before, after) {
  const a = before.getMap('references');
  const b = after.getMap('references');
  for (const [key, value] of a.entries()) {
    if (!b.has(key) || JSON.stringify(b.get(key)) !== JSON.stringify(value)) return false;
  }
  return true;
}

/** Returns true if applying `update` to `ydoc` only adds or withdraws suggestions. */
export function isSuggestionOnly(ydoc, update) {
  const before = copyDoc(ydoc);
  const after = copyDoc(ydoc);
  try {
    Y.applyUpdate(after, update);
    return referencesOnlyAdded(before, after) && onlySuggestionsChanged(syncedContent(before), syncedContent(after));
  } catch {
    return false;
  }
}
