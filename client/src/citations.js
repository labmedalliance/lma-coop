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

/** Reference types for manual entry. Entries without `type` (DOI/PMID lookups) are journal articles. */
export const REFERENCE_TYPES = ['article', 'book', 'chapter', 'web', 'conference', 'report', 'thesis'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-13" -> "2026 Nov 13", as NLM writes dates. Other input stays as typed. */
export function vancouverDate(value) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(value || '').trim());
  if (!m) return String(value || '').trim();
  return [m[1], MONTHS[Number(m[2]) - 1], m[3] && String(Number(m[3]))].filter(Boolean).join(' ');
}

/** "2" -> "2nd ed."; text the user typed in full ("2nd ed.", "Rev. ed.") stays. */
function edition(value) {
  const v = String(value || '').trim();
  if (!/^\d+$/.test(v)) return v;
  const n = Number(v);
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return `${n}${suffix} ed.`;
}

/** Name as Vancouver wants it: family name plus initials ("Cadamuro J"). Organizations have no given name. */
function vancouverName(a) {
  const given = a.given || '';
  // PubMed already delivers initials ("ZB"); Crossref and manual entry deliver given names ("Yann").
  const initials = /^[A-Z]{1,4}$/.test(given)
    ? given
    : given.split(/[\s.-]+/).filter(Boolean).map((p) => p[0].toUpperCase()).join('');
  return `${a.family || ''} ${initials}`.trim();
}

/** Up to six names, then "et al.". */
function nameList(people) {
  const names = (people || []).map(vancouverName).filter(Boolean);
  return names.length > 6 ? `${names.slice(0, 6).join(', ')}, et al.` : names.join(', ');
}

function editorList(people) {
  const names = nameList(people);
  if (!names) return '';
  return `${names.replace(/\.$/, '')}, ${people.length > 1 ? 'editors' : 'editor'}`;
}

/** Ends a segment with a period unless it already ends with . ? or !. */
const sentence = (s) => (s ? (/[.?!]$/.test(s) ? s : `${s}.`) : '');
const trim = (v) => String(v || '').trim();

/** "Place: Publisher; Year" with whatever parts exist. */
function imprint(ref, year = trim(ref.year)) {
  const place = trim(ref.place);
  const publisher = trim(ref.publisher);
  const who = place && publisher ? `${place}: ${publisher}` : place || publisher;
  return [who, year].filter(Boolean).join('; ');
}

/** Vancouver style (NLM Citing Medicine) for all reference types. */
export function formatReference(ref) {
  const type = ref.type || 'article';
  const title = trim(ref.title);
  const parts = [];
  const add = (...segments) => parts.push(...segments.map((s) => sentence(trim(s))));
  const authors = nameList(ref.authors);
  const editors = editorList(ref.editors);

  if (type === 'article') {
    let src = trim(ref.journal) ? `${trim(ref.journal)}.` : '';
    if (ref.year) src += ` ${ref.year}`;
    if (ref.volume) src += `;${ref.volume}`;
    if (ref.issue) src += `(${ref.issue})`;
    if (ref.pages) src += `:${ref.pages}`;
    add(authors, title, src);
  } else if (type === 'book') {
    // A book with only editors puts them first; with authors, the editors follow the title.
    add(authors || editors, title, edition(ref.edition), authors && editors, imprint(ref));
  } else if (type === 'chapter' || type === 'conference') {
    const inPart = editors ? `In: ${editors}. ${trim(ref.bookTitle)}` : trim(ref.bookTitle) && `In: ${trim(ref.bookTitle)}`;
    // A talk without proceedings: "Paper presented at: Meeting; Date; Place."
    const meeting = type === 'conference'
      ? [!inPart && trim(ref.conference) && `Paper presented at: ${trim(ref.conference)}`,
        vancouverDate(ref.confDate), trim(ref.confPlace)].filter(Boolean)
      : [];
    const book = [inPart, ...meeting].filter(Boolean).join('; ');
    add(authors, title, book, type === 'chapter' && edition(ref.edition), imprint(ref), trim(ref.pages) && `p. ${trim(ref.pages)}`);
  } else if (type === 'web') {
    const dates = [ref.updated && `updated ${vancouverDate(ref.updated)}`, ref.accessed && `cited ${vancouverDate(ref.accessed)}`]
      .filter(Boolean).join('; ');
    const when = [trim(ref.year), dates && `[${dates}]`].filter(Boolean).join(' ');
    add(authors, title && `${title.replace(/\.$/, '')} [Internet]`, imprint(ref, when));
  } else if (type === 'report') {
    add(authors, title, editors, imprint(ref), trim(ref.reportNo) && `Report No.: ${trim(ref.reportNo)}`);
  } else if (type === 'thesis') {
    add(authors, title && `${title.replace(/\.$/, '')} [${trim(ref.thesisType) || 'dissertation'}]`, imprint(ref));
  }

  const text = parts.filter(Boolean);
  if (trim(ref.doi)) text.push(`doi:${trim(ref.doi)}`);
  if (trim(ref.url) && !trim(ref.doi)) text.push(`Available from: ${trim(ref.url)}`);
  return text.join(' ');
}

/** "Cadamuro J" / "Cadamuro, Janne" / "World Health Organization", one per line -> [{family, given}]. */
export function parseNames(text) {
  return String(text || '').split(/\n|;/).map((line) => line.trim()).filter(Boolean).map((line) => {
    if (line.includes(',')) {
      const [family, ...rest] = line.split(',');
      return { family: family.trim(), given: rest.join(',').trim() };
    }
    const tokens = line.split(/\s+/);
    if (tokens.length > 1 && /^[A-ZÄÖÜ]{1,4}$/.test(tokens.at(-1))) {
      return { family: tokens.slice(0, -1).join(' '), given: tokens.at(-1) };
    }
    return { family: line, given: '' }; // organization or single name
  });
}

/** Inverse of parseNames, for editing. Full given names keep the comma form. */
export function formatNames(people) {
  return (people || []).map((a) => {
    if (!a.given) return a.family;
    return /^[A-Z]{1,4}$/.test(a.given) ? `${a.family} ${a.given}` : `${a.family}, ${a.given}`;
  }).join('\n');
}

/** Short label for lists: "Smith 2021 – Title". */
export function shortReference(ref) {
  const first = ref.authors?.[0]?.family || ref.editors?.[0]?.family || t('o. A.');
  const count = ref.authors?.length || ref.editors?.length || 0;
  const etal = count > 1 ? ' et al.' : '';
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
