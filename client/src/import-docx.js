// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Reads a Word file (.docx) into editor content (ProseMirror JSON), references, comment threads and images.
// Runs in the browser and in Node (tests); it has no side effects. editor.js stores the result.
//
// Kept: headings, paragraphs, bold/italic/underline/strike, super-/subscript, links, lists, tables, images,
// tracked changes (insertions and deletions become suggestions), comments with replies and "done" state, and
// citations of Zotero, Mendeley (fields and Mendeley Cite), EndNote and Word's own source manager. The
// bibliography these tools generate is dropped, because the editor builds its own.
import { unzipSync, strFromU8 } from 'fflate';
import { parseXml, kids, kid, path, textOf, findAll } from './xml.js';
import { fromCsl } from './csl.js';
import { parseNames } from './citations.js';

const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const BIB_HEADING = /^(literatur(verzeichnis)?|references?|bibliography|quellen(verzeichnis)?|literature( cited)?|works cited)$/i;
const BIB_STYLES = ['bibliography', 'endnote bibliography'];
const EMU_PER_PX = 9525;
const TWIPS_PER_PX = 15;

const on = (el) => !!el && !['0', 'false', 'off', 'none'].includes(el.attrs.val);
const uuid = () => globalThis.crypto.randomUUID();
const randomPart = () => Math.random().toString(36).slice(2, 10);

/** Default suggestion id for a Word author: "w|<name>|<random>" (see suggestionAuthorName()). */
export const importedChangeId = (author) => `w|${encodeURIComponent(author || '')}|${randomPart()}`;

function base64Text(b64) {
  const bin = atob(b64.replace(/\s+/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// --- References from the citation tools --------------------------------------------------

const ENDNOTE_TYPES = {
  'journal article': 'article', 'electronic article': 'article', 'magazine article': 'article', book: 'book',
  'edited book': 'book', 'electronic book': 'book', 'book section': 'chapter', 'electronic book section': 'chapter',
  'web page': 'web', 'conference paper': 'conference', 'conference proceedings': 'conference', report: 'report',
  'government document': 'report', thesis: 'thesis',
};

function fromEndNote(record) {
  const get = (...names) => textOf(path(record, ...names)).trim();
  const type = ENDNOTE_TYPES[(path(record, 'ref-type')?.attrs.name || '').toLowerCase()] || 'article';
  const names = (group) => kids(path(record, 'contributors', group)).map((a) => parseNames(textOf(a).trim())[0]).filter(Boolean);
  const secondary = get('titles', 'secondary-title');
  const ref = {
    type,
    authors: names('authors'),
    title: get('titles', 'title'),
    year: get('dates', 'year').slice(0, 4),
    volume: get('volume'),
    pages: get('pages'),
    edition: get('edition'),
    publisher: get('publisher'),
    place: get('pub-location'),
    doi: get('electronic-resource-num').replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''),
    url: textOf(findAll(record, 'url')[0]).trim(),
  };
  const editors = names('secondary-authors');
  if (editors.length && type !== 'article') ref.editors = editors;
  if (type === 'article') {
    ref.journal = get('periodical', 'abbr-1') || get('alt-periodical', 'abbr-1') || secondary || get('periodical', 'full-title');
    ref.issue = get('number');
  } else if (type === 'chapter' || type === 'conference') {
    ref.bookTitle = secondary;
  } else if (type === 'report') {
    ref.reportNo = get('number');
  } else if (type === 'thesis') {
    ref.thesisType = get('work-type');
  }
  if (/^\d+$/.test(get('accession-num'))) ref.pmid = get('accession-num');
  return clean(ref);
}

const WORD_TYPES = {
  JournalArticle: 'article', ArticleInAPeriodical: 'article', Book: 'book', BookSection: 'chapter',
  InternetSite: 'web', DocumentFromInternetSite: 'web', ConferenceProceedings: 'conference', Report: 'report',
};

function fromWordSource(source) {
  const get = (name) => textOf(kid(source, name)).trim();
  const type = WORD_TYPES[get('SourceType')] || 'article';
  const people = (role) => {
    const group = path(source, 'Author', role);
    if (kid(group, 'Corporate')) return [{ family: textOf(kid(group, 'Corporate')).trim(), given: '' }];
    return findAll(group, 'Person').map((p) => ({
      family: textOf(kid(p, 'Last')).trim(),
      given: [textOf(kid(p, 'First')), textOf(kid(p, 'Middle'))].join(' ').trim(),
    }));
  };
  const ref = {
    type,
    authors: people('Author'),
    title: get('Title'),
    year: get('Year'),
    volume: get('Volume'),
    issue: get('Issue'),
    pages: get('Pages'),
    edition: get('Edition'),
    publisher: get('Publisher'),
    place: get('City'),
    doi: get('DOI'),
    url: get('URL'),
  };
  const editors = people('Editor');
  if (editors.length) ref.editors = editors;
  if (type === 'article') ref.journal = get('JournalName') || get('PeriodicalTitle');
  else ref.bookTitle = get('BookTitle') || get('ConferenceName');
  return clean(ref);
}

/** Drops empty fields; journal articles keep the form of looked-up entries (no type). */
function clean(ref) {
  const out = Object.fromEntries(Object.entries(ref).filter(([, v]) => (Array.isArray(v) ? v.length : v)));
  if (!out.authors) out.authors = [];
  if (out.type === 'article') delete out.type;
  return out;
}

function cslItems(json) {
  try {
    return (JSON.parse(json).citationItems || []).map((it) => it.itemData).filter(Boolean).map(fromCsl);
  } catch {
    return [];
  }
}

function endNoteItems(xml) {
  const root = parseXml(xml);
  return root ? findAll({ children: [root] }, 'record').map(fromEndNote) : [];
}

// --- The reader ------------------------------------------------------------------------

/**
 * Parses the .docx bytes. `changeId(author)` returns the suggestion id for one tracked change.
 * Returns { content, references: [{ key, ref }], threads, images: [{ key, name, mime, data }], stats }.
 * Citation nodes refer to reference keys and images to "import:<key>"; editor.js swaps in the real ids.
 */
export function parseDocx(bytes, { changeId = importedChangeId } = {}) {
  let files;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('Keine gültige Word-Datei (.docx)');
  }
  const xml = (name) => (files[name] ? parseXml(strFromU8(files[name])) : null);
  const body = path(xml('word/document.xml'), 'body');
  if (!body) throw new Error('Keine gültige Word-Datei (.docx)');

  const rels = new Map(kids(xml('word/_rels/document.xml.rels')).map((r) => [r.attrs.Id, r.attrs]));
  const stats = { comments: 0, changes: 0, citations: 0, images: 0, footnotes: 0 };

  // Styles: id -> { name, basedOn, numPr }.
  const styles = new Map(kids(xml('word/styles.xml'), 'style').map((s) => [s.attrs.styleId, {
    name: (kid(s, 'name')?.attrs.val || '').toLowerCase(),
    basedOn: kid(s, 'basedOn')?.attrs.val,
    numPr: path(s, 'pPr', 'numPr'),
    outline: path(s, 'pPr', 'outlineLvl')?.attrs.val,
  }]));
  const styleChain = (id) => {
    const chain = [];
    for (let s = styles.get(id); s && chain.length < 10; s = styles.get(s.basedOn)) chain.push(s);
    return chain;
  };

  // Numbering: numId -> abstract levels -> ordered?
  const numbering = xml('word/numbering.xml');
  const abstracts = new Map(kids(numbering, 'abstractNum').map((a) => [a.attrs.abstractNumId,
    new Map(kids(a, 'lvl').map((l) => [l.attrs.ilvl, path(l, 'numFmt')?.attrs.val !== 'bullet']))]));
  const nums = new Map(kids(numbering, 'num').map((n) => [n.attrs.numId, abstracts.get(kid(n, 'abstractNumId')?.attrs.val)]));

  // Word's own source manager keeps sources in a customXml part.
  const wordSources = new Map();
  for (const name of Object.keys(files).filter((f) => /^customXml\/item\d+\.xml$/.test(f))) {
    const root = xml(name);
    if (root?.name !== 'Sources') continue;
    for (const s of kids(root, 'Source')) wordSources.set(textOf(kid(s, 'Tag')).trim(), fromWordSource(s));
  }

  // Text column width in pixels, to turn image sizes into percent.
  const sect = kid(body, 'sectPr');
  const pgW = Number(path(sect, 'pgSz')?.attrs.w || 11906);
  const mar = path(sect, 'pgMar')?.attrs || {};
  const columnPx = (pgW - Number(mar.left || 1440) - Number(mar.right || 1440)) / TWIPS_PER_PX;

  // --- References ---
  const references = new Map(); // key -> ref
  function referenceKey(ref) {
    const key = ref.doi ? `doi:${ref.doi.toLowerCase()}` : ref.pmid ? `pmid:${ref.pmid}`
      : `t:${(ref.title || '').toLowerCase().replace(/\W+/g, ' ').trim()}|${ref.year || ''}`;
    if (!references.has(key)) references.set(key, ref);
    return key;
  }

  // --- Comments ---
  const commentsXml = xml('word/comments.xml');
  const extended = new Map(kids(xml('word/commentsExtended.xml'), 'commentEx').map((c) => [c.attrs.paraId, c.attrs]));
  const wordComments = new Map(); // word id -> { author, date, body, paraId }
  for (const c of kids(commentsXml, 'comment')) {
    const paras = findAll(c, 'p');
    wordComments.set(c.attrs.id, {
      author: c.attrs.author || '',
      createdAt: Date.parse(c.attrs.date) || Date.now(),
      body: paras.map((p) => findAll(p, 't').map(textOf).join('')).join('\n').trim(),
      paraId: paras.at(-1)?.attrs.paraId,
    });
  }
  const byParaId = new Map([...wordComments].map(([id, c]) => [c.paraId, id]));
  const rootOf = (id) => {
    let current = id;
    for (let i = 0; i < 20; i++) {
      const parent = byParaId.get(extended.get(wordComments.get(current)?.paraId)?.paraIdParent);
      if (!parent || parent === current) return current;
      current = parent;
    }
    return current;
  };
  const threads = new Map(); // root word id -> thread
  for (const [id, c] of wordComments) {
    const root = rootOf(id);
    if (!threads.has(root)) {
      const done = extended.get(wordComments.get(root).paraId)?.done === '1';
      threads.set(root, { id: uuid(), quote: '', resolved: done, comments: [] });
    }
    if (c.body) threads.get(root).comments.push({ author: c.author, body: c.body, createdAt: c.createdAt });
  }
  // Word ids of replies anchor on their thread, so their ranges are ignored.
  const anchorOf = (wordId) => (rootOf(wordId) === wordId ? threads.get(wordId) : null);

  // --- Images ---
  const images = new Map(); // key -> image
  function imageNode(relId, alt, cx) {
    const target = rels.get(relId)?.Target;
    if (!target) return null;
    const file = target.startsWith('/') ? target.slice(1) : `word/${target}`.replace(/[^/]+\/\.\.\//g, '');
    const mime = IMAGE_MIME[file.split('.').pop().toLowerCase()];
    stats.images++;
    if (!mime || !files[file]) return null;
    if (!images.has(file)) images.set(file, { key: file, name: file.split('/').pop(), mime, data: files[file] });
    const ratio = cx ? cx / EMU_PER_PX / columnPx : 1;
    const width = ratio >= 0.9 ? null : [25, 50, 75].reduce((a, b) => (Math.abs(b / 100 - ratio) < Math.abs(a / 100 - ratio) ? b : a));
    return { type: 'image', attrs: { src: `import:${file}`, alt: alt || null, width } };
  }

  // --- Walking the body ---
  const fields = []; // open complex fields: { instr, data, separated, kind, refs, href }
  const activeComments = new Set(); // word ids
  const changeIds = new Map(); // "w:id|author" -> suggestion id
  let paragraph = null; // { content, bib } of the paragraph being read

  const hiddenByField = () => fields.some((f) => !f.separated || f.kind === 'citation');

  function classify(field) {
    const instr = field.instr.trim();
    let m;
    if ((m = /ADDIN\s+(?:ZOTERO_ITEM\s+)?CSL_CITATION\s+(\{[\s\S]*\})/.exec(instr))) field.refs = cslItems(m[1]);
    else if (/ADDIN\s+EN\.CITE(?!\.DATA)/.test(instr)) {
      const inline = instr.indexOf('<EndNote');
      field.refs = endNoteItems(inline >= 0 ? instr.slice(inline) : field.data || '');
    } else if ((m = /^CITATION\s+(\S+)([\s\S]*)$/.exec(instr))) {
      const tags = [m[1], ...[...m[2].matchAll(/\\m\s+(\S+)/g)].map((x) => x[1])];
      field.refs = tags.map((tag) => wordSources.get(tag.replace(/^"|"$/g, ''))).filter(Boolean);
    } else if ((m = /^HYPERLINK\s+"([^"]+)"/.exec(instr))) {
      field.kind = 'link';
      field.href = m[1];
      return;
    } else if (/ADDIN\s+(ZOTERO_BIBL|EN\.REFLIST|Mendeley Bibliography|CSL_BIBLIOGRAPHY)|^BIBLIOGRAPHY\b/.test(instr)) {
      field.kind = 'bib';
      return;
    }
    if (field.refs?.length) field.kind = 'citation';
  }

  function marksFor(rPr, ctx) {
    const marks = [];
    if (on(kid(rPr, 'b'))) marks.push({ type: 'bold' });
    if (on(kid(rPr, 'i'))) marks.push({ type: 'italic' });
    if (on(kid(rPr, 'u'))) marks.push({ type: 'underline' });
    if (on(kid(rPr, 'strike')) || on(kid(rPr, 'dstrike'))) marks.push({ type: 'strike' });
    const valign = kid(rPr, 'vertAlign')?.attrs.val;
    if (valign === 'superscript') marks.push({ type: 'superscript' });
    if (valign === 'subscript') marks.push({ type: 'subscript' });
    return [...marks, ...contextMarks(ctx)];
  }

  function contextMarks(ctx) {
    const marks = [];
    const href = ctx.href || fields.findLast((f) => f.kind === 'link' && f.separated)?.href;
    if (href) marks.push({ type: 'link', attrs: { href } });
    for (const id of activeComments) {
      const thread = anchorOf(id);
      if (thread) marks.push({ type: 'comment', attrs: { threadId: thread.id } });
    }
    if (ctx.change) marks.push({ type: ctx.change.type, attrs: { id: ctx.change.id } });
    return marks;
  }

  function push(node, quoteText = '') {
    if (!paragraph) return;
    const last = paragraph.content.at(-1);
    if (node.type === 'text' && last?.type === 'text' && JSON.stringify(last.marks) === JSON.stringify(node.marks)) {
      last.text += node.text;
    } else {
      paragraph.content.push(node);
    }
    for (const id of activeComments) {
      const thread = anchorOf(id);
      if (thread && thread.quote.length < 500) thread.quote += quoteText;
    }
  }

  function text(value, rPr, ctx) {
    if (!value || !paragraph || hiddenByField()) return;
    if (fields.some((f) => f.kind === 'bib')) paragraph.bib = true;
    push({ type: 'text', text: value, marks: marksFor(rPr, ctx) }, value);
  }

  function citation(refs, ctx) {
    stats.citations++;
    push({ type: 'citation', attrs: { refIds: [...new Set(refs.map(referenceKey))] }, marks: contextMarks(ctx) });
  }

  function image(node, ctx) {
    if (!node || hiddenByField()) return;
    push({ ...node, marks: contextMarks(ctx) });
  }

  function run(r, ctx) {
    const rPr = kid(r, 'rPr');
    for (const c of kids(r)) {
      switch (c.name) {
        case 't':
        case 'delText':
          text(textOf(c), rPr, ctx);
          break;
        case 'tab':
          text('\t', rPr, ctx);
          break;
        case 'noBreakHyphen':
          text('-', rPr, ctx);
          break;
        case 'br':
        case 'cr':
          if (c.attrs.type !== 'page' && !hiddenByField()) push({ type: 'hardBreak', marks: contextMarks(ctx) });
          break;
        case 'drawing': {
          const blip = findAll(c, 'blip')[0];
          const docPr = findAll(c, 'docPr')[0];
          image(blip && imageNode(blip.attrs.embed, docPr?.attrs.descr || docPr?.attrs.title, Number(findAll(c, 'extent')[0]?.attrs.cx)), ctx);
          break;
        }
        case 'pict': {
          const data = findAll(c, 'imagedata')[0];
          image(data && imageNode(data.attrs.id, data.attrs.title), ctx);
          break;
        }
        case 'AlternateContent':
          run({ children: kids(kid(c, 'Choice')) }, ctx);
          break;
        case 'fldChar': {
          const type = c.attrs.fldCharType;
          if (type === 'begin') {
            const data = textOf(kid(c, 'fldData')).trim();
            fields.push({ instr: '', data: data ? base64Text(data) : '', separated: false });
          } else if (type === 'separate' && fields.length) {
            const field = fields.at(-1);
            classify(field);
            field.separated = true;
          } else if (type === 'end' && fields.length) {
            const field = fields.pop();
            if (!field.separated) classify(field);
            // EndNote keeps the record in a nested EN.CITE.DATA field.
            if (/EN\.CITE\.DATA/.test(field.instr) && fields.length) fields.at(-1).data += field.data;
            if (field.kind === 'citation') citation(field.refs, ctx);
          }
          break;
        }
        case 'instrText':
          if (fields.length && !fields.at(-1).separated) fields.at(-1).instr += textOf(c);
          break;
        case 'footnoteReference':
        case 'endnoteReference':
          stats.footnotes++;
          break;
        default:
          break;
      }
    }
  }

  function changeOf(el, type) {
    const author = el.attrs.author || '';
    const key = `${type}|${el.attrs.id}|${author}`;
    if (!changeIds.has(key)) {
      changeIds.set(key, changeId(author));
      stats.changes++;
    }
    return { type, id: changeIds.get(key) };
  }

  function inline(nodes, ctx) {
    for (const c of nodes) {
      switch (c.name) {
        case 'r':
          run(c, ctx);
          break;
        case 'ins':
        case 'moveTo':
          inline(kids(c), { ...ctx, change: changeOf(c, 'insertion') });
          break;
        case 'del':
        case 'moveFrom':
          inline(kids(c), { ...ctx, change: changeOf(c, 'deletion') });
          break;
        case 'hyperlink': {
          const target = rels.get(c.attrs.id)?.Target;
          inline(kids(c), target ? { ...ctx, href: target } : ctx);
          break;
        }
        case 'fldSimple': {
          const field = { instr: c.attrs.instr || '', separated: true };
          classify(field);
          if (field.kind === 'citation') citation(field.refs, ctx);
          else if (field.kind === 'link') inline(kids(c), { ...ctx, href: field.href });
          else {
            if (field.kind === 'bib') paragraph.bib = true;
            inline(kids(c), ctx);
          }
          break;
        }
        case 'sdt':
          sdt(c, ctx, inline);
          break;
        case 'smartTag':
        case 'customXml':
          inline(kids(c), ctx);
          break;
        case 'commentRangeStart':
          activeComments.add(c.attrs.id);
          break;
        case 'commentRangeEnd':
          activeComments.delete(c.attrs.id);
          break;
        default:
          break;
      }
    }
  }

  /** Content control. Mendeley Cite stores its citations in the tag; other controls are just their content. */
  function sdt(el, ctx, walk) {
    const tag = path(el, 'sdtPr', 'tag')?.attrs.val || '';
    const content = kids(kid(el, 'sdtContent'));
    if (tag.startsWith('MENDELEY_CITATION_v3_')) {
      let refs = [];
      try { refs = cslItems(base64Text(tag.slice('MENDELEY_CITATION_v3_'.length))); } catch { refs = []; }
      if (refs.length && paragraph) { citation(refs, ctx); return; }
    }
    if (tag.startsWith('MENDELEY_BIBLIOGRAPHY')) {
      if (paragraph) paragraph.bib = true;
      walk(content, { ...ctx, bib: true });
      return;
    }
    walk(content, ctx);
  }

  function paragraphStyle(p) {
    const pPr = kid(p, 'pPr');
    const chain = styleChain(path(pPr, 'pStyle')?.attrs.val);
    const names = chain.map((s) => s.name);
    let level = null;
    const heading = names.map((n) => /^heading (\d)$/.exec(n)?.[1]).find(Boolean);
    if (heading) level = Number(heading);
    else if (names[0] === 'title') level = 1;
    else {
      const outline = path(pPr, 'outlineLvl')?.attrs.val ?? chain.find((s) => s.outline !== undefined)?.outline;
      if (outline !== undefined && Number(outline) < 9) level = Number(outline) + 1;
    }
    const numPr = path(pPr, 'numPr') || chain.find((s) => s.numPr)?.numPr;
    const numId = path(numPr, 'numId')?.attrs.val;
    const ilvl = path(numPr, 'ilvl')?.attrs.val || '0';
    const levels = numId && numId !== '0' ? nums.get(numId) : null;
    const list = levels ? { level: Number(ilvl), ordered: levels.get(ilvl) ?? true } : null;
    const align = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }[path(pPr, 'jc')?.attrs.val];
    return { level, list, align, bib: names.some((n) => BIB_STYLES.includes(n)) };
  }

  function readParagraph(p, ctx) {
    const style = paragraphStyle(p);
    paragraph = { content: [], bib: style.bib || !!ctx.bib };
    inline(kids(p), ctx);
    const content = paragraph.content;
    const node = style.level && !style.list
      ? { type: 'heading', attrs: { level: Math.min(style.level, 3), textAlign: style.align || null }, content }
      : { type: 'paragraph', attrs: { textAlign: style.align || null }, content };
    const item = { node, list: style.list, bib: paragraph.bib };
    paragraph = null;
    return item;
  }

  function readTable(tbl) {
    const rows = [];
    const merges = new Map(); // column -> cell that a vertical merge continues
    for (const tr of kids(tbl, 'tr')) {
      const header = !!path(tr, 'trPr', 'tblHeader');
      const cells = [];
      let col = 0;
      for (const tc of kids(tr, 'tc')) {
        const tcPr = kid(tc, 'tcPr');
        const colspan = Number(path(tcPr, 'gridSpan')?.attrs.val || 1);
        const vMerge = path(tcPr, 'vMerge');
        if (vMerge && vMerge.attrs.val !== 'restart' && merges.has(col)) {
          merges.get(col).attrs.rowspan++;
        } else {
          const content = blocks(kids(tc));
          const cell = {
            type: header ? 'tableHeader' : 'tableCell',
            attrs: { colspan, rowspan: 1 },
            content: content.length ? content : [{ type: 'paragraph' }],
          };
          cells.push(cell);
          if (vMerge) merges.set(col, cell);
          else merges.delete(col);
        }
        col += colspan;
      }
      if (cells.length) rows.push({ type: 'tableRow', content: cells });
    }
    return rows.length ? { type: 'table', content: rows } : null;
  }

  /** Reads block elements into items { node, list, bib }. */
  function items(nodes, ctx = {}) {
    const out = [];
    for (const c of nodes) {
      if (c.name === 'p') out.push(readParagraph(c, ctx));
      else if (c.name === 'tbl') {
        const table = readTable(c);
        if (table) out.push({ node: table });
      } else if (c.name === 'sdt') sdt(c, ctx, (content, inner) => out.push(...items(content, inner)));
      else if (c.name === 'customXml') out.push(...items(kids(c), ctx));
      else if (c.name === 'commentRangeStart') activeComments.add(c.attrs.id);
      else if (c.name === 'commentRangeEnd') activeComments.delete(c.attrs.id);
    }
    return out;
  }

  const blocks = (nodes) => nestLists(items(nodes));

  let all = items(kids(body));
  // The tools' own bibliography (and its heading) goes; the editor appends the reference list itself.
  if (references.size) {
    const first = all.findIndex((it) => it.bib);
    const before = all[first - 1]?.node;
    if (first > 0 && before?.type === 'heading' && BIB_HEADING.test(plainText(before).trim())) all[first - 1].bib = true;
    all = all.filter((it) => !it.bib);
  }
  let content = nestLists(all);
  if (!content.length) content = [{ type: 'paragraph' }];

  const result = [...threads.values()].filter((th) => th.comments.length);
  stats.comments = result.length;
  return {
    content,
    references: [...references].map(([key, ref]) => ({ key, ref })),
    threads: result,
    images: [...images.values()],
    stats,
  };
}

function plainText(node) {
  return node.text || (node.content || []).map(plainText).join('');
}

/** Groups list paragraphs into nested bulletList / orderedList nodes. */
function nestLists(items) {
  const out = [];
  const stack = []; // { node, level, ordered }
  for (const it of items) {
    if (!it.list) {
      stack.length = 0;
      out.push(it.node);
      continue;
    }
    const { level, ordered } = it.list;
    while (stack.length && (stack.at(-1).level > level || (stack.at(-1).level === level && stack.at(-1).ordered !== ordered))) {
      stack.pop();
    }
    let top = stack.at(-1);
    if (!top || top.level < level) {
      const list = { type: ordered ? 'orderedList' : 'bulletList', content: [] };
      if (top) top.node.content.at(-1).content.push(list);
      else out.push(list);
      top = { node: list, level, ordered };
      stack.push(top);
    }
    // A list item starts with a paragraph.
    const para = it.node.type === 'heading' ? { type: 'paragraph', content: it.node.content } : it.node;
    top.node.content.push({ type: 'listItem', content: [para] });
  }
  return out;
}
