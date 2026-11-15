// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Reads a Word file (.docx) into editor content (ProseMirror JSON), references, comment threads and images.
// Runs in the browser and in Node (tests); it has no side effects. editor.js stores the result.
//
// Kept: headings, paragraphs, bold/italic/underline/strike, super-/subscript, text colour and highlight (also
// from paragraph, character and table styles), links, lists, tables (column widths, cell background, borders),
// images (also chart fallback pictures, grouped pictures, OLE previews and text boxes), tracked changes (insertions and deletions become suggestions), comments with replies and "done" state, and
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
// Word's highlight colours.
const HIGHLIGHT = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000',
  darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff',
};
const NO_BORDER = ['nil', 'none'];

const on = (el) => !!el && !['0', 'false', 'off', 'none'].includes(el.attrs.val);
const uuid = () => globalThis.crypto.randomUUID();
const randomPart = () => Math.random().toString(36).slice(2, 10);
/** "#rrggbb" for a Word colour value, or null for "auto" and the colours in `skip`. */
const hexColor = (val, skip = []) => {
  const v = (val || '').toLowerCase();
  return /^[0-9a-f]{6}$/.test(v) && !skip.includes(v) ? `#${v}` : null;
};

/**
 * Applies the run properties `rPr` on top of `props` (later layers win, as in Word: document defaults,
 * table style, paragraph style, character style, direct formatting).
 */
function applyRPr(rPr, props) {
  if (!rPr) return props;
  const flag = (name, key) => { if (kid(rPr, name)) props[key] = on(kid(rPr, name)); };
  flag('b', 'bold');
  flag('i', 'italic');
  flag('u', 'underline');
  flag('strike', 'strike');
  if (on(kid(rPr, 'dstrike'))) props.strike = true;
  if (kid(rPr, 'vertAlign')) props.valign = kid(rPr, 'vertAlign').attrs.val;
  if (kid(rPr, 'color')) props.color = hexColor(kid(rPr, 'color').attrs.val, ['000000']);
  if (kid(rPr, 'highlight')) props.highlight = HIGHLIGHT[kid(rPr, 'highlight').attrs.val] || null;
  if (kid(rPr, 'shd')) props.shading = hexColor(kid(rPr, 'shd').attrs.fill, ['ffffff']);
  return props;
}

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

/** Placeholder text for a picture the editor cannot show (kind "image" with its format, or "chart"). */
export const defaultPlaceholder = (kind, format) => (kind === 'chart'
  ? '[Diagramm nicht übernommen]' : `[Bild nicht übernommen (${format})]`);

/**
 * Parses the .docx bytes. `changeId(author)` returns the suggestion id for one tracked change.
 * Returns { content, references: [{ key, ref }], threads, images: [{ key, name, mime, data }], stats }.
 * Citation nodes refer to reference keys and images to "import:<key>"; editor.js swaps in the real ids.
 */
export function parseDocx(bytes, { changeId = importedChangeId, placeholder = defaultPlaceholder } = {}) {
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

  // Styles: id -> { name, basedOn, numPr, rPr, pPr, ... }.
  const stylesXml = xml('word/styles.xml');
  const styles = new Map(kids(stylesXml, 'style').map((s) => [s.attrs.styleId, {
    name: (kid(s, 'name')?.attrs.val || '').toLowerCase(),
    type: s.attrs.type,
    isDefault: on({ attrs: { val: s.attrs.default ?? '0' } }),
    basedOn: kid(s, 'basedOn')?.attrs.val,
    numPr: path(s, 'pPr', 'numPr'),
    outline: path(s, 'pPr', 'outlineLvl')?.attrs.val,
    rPr: kid(s, 'rPr'),
    pPr: kid(s, 'pPr'),
    tblPr: kid(s, 'tblPr'),
    tcPr: kid(s, 'tcPr'),
    parts: new Map(kids(s, 'tblStylePr').map((t) => [t.attrs.type, t])),
  }]));
  const defaultStyle = (type) => [...styles.entries()].find(([, s]) => s.type === type && s.isDefault)?.[0];
  const defaultParagraphStyle = defaultStyle('paragraph');
  const defaultTableStyle = defaultStyle('table');
  const docDefaultRPr = path(stylesXml, 'docDefaults', 'rPrDefault', 'rPr');
  /** The style and the styles it is based on, the style itself first. */
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
    const ext = file.split('.').pop().toLowerCase();
    const mime = IMAGE_MIME[ext];
    stats.images++;
    if (!mime || !files[file]) return { lost: ext.toUpperCase() };
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

  /** Run properties: the paragraph's base (defaults, table and paragraph style), character style, direct. */
  function runProps(rPr) {
    const props = { ...paragraph?.base };
    for (const s of styleChain(path(rPr, 'rStyle')?.attrs.val).reverse()) applyRPr(s.rPr, props);
    return applyRPr(rPr, props);
  }

  function marksFor(rPr, ctx) {
    const props = runProps(rPr);
    const link = !!(ctx.href || fields.some((f) => f.kind === 'link' && f.separated));
    const marks = [];
    if (props.bold) marks.push({ type: 'bold' });
    if (props.italic) marks.push({ type: 'italic' });
    // Links bring their own underline and colour.
    if (props.underline && !link) marks.push({ type: 'underline' });
    if (props.strike) marks.push({ type: 'strike' });
    if (props.valign === 'superscript') marks.push({ type: 'superscript' });
    if (props.valign === 'subscript') marks.push({ type: 'subscript' });
    if (props.color && !link) marks.push({ type: 'textColor', attrs: { color: props.color } });
    const highlight = props.highlight || props.shading;
    if (highlight) marks.push({ type: 'highlight', attrs: { color: highlight } });
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
    if (node.lost) lost(ctx, 'image', node.lost);
    else push({ ...node, marks: contextMarks(ctx) });
  }

  /** A picture that cannot be shown here stays visible as a placeholder in the text. */
  function lost(ctx, kind, format = '') {
    const value = placeholder(kind, format);
    push({ type: 'text', text: value, marks: [{ type: 'italic' }, ...contextMarks(ctx)] }, value);
  }

  function run(r, ctx) {
    runContent(kids(r), kid(r, 'rPr'), ctx);
  }

  /** Text boxes: their paragraphs and tables follow the paragraph that holds the box. */
  function textBoxes(el, ctx) {
    if (hiddenByField() || !paragraph) return;
    const outer = paragraph;
    for (const box of findAll(el, 'txbxContent')) {
      outer.after.push(...items(kids(box), { change: ctx.change }));
      paragraph = outer;
    }
  }

  /** Pictures of a drawing, a VML shape or an OLE object (its preview); charts without picture get a placeholder. */
  function graphics(el, ctx) {
    const inBox = (node) => findAll(el, 'txbxContent').some((box) => findAll(box, node.name).includes(node));
    const blips = findAll(el, 'blip').filter((b) => b.attrs.embed && !inBox(b));
    const vml = findAll(el, 'imagedata').filter((d) => d.attrs.id && !inBox(d));
    const docPr = findAll(el, 'docPr')[0];
    const alt = docPr?.attrs.descr || docPr?.attrs.title || vml[0]?.attrs.title;
    const single = blips.length + vml.length === 1;
    const cx = single ? Number(findAll(el, 'extent')[0]?.attrs.cx) : undefined;
    const seen = new Set();
    for (const id of [...blips.map((b) => b.attrs.embed), ...vml.map((d) => d.attrs.id)]) {
      if (seen.has(id)) continue;
      seen.add(id);
      image(imageNode(id, alt, cx), ctx);
    }
    if (!seen.size && findAll(el, 'chart').length && !hiddenByField()) {
      stats.images++;
      lost(ctx, 'chart');
    }
    textBoxes(el, ctx);
  }

  /** Markup compatibility: Word's choice, unless only the fallback holds a picture (e.g. newer chart types). */
  function alternative(el) {
    const choice = kid(el, 'Choice');
    const fallback = kid(el, 'Fallback');
    const useful = (node) => ['blip', 'imagedata', 'txbxContent', 't'].some((name) => findAll(node, name).length);
    return !useful(choice) && fallback && useful(fallback) ? fallback : choice;
  }

  function runContent(children, rPr, ctx) {
    for (const c of children) {
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
        case 'drawing':
        case 'pict':
        case 'object':
          graphics(c, ctx);
          break;
        case 'AlternateContent':
          runContent(kids(alternative(c)), rPr, ctx);
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

  const ALIGN = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' };

  function paragraphStyle(p, ctx) {
    const pPr = kid(p, 'pPr');
    const chain = styleChain(path(pPr, 'pStyle')?.attrs.val || defaultParagraphStyle);
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
    // Alignment: direct, else paragraph style, else table style.
    const jc = path(pPr, 'jc') || chain.map((s) => path(s.pPr, 'jc')).find(Boolean)
      || (ctx.cell?.pPr || []).map((x) => kid(x, 'jc')).findLast(Boolean);
    // Run formatting every run of the paragraph starts from. Headings keep the editor's look: their
    // style's font colour and weight are left out.
    const base = {};
    if (!level || list) {
      applyRPr(docDefaultRPr, base);
      for (const rPr of ctx.cell?.rPr || []) applyRPr(rPr, base);
      for (const s of [...chain].reverse()) applyRPr(s.rPr, base);
    }
    return { level, list, align: ALIGN[jc?.attrs.val], base, bib: names.some((n) => BIB_STYLES.includes(n)) };
  }

  function readParagraph(p, ctx) {
    const style = paragraphStyle(p, ctx);
    paragraph = { content: [], bib: style.bib || !!ctx.bib, base: style.base, after: [] };
    inline(kids(p), ctx);
    const { content, after } = paragraph;
    const node = style.level && !style.list
      ? { type: 'heading', attrs: { level: Math.min(style.level, 3), textAlign: style.align || null }, content }
      : { type: 'paragraph', attrs: { textAlign: style.align || null }, content };
    const item = { node, list: style.list, bib: paragraph.bib };
    paragraph = null;
    return [item, ...after];
  }

  /** Child elements, looking through content controls and custom XML around rows and cells. */
  const unwrap = (nodes, name) => nodes.flatMap((c) => {
    if (c.name === name) return [c];
    if (c.name === 'sdt') return unwrap(kids(kid(c, 'sdtContent')), name);
    if (c.name === 'customXml') return unwrap(kids(c), name);
    return [];
  });

  /** Table formatting: style chain (base first), tblLook flags, borders and column widths. */
  function tableFormat(tbl) {
    const tblPr = kid(tbl, 'tblPr');
    const chain = styleChain(path(tblPr, 'tblStyle')?.attrs.val || defaultTableStyle).reverse();
    const look = path(tblPr, 'tblLook')?.attrs;
    const bits = parseInt(look?.val || (look ? '0' : '04A0'), 16);
    const flag = (name, bit) => (look?.[name] !== undefined ? on({ attrs: { val: look[name] } }) : (bits & bit) !== 0);
    const borders = {};
    for (const b of [...chain.map((s) => path(s.tblPr, 'tblBorders')), kid(tblPr, 'tblBorders')]) {
      for (const side of kids(b)) borders[{ start: 'left', end: 'right' }[side.name] || side.name] = side;
    }
    let grid = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => Number(g.attrs.w) / TWIPS_PER_PX);
    if (!grid.length || grid.some((w) => !(w > 0))) grid = null;
    else {
      const total = grid.reduce((a, b) => a + b, 0);
      if (total > columnPx) grid = grid.map((w) => (w * columnPx) / total);
      grid = grid.map((w) => Math.max(20, Math.round(w)));
    }
    return {
      chain, borders, grid,
      firstRow: flag('firstRow', 0x20), lastRow: flag('lastRow', 0x40), firstCol: flag('firstColumn', 0x80),
      lastCol: flag('lastColumn', 0x100), hBand: !flag('noHBand', 0x200), vBand: !flag('noVBand', 0x400),
    };
  }

  /** Style parts that apply to the cell at (row, col), in the order Word applies them. */
  function cellParts(fmt, row, col, span, rowCount, colCount) {
    const types = [];
    const top = fmt.firstRow ? 1 : 0;
    if (fmt.vBand) types.push((col - (fmt.firstCol ? 1 : 0)) % 2 ? 'band2Vert' : 'band1Vert');
    if (fmt.hBand && row >= top) types.push((row - top) % 2 ? 'band2Horz' : 'band1Horz');
    if (fmt.firstCol && col === 0) types.push('firstCol');
    if (fmt.lastCol && col + span === colCount) types.push('lastCol');
    if (fmt.firstRow && row === 0) types.push('firstRow');
    if (fmt.lastRow && row === rowCount - 1) types.push('lastRow');
    const out = { rPr: [], pPr: [], tcPr: [] };
    for (const s of fmt.chain) {
      out.rPr.push(s.rPr);
      out.pPr.push(s.pPr);
      out.tcPr.push(s.tcPr);
    }
    for (const type of types) {
      for (const s of fmt.chain) {
        const part = s.parts.get(type);
        out.rPr.push(kid(part, 'rPr'));
        out.pPr.push(kid(part, 'pPr'));
        out.tcPr.push(kid(part, 'tcPr'));
      }
    }
    for (const key of Object.keys(out)) out[key] = out[key].filter(Boolean);
    return out;
  }

  /** Sides of a cell with a line, as "trbl" letters; null when all four have one (the editor's grid). */
  function cellBorders(fmt, tcPrs, at) {
    const side = (name, outer, inner) => {
      let el = at[outer] ? fmt.borders[name] : fmt.borders[inner];
      for (const tcPr of tcPrs) {
        const b = kid(tcPr, 'tcBorders');
        const own = kid(b, name) || kid(b, { left: 'start', right: 'end' }[name]);
        if (own) el = own;
      }
      return !!el && !NO_BORDER.includes(el.attrs.val);
    };
    const sides = [
      side('top', 'top', 'insideH') && 't',
      side('right', 'right', 'insideV') && 'r',
      side('bottom', 'bottom', 'insideH') && 'b',
      side('left', 'left', 'insideV') && 'l',
    ].filter(Boolean).join('');
    return sides === 'trbl' ? null : sides;
  }

  function cellBackground(tcPrs) {
    let fill = null;
    for (const tcPr of tcPrs) {
      const shd = kid(tcPr, 'shd');
      if (shd) fill = hexColor(shd.attrs.fill, ['ffffff']);
    }
    return fill;
  }

  function readTable(tbl) {
    const fmt = tableFormat(tbl);
    const trs = unwrap(kids(tbl), 'tr');
    const colCount = fmt.grid?.length
      || Math.max(...trs.map((tr) => unwrap(kids(tr), 'tc').reduce((n, tc) => n + Number(path(tc, 'tcPr', 'gridSpan')?.attrs.val || 1), 0)));
    const rows = [];
    const merges = new Map(); // column -> cell that a vertical merge continues
    trs.forEach((tr, r) => {
      const header = !!path(tr, 'trPr', 'tblHeader');
      const cells = [];
      let col = Number(path(tr, 'trPr', 'gridBefore')?.attrs.val || 0);
      for (const tc of unwrap(kids(tr), 'tc')) {
        const tcPr = kid(tc, 'tcPr');
        const colspan = Number(path(tcPr, 'gridSpan')?.attrs.val || 1);
        const vMerge = path(tcPr, 'vMerge');
        const parts = cellParts(fmt, r, col, colspan, trs.length, colCount);
        const tcPrs = [...parts.tcPr, tcPr];
        const at = { top: r === 0, bottom: r === trs.length - 1, left: col === 0, right: col + colspan >= colCount };
        const borders = cellBorders(fmt, tcPrs, at);
        if (vMerge && vMerge.attrs.val !== 'restart' && merges.has(col)) {
          // The merged cell ends where the last continuation ends: take over its bottom line.
          const cell = merges.get(col);
          cell.attrs.rowspan++;
          const own = cell.attrs.borders ?? 'trbl';
          const bottom = (borders ?? 'trbl').includes('b');
          const merged = own.replace('b', '') + (bottom ? 'b' : '');
          const sorted = 'trbl'.split('').filter((s) => merged.includes(s)).join('');
          cell.attrs.borders = sorted === 'trbl' ? null : sorted;
        } else {
          const content = blocks(kids(tc), { cell: parts });
          const colwidth = fmt.grid && col + colspan <= fmt.grid.length ? fmt.grid.slice(col, col + colspan) : null;
          const cell = {
            type: header ? 'tableHeader' : 'tableCell',
            attrs: { colspan, rowspan: 1, colwidth, background: cellBackground(tcPrs), borders },
            content: content.length ? content : [{ type: 'paragraph' }],
          };
          cells.push(cell);
          if (vMerge) merges.set(col, cell);
          else merges.delete(col);
        }
        col += colspan;
      }
      if (cells.length) rows.push({ type: 'tableRow', content: cells });
    });
    return rows.length ? { type: 'table', content: rows } : null;
  }

  /** Reads block elements into items { node, list, bib }. */
  function items(nodes, ctx = {}) {
    const out = [];
    for (const c of nodes) {
      if (c.name === 'p') out.push(...readParagraph(c, ctx));
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

  const blocks = (nodes, ctx) => nestLists(items(nodes, ctx));

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
