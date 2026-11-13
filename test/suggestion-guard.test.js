// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Simulates a "suggest only" client: real suggestion transactions must pass the server check,
// direct edits must be rejected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { updateYFragment } from '@tiptap/y-tiptap';
import {
  suggestChanges, enableSuggestChanges, transformToSuggestionTransaction, applySuggestions,
} from '@handlewithcare/prosemirror-suggest-changes';
import { schemaExtensions } from '../client/src/schema.js';
import { suggestionIdFor, nodeMarksSyncPlugin } from '../client/src/suggestions.js';
import { wrapInList } from '@tiptap/pm/schema-list';
import { isSuggestionOnly, syncedContent as revertedSource } from '../server/suggestion-guard.js';

const schema = getSchema(schemaExtensions);
const genId = suggestionIdFor(7);

/** A client whose ProseMirror state is mirrored into its own Y.Doc; returns the Yjs update per change. */
function setup(extra = []) {
  const doc = schema.nodeFromJSON({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
      ...extra,
    ],
  });
  const client = new Y.Doc();
  const meta = { mapping: new Map(), isOMark: new Map() };
  updateYFragment(client, client.getXmlFragment('default'), doc, meta);
  client.getMap('references').set('r1', { title: 'Deep learning' });
  const server = new Y.Doc();
  Y.applyUpdate(server, Y.encodeStateAsUpdate(client));

  let state = EditorState.create({ doc, plugins: [suggestChanges(), nodeMarksSyncPlugin()] });
  enableSuggestChanges(state, (tr) => { state = state.apply(tr); });

  const commit = (newState) => {
    let update = null;
    const capture = (u) => { update = update ? Y.mergeUpdates([update, u]) : u; };
    client.on('update', capture);
    updateYFragment(client, client.getXmlFragment('default'), newState.doc, meta);
    client.off('update', capture);
    state = newState;
    return update;
  };
  const suggest = (build) => {
    const tr = build(state.tr);
    return commit(state.apply(transformToSuggestionTransaction(tr, state, genId)));
  };
  const direct = (build) => commit(state.apply(build(state.tr)));
  const check = (update) => {
    const ok = isSuggestionOnly(server, update);
    if (ok) Y.applyUpdate(server, update);
    return ok;
  };
  return { client, server, suggest, direct, check, getState: () => state };
}

test('accepts suggested insertions, deletions, paragraph splits and formatting', () => {
  const c = setup();
  assert.equal(c.check(c.suggest((tr) => tr.insertText(' big', 13))), true, 'insertion');
  assert.equal(c.check(c.suggest((tr) => tr.delete(9, 12))), true, 'deletion');
  assert.equal(c.check(c.suggest((tr) => tr.split(11))), true, 'paragraph split');
  assert.equal(c.check(c.suggest((tr) => tr.addMark(2, 5, schema.marks.bold.create()))), true, 'bold');
  assert.equal(c.check(c.suggest((tr) => tr.setNodeMarkup(0, null, { level: 2 }))), true, 'heading level');
});

test('accepts block-level suggestions', () => {
  const P = (t) => schema.node('paragraph', null, schema.text(t));
  let c = setup();
  assert.equal(c.check(c.suggest((tr) => tr.setNodeMarkup(7, null, { textAlign: 'center' }))), true, 'align');
  c = setup();
  assert.equal(c.check(c.suggest((tr) => tr.insert(7, [P('New one'), P('New two')]))), true, 'insert paragraphs');
  c = setup();
  assert.equal(c.check(c.suggest((tr) => tr.delete(7, tr.doc.content.size))), true, 'delete paragraph');
});

test('rejects suggestions the library cannot revert (lists, quotes, tables)', () => {
  const c = setup();
  assert.equal(c.check(c.suggest((tr) => {
    let out;
    const state = EditorState.create({ doc: tr.doc, selection: TextSelection.create(tr.doc, 9) });
    wrapInList(schema.nodes.bulletList)(state, (t) => { out = t; });
    return tr.step(out.steps[0]);
  })), false);
});

test('a second client sees block-level suggestions', () => {
  const c = setup();
  c.check(c.suggest((tr) => tr.setNodeMarkup(0, null, { level: 2 })));
  let marks = 0;
  revertedSource(c.server).descendants((n) => { if (!n.isInline && n.marks.length) marks++; });
  assert.equal(marks, 1);
});

test('rejects direct edits', () => {
  const c = setup();
  assert.equal(c.check(c.direct((tr) => tr.insertText('X', 9))), false);
});

test('rejects accepting suggestions', () => {
  const c = setup();
  assert.equal(c.check(c.suggest((tr) => tr.insertText(' big', 13))), true);
  let accepted = c.getState();
  applySuggestions(accepted, (tr) => { accepted = accepted.apply(tr); });
  assert.equal(c.check(c.direct((tr) => tr.replaceWith(0, tr.doc.content.size, accepted.doc.content))), false);
});

test('allows adding but not removing references', () => {
  const c = setup();
  let update;
  c.client.once('update', (u) => { update = u; });
  c.client.getMap('references').set('r2', { title: 'New' });
  assert.equal(c.check(update), true);
  c.client.once('update', (u) => { update = u; });
  c.client.getMap('references').delete('r1');
  assert.equal(c.check(update), false);
});

test('rejects editing an existing reference', () => {
  const c = setup();
  let update;
  c.client.once('update', (u) => { update = u; });
  c.client.getMap('references').set('r1', { title: 'Changed' });
  assert.equal(c.check(update), false);
});

test('allows comment anchors in suggestion mode, but no text change with them', () => {
  const c = setup();
  const anchor = (id) => schema.marks.comment.create({ threadId: id });
  assert.equal(c.check(c.direct((tr) => tr.addMark(9, 14, anchor('t1')))), true, 'add anchor');
  assert.equal(c.check(c.direct((tr) => tr.addMark(10, 12, anchor('t2')))), true, 'overlapping anchor');
  assert.equal(c.check(c.direct((tr) => tr.removeMark(9, 14, anchor('t1')))), true, 'remove anchor');
  assert.equal(c.check(c.direct((tr) => tr.addMark(2, 5, anchor('t3')).insertText('X', 3))), false, 'text change');
});

const IMG = '/api/docs/00000000-0000-4000-8000-000000000000/images/11111111-1111-4111-8111-111111111111';

test('accepts suggested images (insert, delete) but not direct ones', () => {
  const image = () => schema.nodes.image.create({ src: IMG, alt: 'Figure 1' });
  const imagePara = { type: 'paragraph', content: [{ type: 'image', attrs: { src: IMG } }] };
  for (const [name, pos] of [['middle of text', 9], ['end of document', 13]]) {
    const c = setup();
    assert.equal(c.check(c.suggest((tr) => tr.insert(pos, image()))), true, `suggest new image: ${name}`);
    let marks = 0;
    revertedSource(c.server).descendants((n) => { if (n.type.name === 'image' && n.marks.length) marks++; });
    assert.equal(marks, 1, 'the second client sees the image as suggestion');
  }
  const c = setup([imagePara]);
  const size = c.getState().doc.content.size;
  assert.equal(c.check(c.suggest((tr) => tr.delete(size - 2, size - 1))), true, 'suggest deleting the last image');
  assert.equal(c.check(c.suggest((tr) => tr.insert(9, image()))), true, 'suggest a second image');
  assert.equal(c.check(c.direct((tr) => tr.insert(3, image()))), false, 'direct image insert');
});

test('rejects direct changes to image size or description', () => {
  const c = setup([{ type: 'paragraph', content: [{ type: 'image', attrs: { src: IMG } }] }]);
  const pos = c.getState().doc.content.size - 2;
  assert.equal(c.check(c.direct((tr) => tr.setNodeAttribute(pos, 'width', 50))), false);
});
