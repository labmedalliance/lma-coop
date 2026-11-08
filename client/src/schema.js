// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Document schema shared by the editor (browser) and the suggestion check (server).
import StarterKit from '@tiptap/starter-kit';
import Document from '@tiptap/extension-document';
import Blockquote from '@tiptap/extension-blockquote';
import { BulletList, OrderedList, ListItem } from '@tiptap/extension-list';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { Citation } from './citations.js';
import { ImageNode } from './image-node.js';
import { CommentMark } from './comment-mark.js';
import { SuggestionMarks, SuggestionNodeMarksAttr } from './suggestions.js';

// Block containers must allow suggestion marks on their children (e.g. a suggested new list item).
const allowSuggestions = (node) => node.extend({ marks: 'insertion deletion modification' });

export const schemaExtensions = [
  StarterKit.configure({
    undoRedo: false,
    document: false,
    blockquote: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    link: { openOnClick: false, autolink: true },
  }),
  ...[Document, Blockquote, BulletList, OrderedList, ListItem].map(allowSuggestions),
  ...[Table.configure({ resizable: false }), TableRow, TableCell, TableHeader].map(allowSuggestions),
  Subscript,
  Superscript,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Citation,
  ImageNode,
  CommentMark,
  ...SuggestionMarks,
  SuggestionNodeMarksAttr,
];
