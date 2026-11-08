// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Citation node, numbering by first appearance and Vancouver-style reference formatting.
import { Node, mergeAttributes } from '@tiptap/core';
import { t } from './i18n.js';

/** Returns Map(refId -> number), numbered by first appearance in the document. */
export function numberCitations(doc) {
  const numbers = new Map();
  doc.descendants((node) => {
    if (node.type.name !== 'citation') return;
    for (const id of node.attrs.refIds) if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
  });
  return numbers;
}

/** Formats numbers like [1–3, 5]. Unknown references show as "?". */
export function citationLabel(refIds, numbers) {
  const nums = [...new Set(refIds.map((id) => numbers.get(id)).filter(Boolean))].sort((a, b) => a - b);
  if (!nums.length) return '[?]';
  const parts = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    parts.push(j - i >= 2 ? `${nums[i]}–${nums[j]}` : nums.slice(i, j + 1).join(', '));
    i = j;
  }
  return `[${parts.join(', ')}]`;
}

/** Vancouver style: up to six authors, then "et al.". */
export function formatReference(ref) {
  const names = (ref.authors || []).map((a) => {
    const given = a.given || '';
    // PubMed already delivers initials ("ZB"); Crossref delivers given names ("Yann").
    const initials = /^[A-Z]{1,4}$/.test(given)
      ? given
      : given.split(/[\s.-]+/).filter(Boolean).map((p) => p[0].toUpperCase()).join('');
    return `${a.family} ${initials}`.trim();
  });
  const authors = names.length > 6 ? `${names.slice(0, 6).join(', ')}, et al.` : names.join(', ');
  let src = ref.journal ? `${ref.journal}.` : '';
  if (ref.year) src += ` ${ref.year}`;
  if (ref.volume) src += `;${ref.volume}`;
  if (ref.issue) src += `(${ref.issue})`;
  if (ref.pages) src += `:${ref.pages}`;
  const parts = [authors && `${authors.replace(/\.$/, '')}.`, ref.title && `${ref.title.replace(/\.$/, '')}.`, src && `${src.trim()}.`];
  if (ref.doi) parts.push(`doi:${ref.doi}`);
  return parts.filter(Boolean).join(' ');
}

/** Short label for lists: "Smith 2021 – Title". */
export function shortReference(ref) {
  const first = ref.authors?.[0]?.family || t('o. A.');
  const etal = (ref.authors?.length || 0) > 1 ? ' et al.' : '';
  return `${first}${etal} ${ref.year || ''} – ${ref.title || ''}`;
}

/**
 * Inline atom node holding one or more reference ids. The label is set from outside
 * via renumber(), because it depends on the whole document.
 */
export const Citation = Node.create({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      refIds: {
        default: [],
        parseHTML: (el) => (el.getAttribute('data-refs') || '').split(',').filter(Boolean),
        renderHTML: (attrs) => ({ 'data-refs': attrs.refIds.join(',') }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-citation]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-citation': '', class: 'citation' }), '[?]'];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.className = 'citation';
      dom.dataset.citation = '';
      dom.dataset.refs = node.attrs.refIds.join(',');
      dom.textContent = '[…]';
      return { dom, ignoreMutation: () => true };
    };
  },

  addKeyboardShortcuts() {
    return { 'Mod-Shift-l': () => { this.editor.emit('openCitationDialog'); return true; } };
  },
});

/** Updates all citation labels in the editor DOM. */
export function renumber(editor) {
  const numbers = numberCitations(editor.state.doc);
  editor.view.dom.querySelectorAll('span.citation').forEach((el) => {
    el.textContent = citationLabel((el.dataset.refs || '').split(',').filter(Boolean), numbers);
  });
  return numbers;
}
