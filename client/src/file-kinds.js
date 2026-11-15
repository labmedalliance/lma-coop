// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Icons and sizes for files with versions (list and file page).
import { locale } from './i18n.js';

const ICONS = {
  xlsx: 'ti-file-spreadsheet', xlsm: 'ti-file-spreadsheet', xls: 'ti-file-spreadsheet', csv: 'ti-file-spreadsheet',
  ods: 'ti-file-spreadsheet',
  docx: 'ti-file-word', doc: 'ti-file-word', odt: 'ti-file-word',
  pptx: 'ti-presentation', ppt: 'ti-presentation', odp: 'ti-presentation',
  pdf: 'ti-file-type-pdf', zip: 'ti-file-zip', png: 'ti-photo', jpg: 'ti-photo', jpeg: 'ti-photo',
};

/** Tabler icon class for a file extension ("xlsx"). */
export const fileIcon = (ext) => ICONS[String(ext).toLowerCase()] || 'ti-file';

/** Extension of a file name, lower case, without the dot. */
export const extOf = (name) => (String(name || '').match(/\.([^.]+)$/)?.[1] || '').toLowerCase();

/** "12 KB", "3,4 MB". */
export function formatSize(bytes) {
  const fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${fmt.format(bytes / 1024)} KB`;
  return `${fmt.format(bytes / 1024 / 1024)} MB`;
}
