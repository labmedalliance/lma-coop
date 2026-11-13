// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Every German UI text needs an English entry: t() calls, static HTML texts and server error messages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { EN, t } from '../client/src/i18n.js';
import { FIELDS, TYPE_LABELS } from '../client/src/reference-form.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const filesIn = (dir, ext) => readdirSync(path.join(root, dir)).filter((f) => f.endsWith(ext)).map((f) => `${dir}/${f}`);
const normalize = (s) => s.replace(/\s+/g, ' ').trim();
const LETTER = /[A-Za-zÄÖÜäöüß]/;

/** String literals inside t(...) calls, including both branches of `t(cond ? 'a' : 'b')`. */
function tKeys(source) {
  const keys = [];
  for (const match of source.matchAll(/\bt\(/g)) {
    let i = match.index + 2;
    let depth = 1;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === "'") {
        const end = source.indexOf("'", i + 1);
        keys.push(source.slice(i + 1, end));
        i = end + 1;
        continue;
      }
      if (c === '(') depth++;
      if (c === ')') depth--;
      i++;
    }
  }
  return keys;
}

test('every t() key has an English translation', () => {
  const missing = filesIn('client/src', '.js')
    .flatMap((f) => tKeys(read(f)).filter((k) => LETTER.test(k) && !EN[k]).map((k) => `${f}: ${k}`));
  assert.deepEqual(missing, []);
});

test('every static HTML text has an English translation', () => {
  const missing = [];
  for (const file of filesIn('client', '.html')) {
    const html = read(file).replace(/<script[\s\S]*?<\/script>/g, '');
    const texts = [...html.matchAll(/>([^<>]+)</g)].map((m) => normalize(m[1]));
    const attrs = [...html.matchAll(/\b(?:title|placeholder|aria-label)="([^"]+)"/g)].map((m) => normalize(m[1]));
    for (const text of [...texts, ...attrs]) {
      if (LETTER.test(text) && !EN[text]) missing.push(`${file}: ${text}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every server error message has an English translation', () => {
  const missing = filesIn('server', '.js').flatMap((f) => {
    const source = read(f).replaceAll('${MIN_PASSWORD_LENGTH}', '10');
    const errors = [
      ...[...source.matchAll(/error: [`']([^`']+)[`']/g)].map((m) => m[1]),
      ...[...source.matchAll(/new Error\('([^']+)'\), \{ status/g)].map((m) => m[1]),
    ];
    return errors.filter((e) => !EN[e]).map((e) => `${f}: ${e}`);
  });
  assert.deepEqual(missing, []);
});

test('placeholders in translations match the German key', () => {
  const names = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const wrong = Object.entries(EN).filter(([de, en]) => names(de).join() !== names(en).join()).map(([de]) => de);
  assert.deepEqual(wrong, []);
});

test('t() falls back to German outside the browser and fills placeholders', () => {
  assert.equal(t('Speichern'), 'Speichern');
  assert.equal(t('{name} gelöscht', { name: 'Anna' }), 'Anna gelöscht');
});

test('labels of the manual reference form have an English translation', () => {
  const keys = [
    ...Object.values(TYPE_LABELS),
    ...FIELDS.flatMap((f) => [f.label, f.hint, ...Object.values(f.labels || {})]).filter(Boolean),
  ];
  assert.deepEqual(keys.filter((k) => !EN[k]), []);
});
