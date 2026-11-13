// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citationLabel, formatReference, numberCitations, parseNames, formatNames, vancouverDate } from '../client/src/citations.js';
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

const authors = [{ family: 'Cadamuro', given: 'Janne' }, { family: 'Simundic', given: 'AM' }];
const publisher = { place: 'St. Louis', publisher: 'Elsevier', year: '2023' };

test('formats a book with authors, edition and editors', () => {
  assert.equal(formatReference({ type: 'book', authors, title: 'Labmedizin', edition: '2', place: 'Berlin', publisher: 'Springer', year: '2019' }),
    'Cadamuro J, Simundic AM. Labmedizin. 2nd ed. Berlin: Springer; 2019.');
  assert.equal(formatReference({ type: 'book', editors: [{ family: 'Rifai', given: 'N' }], title: 'Tietz textbook', edition: '7', ...publisher }),
    'Rifai N, editor. Tietz textbook. 7th ed. St. Louis: Elsevier; 2023.');
});

test('formats a book chapter', () => {
  const ref = { type: 'chapter', authors, title: 'Preanalytics', editors: [{ family: 'Rifai', given: 'N' }, { family: 'Horvath', given: 'AR' }],
    bookTitle: 'Tietz textbook', edition: '11', ...publisher, pages: '45-67' };
  assert.equal(formatReference(ref),
    'Cadamuro J, Simundic AM. Preanalytics. In: Rifai N, Horvath AR, editors. Tietz textbook. 11th ed. St. Louis: Elsevier; 2023. p. 45-67.');
});

test('formats a web page with cited date and URL', () => {
  const ref = { type: 'web', authors: parseNames('World Health Organization'), title: 'Laboratory quality', place: 'Geneva',
    publisher: 'WHO', year: '2024', updated: '2025-01-05', accessed: '2026-11-13', url: 'https://who.int/x' };
  assert.equal(formatReference(ref),
    'World Health Organization. Laboratory quality [Internet]. Geneva: WHO; 2024 [updated 2025 Jan 5; cited 2026 Nov 13]. Available from: https://who.int/x');
});

test('formats conference papers, reports and theses', () => {
  assert.equal(formatReference({ type: 'conference', authors, title: 'Talk', conference: 'EuroMedLab 2025', confDate: '2025 May 18-22', confPlace: 'Brussels' }),
    'Cadamuro J, Simundic AM. Talk. Paper presented at: EuroMedLab 2025; 2025 May 18-22; Brussels.');
  assert.equal(formatReference({ type: 'report', authors, title: 'Report', place: 'Vienna', publisher: 'BMG', year: '2022', reportNo: '12/2022' }),
    'Cadamuro J, Simundic AM. Report. Vienna: BMG; 2022. Report No.: 12/2022.');
  assert.equal(formatReference({ type: 'thesis', authors: authors.slice(0, 1), title: 'Why?', place: 'Salzburg', publisher: 'PMU', year: '2010' }),
    'Cadamuro J. Why? [dissertation]. Salzburg: PMU; 2010.');
});

test('prefers the DOI over the URL', () => {
  assert.equal(formatReference({ type: 'web', title: 'T', url: 'https://x.org', doi: '10.1/y' }), 'T [Internet]. doi:10.1/y');
});

test('parses and formats name lines', () => {
  const names = parseNames('Cadamuro J\nSimundic, Ana-Maria\nWorld Health Organization\n\n');
  assert.deepEqual(names, [
    { family: 'Cadamuro', given: 'J' },
    { family: 'Simundic', given: 'Ana-Maria' },
    { family: 'World Health Organization', given: '' },
  ]);
  assert.deepEqual(parseNames(formatNames(names)), names);
  assert.match(formatReference({ authors: names, title: 'T' }), /^Cadamuro J, Simundic AM, World Health Organization\. T\.$/);
});

test('writes dates the NLM way', () => {
  assert.equal(vancouverDate('2026-03-05'), '2026 Mar 5');
  assert.equal(vancouverDate('2026-03'), '2026 Mar');
  assert.equal(vancouverDate('Spring 2020'), 'Spring 2020');
});
