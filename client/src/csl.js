// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// References <-> CSL JSON, the format Zotero and Mendeley store in Word citation fields.

const TO_CSL_TYPE = {
  article: 'article-journal', book: 'book', chapter: 'chapter', web: 'webpage',
  conference: 'paper-conference', report: 'report', thesis: 'thesis',
};
const FROM_CSL_TYPE = {
  'article-journal': 'article', article: 'article', 'article-magazine': 'article', 'article-newspaper': 'article',
  review: 'article', 'review-book': 'article', book: 'book', chapter: 'chapter', 'entry-encyclopedia': 'chapter',
  'entry-dictionary': 'chapter', webpage: 'web', post: 'web', 'post-weblog': 'web', 'paper-conference': 'conference',
  speech: 'conference', report: 'report', thesis: 'thesis',
};

// Our field <-> CSL variable, for plain strings.
const STRINGS = [
  ['title', 'title'], ['volume', 'volume'], ['issue', 'issue'], ['pages', 'page'], ['doi', 'DOI'], ['pmid', 'PMID'],
  ['url', 'URL'], ['publisher', 'publisher'], ['place', 'publisher-place'], ['edition', 'edition'],
  ['reportNo', 'number'], ['thesisType', 'genre'], ['conference', 'event'], ['confPlace', 'event-place'],
];
const DATES = [['confDate', 'event-date'], ['accessed', 'accessed']];

const pad = (n) => String(n).padStart(2, '0');

/** "2026-11-13" -> { 'date-parts': [[2026, 11, 13]] }; other text as literal. */
function toCslDate(value) {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(String(value).trim());
  if (!m) return { literal: String(value) };
  return { 'date-parts': [[m[1], m[2], m[3]].filter(Boolean).map(Number)] };
}

/** CSL date -> "2026-11-13" / "2026-11" / "2026"; '' if unknown. */
function fromCslDate(date) {
  const parts = date?.['date-parts']?.[0];
  if (parts?.length && parts[0]) return [String(parts[0]), ...parts.slice(1).filter(Boolean).map(pad)].join('-');
  return String(date?.literal || date?.raw || '').trim();
}

const toNames = (people) => (people || []).map((a) => (a.given ? { family: a.family, given: a.given } : { literal: a.family }));
const fromNames = (names) => (names || []).map((n) => ({ family: n.family || n.literal || '', given: n.given || '' }))
  .filter((n) => n.family || n.given);

/** Our reference -> CSL item data. */
export function toCsl(ref, id) {
  const type = ref.type || 'article';
  const item = { id, type: TO_CSL_TYPE[type] || 'article-journal' };
  for (const [ours, csl] of STRINGS) if (ref[ours]) item[csl] = String(ref[ours]);
  for (const [ours, csl] of DATES) if (ref[ours]) item[csl] = toCslDate(ref[ours]);
  if (ref.authors?.length) item.author = toNames(ref.authors);
  if (ref.editors?.length) item.editor = toNames(ref.editors);
  const container = type === 'article' ? ref.journal : ref.bookTitle;
  if (container) item['container-title'] = container;
  if (ref.year) item.issued = toCslDate(ref.year);
  return item;
}

/** CSL item data (Zotero, Mendeley, our own export) -> our reference. */
export function fromCsl(item) {
  const type = FROM_CSL_TYPE[item.type] || (item.publisher && !item['container-title'] ? 'book' : 'article');
  const ref = { type };
  for (const [ours, csl] of STRINGS) if (item[csl]) ref[ours] = String(item[csl]).trim();
  for (const [ours, csl] of DATES) if (item[csl]) ref[ours] = fromCslDate(item[csl]);
  if (!ref.conference && item['event-title']) ref.conference = String(item['event-title']).trim();
  ref.authors = fromNames(item.author);
  if (item.editor?.length) ref.editors = fromNames(item.editor);
  const container = item['container-title-short'] || item.journalAbbreviation || item['container-title'] || '';
  if (type === 'article') ref.journal = String(container).trim();
  else if (item['container-title']) ref.bookTitle = String(item['container-title']).trim();
  ref.year = fromCslDate(item.issued).slice(0, 4);
  if (ref.doi) ref.doi = ref.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  // Entries from a lookup carry no type; keep that form for journal articles.
  if (type === 'article') delete ref.type;
  return ref;
}
