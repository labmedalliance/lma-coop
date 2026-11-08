// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
import { defineConfig, loadEnv } from 'vite';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, 'client');

// BASE_PATH (environment or .env) serves the app below a path, e.g. "/write/". The server reads the same value.
function basePath() {
  const value = process.env.BASE_PATH ?? loadEnv('production', import.meta.dirname, '').BASE_PATH ?? '';
  const trimmed = value.replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}/` : '/';
}

const base = basePath();

// Vite prefixes asset and icon URLs with the base, but not page links like <a href="/admin">.
const prefixPageLinks = {
  name: 'prefix-page-links',
  transformIndexHtml: (html) => (base === '/' ? html : html.replace(/(<a\b[^>]*\shref=")\/(?!\/)/g, `$1${base}`)),
};

export default defineConfig({
  root,
  base,
  plugins: [prefixPageLinks],
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.join(root, 'index.html'),
        login: path.join(root, 'login.html'),
        doc: path.join(root, 'doc.html'),
        admin: path.join(root, 'admin.html'),
        about: path.join(root, 'about.html'),
      },
    },
  },
});
