// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
import { defineConfig } from 'vite';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, 'client');

export default defineConfig({
  root,
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
