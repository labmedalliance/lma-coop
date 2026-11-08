// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citationLabel, formatReference, numberCitations } from '../client/src/citations.js';
import { parseIdentifier } from '../server/cite.js';

// Minimal stand-in for a ProseMirror doc: descendants() walks citation nodes in order.
const fakeDoc = (...groups) => ({
  descendants: (fn) => groups.forEach((refIds) => fn({ type: { name: 'citation' }, attrs: { refIds } })),
});

test('numbers references by first appearance', () => {
  const numbers = numberCitations(fakeDoc(['b'], ['a', 'b'], ['c']));
  assert.deepEqual([...numbers], [['b', 1], ['a', 2], ['c', 3]]);
});

test('compresses ranges in labels', () => {
  const n = new Map([['a', 1], ['b', 2], ['c', 3], ['d', 5], ['e', 6]]);
  assert.equal(citationLabel(['a', 'b', 'c', 'd'], n), '[1–3, 5]');
  assert.equal(citationLabel(['d', 'e'], n), '[5, 6]');
  assert.equal(citationLabel(['x'], n), '[?]');
});

test('formats Vancouver style with et al. after six authors', () => {
  const authors = 'ABCDEFG'.split('').map((c) => ({ family: `Name${c}`, given: 'Anna Maria' }));
  const s = formatReference({ authors, title: 'A title.', journal: 'Clin Chem Lab Med', year: '2020', volume: '58', issue: '3', pages: '1-9', doi: '10.1/x' });
  assert.equal(s, 'NameA AM, NameB AM, NameC AM, NameD AM, NameE AM, NameF AM, et al. A title. Clin Chem Lab Med. 2020;58(3):1-9. doi:10.1/x');
});

test('keeps PubMed initials', () => {
  assert.match(formatReference({ authors: [{ family: 'Khalesi', given: 'ZB' }], title: 'T' }), /^Khalesi ZB\./);
});

test('parses DOI and PMID input variants', () => {
  assert.deepEqual(parseIdentifier('https://doi.org/10.1038/nature14539'), { type: 'doi', id: '10.1038/nature14539' });
  assert.deepEqual(parseIdentifier('doi: 10.1038/nature14539'), { type: 'doi', id: '10.1038/nature14539' });
  assert.deepEqual(parseIdentifier('PMID: 30645195'), { type: 'pmid', id: '30645195' });
  assert.equal(parseIdentifier('hello'), null);
});
