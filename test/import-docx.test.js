// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { getSchema } from '@tiptap/core';
import { parseDocx } from '../client/src/import-docx.js';
import { toCsl, fromCsl } from '../client/src/csl.js';
import { schemaExtensions } from '../client/src/schema.js';
import { formatReference } from '../client/src/citations.js';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" '
  + 'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function docx(body, extra = {}) {
  const files = {
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}`
      + '<w:sectPr><w:pgSz w:w="11906"/><w:pgMar w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>',
    'word/styles.xml': `<w:styles ${W}>
      <w:style w:styleId="berschrift1"><w:name w:val="heading 1"/></w:style>
      <w:style w:styleId="Literaturverzeichnis"><w:name w:val="Bibliography"/></w:style>
      </w:styles>`,
    'word/numbering.xml': `<w:numbering ${W}>
      <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl>
        <w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
    'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rLink" Type="hyperlink" Target="https://example.org/" TargetMode="External"/>'
      + '<Relationship Id="rImg" Type="image" Target="media/image1.png"/>'
      + '<Relationship Id="rEmf" Type="image" Target="media/image2.emf"/></Relationships>',
    'word/media/image1.png': new Uint8Array([137, 80, 78, 71]),
    'word/media/image2.emf': new Uint8Array([1, 2, 3]),
    ...extra,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])));
}

const p = (inner, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`;
const r = (text, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const schema = getSchema(schemaExtensions);
const valid = (content) => schema.nodeFromJSON({ type: 'doc', content }).check();
const texts = (node) => node.text || (node.content || []).map(texts).join('');

test('reads headings, formatting, links, lists and alignment', () => {
  const { content } = parseDocx(docx([
    p(r('Einleitung'), '<w:pStyle w:val="berschrift1"/>'),
    p(r('fett', '<w:b/>') + r(' normal') + r('2', '<w:vertAlign w:val="superscript"/>'), '<w:jc w:val="center"/>'),
    p(`<w:hyperlink r:id="rLink">${r('Link')}</w:hyperlink>`),
    p(r('Punkt'), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'),
    p(r('Unterpunkt'), '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>'),
  ].join('')));
  valid(content);
  assert.deepEqual(content[0], { type: 'heading', attrs: { level: 1, textAlign: null }, content: [{ type: 'text', text: 'Einleitung', marks: [] }] });
  assert.equal(content[1].attrs.textAlign, 'center');
  assert.deepEqual(content[1].content.map((n) => [n.text, n.marks.map((m) => m.type)]), [['fett', ['bold']], [' normal', []], ['2', ['superscript']]]);
  assert.deepEqual(content[2].content[0].marks, [{ type: 'link', attrs: { href: 'https://example.org/' } }]);
  assert.equal(content[3].type, 'bulletList');
  assert.equal(content[3].content[0].content[1].type, 'orderedList');
  assert.equal(texts(content[3]), 'PunktUnterpunkt');
});

test('turns tracked changes into suggestions with the Word author', () => {
  const { content, stats } = parseDocx(docx(p(
    r('Der Wert ist ')
    + `<w:del w:id="1" w:author="Anna Muster" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>hoch</w:delText></w:r></w:del>`
    + `<w:ins w:id="2" w:author="Anna Muster"><w:r><w:t>niedrig</w:t></w:r></w:ins>`,
  )), { changeId: (author) => `id-${author}` });
  valid(content);
  assert.equal(stats.changes, 2);
  const [, del, ins] = content[0].content;
  assert.deepEqual([del.text, del.marks], ['hoch', [{ type: 'deletion', attrs: { id: 'id-Anna Muster' } }]]);
  assert.deepEqual([ins.text, ins.marks], ['niedrig', [{ type: 'insertion', attrs: { id: 'id-Anna Muster' } }]]);
});

test('reads comments with replies, done state and anchor', () => {
  const comments = `<w:comments ${W}>
    <w:comment w:id="0" w:author="Ben" w:date="2026-03-01T10:00:00Z"><w:p w14:paraId="A1"><w:r><w:t>Quelle?</w:t></w:r></w:p></w:comment>
    <w:comment w:id="1" w:author="Anna" w:date="2026-03-02T10:00:00Z"><w:p w14:paraId="B2"><w:r><w:t>Ergänzt.</w:t></w:r></w:p></w:comment>
    </w:comments>`;
  const ext = `<w15:commentsEx ${W}><w15:commentEx w15:paraId="A1" w15:done="1"/>`
    + '<w15:commentEx w15:paraId="B2" w15:paraIdParent="A1"/></w15:commentsEx>';
  const { content, threads } = parseDocx(docx(p(
    r('Vorher ') + '<w:commentRangeStart w:id="0"/><w:commentRangeStart w:id="1"/>' + r('kommentiert')
    + '<w:commentRangeEnd w:id="0"/><w:commentRangeEnd w:id="1"/>' + r(' danach'),
  ), { 'word/comments.xml': comments, 'word/commentsExtended.xml': ext }));
  valid(content);
  assert.equal(threads.length, 1);
  const [thread] = threads;
  assert.equal(thread.quote, 'kommentiert');
  assert.equal(thread.resolved, true);
  assert.deepEqual(thread.comments.map((c) => [c.author, c.body]), [['Ben', 'Quelle?'], ['Anna', 'Ergänzt.']]);
  assert.equal(thread.comments[0].createdAt, Date.parse('2026-03-01T10:00:00Z'));
  const anchored = content[0].content.find((n) => n.text === 'kommentiert');
  assert.deepEqual(anchored.marks, [{ type: 'comment', attrs: { threadId: thread.id } }]);
});

test('reads Zotero/Mendeley citations and drops their bibliography', () => {
  const csl = {
    citationItems: [
      { itemData: { type: 'article-journal', title: 'Paper A', author: [{ family: 'Cadamuro', given: 'Janne' }], 'container-title': 'Clin Chem Lab Med', issued: { 'date-parts': [[2021]] }, DOI: '10.1515/cclm-1' } },
      { itemData: { type: 'book', title: 'Buch B', author: [{ family: 'Muster', given: 'Anna' }], publisher: 'Springer', issued: { 'date-parts': [[2020]] } } },
    ],
  };
  const field = (instr, shown) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${esc(instr)}</w:instrText></w:r>`
    + `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${r(shown)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const { content, references, stats } = parseDocx(docx([
    p(r('Wie gezeigt ') + field(`ADDIN ZOTERO_ITEM CSL_CITATION ${JSON.stringify(csl)}`, '[1,2]') + r('.')),
    p(r('Literatur'), '<w:pStyle w:val="berschrift1"/>'),
    p(field('ADDIN ZOTERO_BIBL {"uncited":[]} CSL_BIBLIOGRAPHY', '1. Cadamuro J. Paper A.'), '<w:pStyle w:val="Literaturverzeichnis"/>'),
  ].join('')));
  valid(content);
  assert.equal(stats.citations, 1);
  assert.equal(content.length, 1, 'bibliography and its heading are dropped');
  const cite = content[0].content.find((n) => n.type === 'citation');
  assert.deepEqual(cite.attrs.refIds, references.map((x) => x.key));
  assert.equal(texts(content[0]), 'Wie gezeigt .');
  assert.equal(formatReference(references[0].ref), 'Cadamuro J. Paper A. Clin Chem Lab Med. 2021. doi:10.1515/cclm-1');
  assert.equal(references[1].ref.type, 'book');
});

test('reads EndNote and Word source citations', () => {
  const record = '<EndNote><Cite><Author>Smith</Author><Year>2019</Year><record><ref-type name="Journal Article">17</ref-type>'
    + '<contributors><authors><author><style>Smith, John</style></author></authors></contributors>'
    + '<titles><title><style>EndNote title</style></title><secondary-title>J Lab Med</secondary-title></titles>'
    + '<dates><year>2019</year></dates><volume>5</volume><accession-num>12345678</accession-num></record></Cite></EndNote>';
  const sources = '<b:Sources xmlns:b="http://schemas.openxmlformats.org/officeDocument/2006/bibliography"><b:Source>'
    + '<b:Tag>Mus20</b:Tag><b:SourceType>Book</b:SourceType><b:Author><b:Author><b:NameList><b:Person><b:Last>Muster</b:Last>'
    + '<b:First>Anna</b:First></b:Person></b:NameList></b:Author></b:Author><b:Title>Word Buch</b:Title><b:Year>2020</b:Year>'
    + '<b:Publisher>Thieme</b:Publisher><b:City>Stuttgart</b:City></b:Source></b:Sources>';
  const { content, references } = parseDocx(docx(p(
    `<w:fldSimple w:instr="${esc(` ADDIN EN.CITE ${record}`)}">${r('[1]')}</w:fldSimple>`
    + r(' und ')
    + `<w:fldSimple w:instr=" CITATION Mus20 \\l 1031 ">${r('(Muster, 2020)')}</w:fldSimple>`,
  ), { 'customXml/item1.xml': sources }));
  valid(content);
  assert.equal(content[0].content.filter((n) => n.type === 'citation').length, 2);
  assert.equal(formatReference(references[0].ref), 'Smith J. EndNote title. J Lab Med. 2019;5.');
  assert.equal(references[0].ref.pmid, '12345678');
  assert.equal(formatReference(references[1].ref), 'Muster A. Word Buch. Stuttgart: Thieme; 2020.');
});

test('reads tables and images; skips image formats the editor cannot show', () => {
  const drawing = (rel, cx) => `<w:r><w:drawing><wp:inline xmlns:wp="x"><wp:extent cx="${cx}" cy="100"/><wp:docPr id="1" name="Bild" descr="Abb. 1"/>`
    + `<a:graphic xmlns:a="y"><a:graphicData><pic:pic xmlns:pic="z"><pic:blipFill><a:blip r:embed="${rel}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  const cell = (text, tcPr = '') => `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ''}${p(r(text))}</w:tc>`;
  const { content, images, stats } = parseDocx(docx([
    `<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr>${cell('A', '<w:gridSpan w:val="2"/>')}</w:tr>`
      + `<w:tr>${cell('B', '<w:vMerge w:val="restart"/>')}${cell('C')}</w:tr><w:tr>${cell('', '<w:vMerge/>')}${cell('D')}</w:tr></w:tbl>`,
    p(drawing('rImg', 5731510 / 2) + drawing('rEmf', 100)),
  ].join('')));
  valid(content);
  const [table, para] = content;
  assert.equal(table.content[0].content[0].type, 'tableHeader');
  assert.equal(table.content[0].content[0].attrs.colspan, 2);
  assert.equal(table.content[1].content[0].attrs.rowspan, 2);
  assert.equal(table.content[2].content.length, 1);
  assert.deepEqual(para.content.map((n) => n.attrs), [{ src: 'import:word/media/image1.png', alt: 'Abb. 1', width: 50 }]);
  assert.equal(images.length, 1);
  assert.equal(images[0].mime, 'image/png');
  assert.equal(stats.images, 2, 'counts every image, also those left out');
});

test('rejects files that are not .docx', () => {
  assert.throws(() => parseDocx(new Uint8Array([1, 2, 3])), /Keine gültige Word-Datei/);
});

test('CSL mapping keeps every reference type', () => {
  const refs = [
    { authors: [{ family: 'Cadamuro', given: 'J' }], title: 'T', journal: 'CCLM', year: '2021', volume: '1', issue: '2', pages: '3-4', doi: '10.1/x', pmid: '1' },
    { type: 'book', authors: [], editors: [{ family: 'Ed', given: 'A' }], title: 'B', edition: '2', place: 'Wien', publisher: 'P', year: '2020' },
    { type: 'chapter', authors: [{ family: 'A', given: 'B' }], editors: [{ family: 'E', given: 'F' }], title: 'C', bookTitle: 'Book', publisher: 'P', year: '2019', pages: '1-9' },
    { type: 'web', authors: [{ family: 'World Health Organization', given: '' }], title: 'W', url: 'https://who.int', accessed: '2026-11-13', year: '2024' },
    { type: 'conference', authors: [{ family: 'A', given: 'B' }], title: 'Talk', conference: 'EuroMedLab', confDate: '2025-05-18', confPlace: 'Brüssel' },
    { type: 'report', authors: [{ family: 'A', given: 'B' }], title: 'R', reportNo: '7', publisher: 'P', year: '2018' },
    { type: 'thesis', authors: [{ family: 'A', given: 'B' }], title: 'D', thesisType: 'master thesis', place: 'Salzburg', publisher: 'PMU', year: '2010' },
  ];
  for (const ref of refs) assert.equal(formatReference(fromCsl(toCsl(ref, 'x'))), formatReference(ref));
});
