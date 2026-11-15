// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Type of a list entry (text document or file with versions): icon, colour and label; file sizes.
import { locale, t } from './i18n.js';

// Colours follow the usual Office colours, so the type is clear at a glance. `tone` is a Tabler colour name.
const KINDS = {
  sheet: { icon: 'ti-file-spreadsheet', tone: 'green', label: 'Excel' },
  word: { icon: 'ti-file-word', tone: 'blue', label: 'Word' },
  slides: { icon: 'ti-presentation', tone: 'orange', label: 'PowerPoint' },
  pdf: { icon: 'ti-file-type-pdf', tone: 'red', label: 'PDF' },
  csv: { icon: 'ti-file-type-csv', tone: 'green', label: 'CSV' },
  image: { icon: 'ti-photo', tone: 'purple', label: t('Bild') },
  zip: { icon: 'ti-file-zip', tone: 'yellow', label: 'ZIP' },
  text: { icon: 'ti-file-text', tone: 'azure', label: t('Textdokument') },
};
const BY_EXT = {
  xlsx: 'sheet', xlsm: 'sheet', xls: 'sheet', ods: 'sheet', csv: 'csv',
  docx: 'word', doc: 'word', odt: 'word', rtf: 'word',
  pptx: 'slides', ppt: 'slides', odp: 'slides',
  pdf: 'pdf', zip: 'zip', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
};

/** Extension of a file name, lower case, without the dot. */
export const extOf = (name) => (String(name || '').match(/\.([^.]+)$/)?.[1] || '').toLowerCase();

/**
 * Type of a list entry: { icon, tone, label }. Text documents of LMA Coop are "Textdokument"; files are
 * named after their extension, unknown ones by the extension itself ("SVG") or "Datei".
 */
export function kindOf(entry) {
  if (entry.kind !== 'file') return KINDS.text;
  const ext = extOf(entry.file_name);
  return KINDS[BY_EXT[ext]] || { icon: 'ti-file', tone: 'secondary', label: ext ? ext.toUpperCase() : t('Datei') };
}

/** Coloured square with the type icon, for cards and the file page. */
export function kindIcon(entry, size = '') {
  const { icon, tone, label } = kindOf(entry);
  const box = document.createElement('span');
  box.className = `avatar ${size} bg-${tone}-lt kind-icon`;
  box.title = label;
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML = `<i class="ti ${icon}"></i>`;
  return box;
}

/** "12 KB", "3,4 MB". */
export function formatSize(bytes) {
  const fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${fmt.format(bytes / 1024)} KB`;
  return `${fmt.format(bytes / 1024 / 1024)} MB`;
}
