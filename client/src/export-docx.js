// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Converts the editor content (ProseMirror JSON) plus bibliography into a .docx file.
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, ExternalHyperlink, LevelFormat, InsertedTextRun, DeletedTextRun,
  CommentRangeStart, CommentRangeEnd, CommentReference, ImageRun, SimpleField,
} from 'docx';
import { citationLabel, formatReference } from './citations.js';
import { toCsl } from './csl.js';
import { t } from './i18n.js';
import { url } from './paths.js';

const HEADINGS = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 };
const ALIGN = { center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };

// Inline suggestions become Word tracked changes; set per export by exportDocx().
let changes = { author: () => t('Unbekannt'), ids: new Map(), date: new Date().toISOString() };

/** Wraps run options as inserted/deleted run if the node carries a suggestion mark. */
function trackedRun(options, marks) {
  const mark = marks.insertion || marks.deletion;
  if (!mark) return new TextRun(options);
  if (!changes.ids.has(mark.id)) changes.ids.set(mark.id, changes.ids.size + 1);
  const tracked = { ...options, id: changes.ids.get(mark.id), author: changes.author(mark.id), date: changes.date };
  return marks.insertion ? new InsertedTextRun(tracked) : new DeletedTextRun(tracked);
}

// Reference list of the exported document; set per export by exportDocx().
let refs = new Map();

/**
 * A citation as Word field with CSL JSON (as Mendeley writes it), so the import of this tool and citation
 * plugins can read the references back. Word shows the cached label.
 */
function citationField(refIds, label) {
  const items = refIds.filter((id) => refs.has(id)).map((id) => ({ id, itemData: toCsl(refs.get(id), id) }));
  if (!items.length) return new TextRun(label);
  const csl = { citationID: items.map((it) => it.id).join('-'), properties: { noteIndex: 0 }, citationItems: items };
  return new SimpleField(`ADDIN CSL_CITATION ${JSON.stringify(csl)}`, label);
}

// Images: src -> { data, type, width, height }, loaded per export by loadImages().
let images = new Map();
// Width of the text column on an A4 page with 2.54 cm margins, in pixels at 96 dpi.
const PAGE_WIDTH_PX = 600;

/** Loads every image of the document. Word takes PNG, JPEG and GIF; WebP is converted to PNG. */
async function loadImages(content) {
  const srcs = new Set();
  const walk = (nodes = []) => nodes.forEach((n) => {
    if (n.type === 'image' && n.attrs?.src) srcs.add(n.attrs.src);
    walk(n.content);
  });
  walk(content);
  images = new Map();
  await Promise.all([...srcs].map(async (src) => {
    try {
      const res = await fetch(url(src));
      if (!res.ok) return;
      let blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      const { width, height } = bitmap;
      let type = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' }[blob.type];
      if (!type) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        type = 'png';
      }
      bitmap.close();
      images.set(src, { data: new Uint8Array(await blob.arrayBuffer()), type, width, height });
    } catch {
      // Image cannot be loaded: it is left out of the export.
    }
  }));
}

function imageRun(n) {
  const image = images.get(n.attrs?.src);
  if (!image) return [];
  const width = n.attrs.width ? PAGE_WIDTH_PX * (n.attrs.width / 100) : Math.min(image.width, PAGE_WIDTH_PX);
  const height = width * (image.height / image.width);
  return [new ImageRun({
    type: image.type,
    data: image.data,
    transformation: { width: Math.round(width), height: Math.round(height) },
    altText: { name: n.attrs.alt || t('Bild'), description: n.attrs.alt || '', title: n.attrs.alt || '' },
  })];
}

// Comment anchors: inline node -> Word comment ids that start before / end after it. Set per export.
let anchors = new Map();

const commentThreadIds = (node) => (node.marks || []).filter((m) => m.type === 'comment').map((m) => m.attrs?.threadId);

/**
 * Turns comment threads into Word comments (replies threaded, resolved state kept) and finds the first
 * and last inline node of every anchor. Threads whose anchor is gone are left out.
 */
function prepareComments(content, threads) {
  anchors = new Map();
  const byThread = new Map(threads.map((th) => [th.id, th]));
  const span = new Map(); // threadId -> { first, last }
  const walk = (nodes = []) => nodes.forEach((n) => {
    if (n.type === 'text' || n.type === 'citation' || n.type === 'hardBreak' || n.type === 'image') {
      for (const id of commentThreadIds(n)) {
        if (!byThread.has(id)) continue;
        if (span.has(id)) span.get(id).last = n;
        else span.set(id, { first: n, last: n });
      }
    } else {
      walk(n.content);
    }
  });
  walk(content);

  const comments = [];
  const at = (node) => {
    if (!anchors.has(node)) anchors.set(node, { start: [], end: [] });
    return anchors.get(node);
  };
  for (const [threadId, { first, last }] of span) {
    const thread = byThread.get(threadId);
    const rootId = comments.length;
    thread.comments.forEach((c, i) => {
      const author = c.author || t('Unbekannt');
      comments.push({
        id: comments.length,
        author,
        initials: author.split(/\s+/).map((p) => p[0]).join('').slice(0, 3).toUpperCase(),
        date: new Date(c.createdAt),
        children: c.body.split('\n').map((line) => new Paragraph(line)),
        ...(i > 0 && { parentId: rootId }),
        ...(thread.resolvedAt && { resolved: true }),
      });
    });
    at(first).start.push(rootId);
    at(last).end.push(rootId);
  }
  return comments;
}

function runs(nodes = [], numbers) {
  return nodes.flatMap((n) => {
    const anchor = anchors.get(n);
    if (!anchor) return inlineRuns(n, numbers);
    return [
      ...anchor.start.map((id) => new CommentRangeStart(id)),
      ...inlineRuns(n, numbers),
      ...anchor.end.flatMap((id) => [new CommentRangeEnd(id), new TextRun({ children: [new CommentReference(id)] })]),
    ];
  });
}

function inlineRuns(n, numbers) {
  const marks = Object.fromEntries((n.marks || []).map((m) => [m.type, m.attrs || true]));
  if (n.type === 'hardBreak') return [new TextRun({ text: '', break: 1 })];
  // Suggested images are exported like accepted ones; Word cannot track an inserted image here.
  if (n.type === 'image') return imageRun(n);
  if (n.type === 'citation') {
    const label = citationLabel(n.attrs.refIds, numbers);
    if (marks.insertion || marks.deletion) return [trackedRun({ text: label }, marks)];
    return [citationField(n.attrs.refIds, label)];
  }
  if (n.type !== 'text') return [];
  const text = n.text.replace(/\u200B/g, ''); // zero-width spaces mark suggested paragraph breaks
  if (!text) return [];
  const run = trackedRun({
    text,
    bold: !!marks.bold,
    italics: !!marks.italic,
    underline: marks.underline ? {} : undefined,
    strike: !!marks.strike,
    superScript: !!marks.superscript,
    subScript: !!marks.subscript,
    style: marks.link ? 'Hyperlink' : undefined,
  }, marks);
  return marks.link ? [new ExternalHyperlink({ link: marks.link.href, children: [run] })] : [run];
}

function blocks(nodes = [], numbers, ctx = { list: null, level: 0, quote: false }) {
  return nodes.flatMap((n) => {
    const alignment = ALIGN[n.attrs?.textAlign];
    switch (n.type) {
      case 'paragraph':
        return [new Paragraph({
          children: runs(n.content, numbers),
          alignment,
          indent: ctx.quote ? { left: 720 } : undefined,
          ...(ctx.list === 'bullet' && { bullet: { level: ctx.level } }),
          ...(ctx.list === 'ordered' && { numbering: { reference: 'ordered', level: ctx.level } }),
        })];
      case 'heading':
        return [new Paragraph({ children: runs(n.content, numbers), heading: HEADINGS[n.attrs.level], alignment })];
      case 'bulletList':
      case 'orderedList':
        return (n.content || []).flatMap((item) => blocks(item.content, numbers, {
          ...ctx,
          list: n.type === 'bulletList' ? 'bullet' : 'ordered',
          level: ctx.list ? ctx.level + 1 : 0,
        }));
      case 'blockquote':
        return blocks(n.content, numbers, { ...ctx, quote: true });
      case 'table':
        return [new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: (n.content || []).map((row) => new TableRow({
            children: (row.content || []).map((cell) => new TableCell({
              children: blocks(cell.content, numbers),
              columnSpan: cell.attrs?.colspan,
              rowSpan: cell.attrs?.rowspan,
            })),
          })),
        })];
      case 'horizontalRule':
        return [new Paragraph({ thematicBreak: true })];
      case 'codeBlock':
        return [new Paragraph({ children: [new TextRun({ text: (n.content || []).map((t) => t.text).join(''), font: 'Courier New' })] })];
      default:
        return [];
    }
  });
}

/**
 * Builds and downloads the .docx for the given editor, references map and title.
 * `authorOf(suggestionId)` names the author of a suggestion for Word's change tracking.
 * `threads` (from the comment panel) become Word comments.
 */
export async function exportDocx(editor, references, numbers, title, authorOf, threads = []) {
  changes = { author: authorOf, ids: new Map(), date: new Date().toISOString() };
  refs = new Map(references.entries());
  const content = editor.getJSON().content;
  await loadImages(content);
  const comments = prepareComments(content, threads);
  const body = blocks(content, numbers);
  const cited = [...numbers.entries()].sort((a, b) => a[1] - b[1]);
  if (cited.length) {
    body.push(new Paragraph({ text: t('Literatur'), heading: HeadingLevel.HEADING_2 }));
    for (const [id, num] of cited) {
      const ref = references.get(id);
      body.push(new Paragraph({
        style: 'Bibliography', // lets the import drop this list again
        children: [new TextRun(`${num}. ${ref ? formatReference(ref) : t('(Quelle fehlt)')}`)],
      }));
    }
  }
  const doc = new Document({
    title,
    comments: { children: comments },
    styles: {
      default: { document: { run: { font: 'Calibri', size: 24 } } },
      paragraphStyles: [{ id: 'Bibliography', name: 'Bibliography', basedOn: 'Normal', next: 'Normal' }],
    },
    numbering: {
      config: [{
        reference: 'ordered',
        levels: [0, 1, 2, 3].map((level) => ({
          level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
        })),
      }],
    },
    sections: [{ children: body }],
  });
  const blob = await Packer.toBlob(doc);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[\\/:*?"<>|]+/g, '_') || t('Dokument')}.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
