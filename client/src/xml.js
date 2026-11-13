// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Minimal XML reader for Word files (browser and Node). Namespace prefixes are dropped: "w:p" becomes "p".
// Elements are { name, attrs, children }; text is { name: '#text', text }.

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] !== '#') return ENTITIES[e] ?? m;
  return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
});
const local = (name) => name.slice(name.indexOf(':') + 1);

const TOKEN = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<[?!][\s\S]*?>|<\/[^>]+>|<([^\s/>]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Parses `xml` and returns the root element (or null). */
export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  for (const [token, cdata, open, rawAttrs, selfClosing, text] of xml.matchAll(TOKEN)) {
    const top = stack.at(-1);
    if (cdata !== undefined) top.children.push({ name: '#text', text: cdata });
    else if (text !== undefined) top.children.push({ name: '#text', text: decode(text) });
    else if (open) {
      const attrs = {};
      for (const [, key, a, b] of rawAttrs.matchAll(ATTR)) attrs[local(key)] = decode(a ?? b);
      const el = { name: local(open), attrs, children: [] };
      top.children.push(el);
      if (!selfClosing) stack.push(el);
    } else if (token.startsWith('</') && stack.length > 1) {
      stack.pop();
    }
  }
  return root.children.find((c) => c.name !== '#text') ?? null;
}

/** Child elements, optionally only those named `name`. */
export const kids = (el, name) => (el?.children || []).filter((c) => c.name !== '#text' && (!name || c.name === name));
export const kid = (el, name) => (el?.children || []).find((c) => c.name === name);

/** Follows a path of child names: path(p, 'pPr', 'pStyle'). */
export const path = (el, ...names) => names.reduce((node, name) => kid(node, name), el);

/** All text below `el`. */
export function textOf(el) {
  if (!el) return '';
  if (el.name === '#text') return el.text;
  return el.children.map(textOf).join('');
}

/** All descendants named `name`, in document order. */
export function findAll(el, name, out = []) {
  for (const c of el?.children || []) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}
