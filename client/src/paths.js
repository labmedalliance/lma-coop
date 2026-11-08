// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Base path of the app, e.g. "/write" when served at https://example.org/write/ (empty at the root).
// Set at build time with BASE_PATH (see vite.config.js). Also loaded on the server via the schema,
// where import.meta.env does not exist and the base is empty.

export const BASE = (import.meta.env?.BASE_URL ?? '/').replace(/\/+$/, '');

/** Prefixes an app path ("/api/me") with the base path. Other URLs stay unchanged. */
export const url = (path) => (typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') ? BASE + path : path);

/** Removes the base path again, e.g. from an image URL pasted from the editor. */
export const stripBase = (path) => (BASE && typeof path === 'string' && path.startsWith(`${BASE}/`) ? path.slice(BASE.length) : path);
