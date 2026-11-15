// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Formatting that comes in from Word: text colour, highlight, and table cell background and borders.
// Shared by browser and server via schema.js. Only content from this editor (data-* attributes) is parsed
// back from HTML, so text pasted from web pages does not bring its colours along.
import { Mark } from '@tiptap/core';
import { TableCell, TableHeader } from '@tiptap/extension-table';

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (value) => (HEX.test(value || '') ? value.toLowerCase() : null);

/** Text colour as hex "#rrggbb". */
export const TextColor = Mark.create({
  name: 'textColor',
  addAttributes: () => ({
    color: {
      default: null,
      parseHTML: (el) => hex(el.getAttribute('data-color')),
      renderHTML: (attrs) => (attrs.color ? { 'data-color': attrs.color, style: `color: ${attrs.color}` } : {}),
    },
  }),
  parseHTML: () => [{ tag: 'span[data-color]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0],
});

/** Highlight (Word's text highlight or run shading) as hex "#rrggbb". */
export const Highlight = Mark.create({
  name: 'highlight',
  addAttributes: () => ({
    color: {
      default: '#ffff00',
      parseHTML: (el) => hex(el.getAttribute('data-highlight')) || '#ffff00',
      renderHTML: (attrs) => ({ 'data-highlight': attrs.color, style: `background-color: ${attrs.color}` }),
    },
  }),
  parseHTML: () => [{ tag: 'mark[data-highlight]' }],
  renderHTML: ({ HTMLAttributes }) => ['mark', HTMLAttributes, 0],
});

/**
 * Cell attributes: `background` (hex) and `borders`, the sides with a line ("t", "r", "b", "l" in any
 * combination, "" for none). null means the editor's default grid.
 */
const cellAttributes = {
  background: {
    default: null,
    parseHTML: (el) => hex(el.getAttribute('data-background')),
    renderHTML: (attrs) => (attrs.background
      ? { 'data-background': attrs.background, style: `background-color: ${attrs.background}` } : {}),
  },
  borders: {
    default: null,
    parseHTML: (el) => (el.hasAttribute('data-borders') ? el.getAttribute('data-borders').replace(/[^trbl]/g, '') : null),
    renderHTML: (attrs) => (attrs.borders === null || attrs.borders === undefined ? {} : { 'data-borders': attrs.borders || '-' }),
  },
};

export const FormattedTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttributes };
  },
});

export const FormattedTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttributes };
  },
});
