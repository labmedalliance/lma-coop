// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Licence, attribution and LMA branding stay in place (see NOTICE).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import * as app from '../client/src/attribution.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

test('version and licence match package.json', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(app.VERSION, pkg.version);
  assert.equal(app.LICENSE_SPDX, pkg.license);
});

test('LICENSE, NOTICE and the logo files exist', () => {
  assert.match(read('LICENSE'), /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(read('NOTICE'), /Powered by LabMed Alliance/);
  for (const file of ['lma-logo-mark.svg', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png']) {
    assert.ok(existsSync(path.join(root, 'client/public/img', file)), file);
  }
});

test('every page loads base.js, which renders the credit', () => {
  assert.match(read('client/src/base.js'), /mountCredit\(\);/);
  for (const file of readdirSync(path.join(root, 'client')).filter((f) => f.endsWith('.html'))) {
    const entry = /<script type="module" src="\.\/src\/([\w-]+\.js)">/.exec(read(`client/${file}`))?.[1];
    assert.ok(entry, `${file}: no entry script`);
    assert.match(read(`client/src/${entry}`), /from '\.\/base\.js'|import '\.\/base\.js'/, `${file}: ${entry} skips base.js`);
  }
});

test('every source file carries the SPDX header', () => {
  const dirs = ['server', 'client/src', 'scripts', 'test'];
  const missing = dirs.flatMap((dir) => readdirSync(path.join(root, dir))
    .filter((f) => /\.(js|css)$/.test(f))
    .map((f) => `${dir}/${f}`)
    .filter((f) => !read(f).includes('SPDX-License-Identifier: AGPL-3.0-or-later')));
  assert.deepEqual(missing, []);
});
