// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Dialog for entering or editing a reference by hand: type, fields per type, live Vancouver preview.
import { t } from './i18n.js';
import { REFERENCE_TYPES, formatReference, parseNames, formatNames } from './citations.js';

export const TYPE_LABELS = {
  article: 'Zeitschriftenartikel',
  book: 'Buch',
  chapter: 'Buchkapitel',
  web: 'Webseite',
  conference: 'Konferenzbeitrag',
  report: 'Bericht',
  thesis: 'Dissertation / Abschlussarbeit',
};

const ALL = REFERENCE_TYPES;
const NAME_HINT = 'Eine Person pro Zeile: „Cadamuro J" oder „Cadamuro, Janne". Organisationen ausschreiben.';

// One entry per field. `types`: where it shows; `labels`: a different label for some types.
export const FIELDS = [
  { name: 'authors', kind: 'names', label: 'Autor:innen', types: ALL, hint: NAME_HINT,
    labels: { web: 'Autor:innen oder Organisation', report: 'Autor:innen oder Organisation' } },
  { name: 'title', label: 'Titel', types: ALL, required: true,
    labels: { chapter: 'Titel des Kapitels', conference: 'Titel des Beitrags' } },
  { name: 'journal', label: 'Zeitschrift (Abkürzung)', types: ['article'], placeholder: 'Clin Chem Lab Med', mid: true },
  { name: 'editors', kind: 'names', label: 'Herausgeber:innen', types: ['book', 'chapter', 'conference', 'report'], hint: NAME_HINT },
  { name: 'bookTitle', label: 'Titel des Buchs', types: ['chapter', 'conference'], required: ['chapter'],
    labels: { conference: 'Titel des Tagungsbands' } },
  { name: 'conference', label: 'Name der Tagung', types: ['conference'],
    hint: 'Nur nötig, wenn es keinen Tagungsband gibt.' },
  { name: 'confDate', label: 'Datum der Tagung', types: ['conference'], placeholder: '2025 May 18-22', mid: true },
  { name: 'confPlace', label: 'Ort der Tagung', types: ['conference'], placeholder: 'Brussels, Belgium', mid: true },
  { name: 'thesisType', label: 'Art der Arbeit', types: ['thesis'], placeholder: 'dissertation', mid: true,
    hint: 'Zum Beispiel dissertation, master\'s thesis.' },
  { name: 'edition', label: 'Auflage', types: ['book', 'chapter'], placeholder: '2', short: true,
    hint: 'Eine Zahl wird zu „2nd ed.".' },
  { name: 'place', label: 'Verlagsort', types: ['book', 'chapter', 'conference', 'report', 'thesis', 'web'], short: true,
    labels: { thesis: 'Ort' } },
  { name: 'publisher', label: 'Verlag', types: ['book', 'chapter', 'conference', 'report', 'thesis', 'web'], mid: true,
    labels: { thesis: 'Universität', web: 'Betreiber der Seite', report: 'Herausgebende Institution' } },
  { name: 'year', label: 'Jahr', types: ALL, inputmode: 'numeric', short: true,
    labels: { web: 'Jahr der Veröffentlichung' } },
  { name: 'volume', label: 'Band', types: ['article'], short: true },
  { name: 'issue', label: 'Heft', types: ['article'], short: true },
  { name: 'pages', label: 'Seiten', types: ['article', 'chapter', 'conference'], placeholder: '123-9', short: true },
  { name: 'reportNo', label: 'Berichtsnummer', types: ['report'], short: true },
  { name: 'updated', kind: 'date', label: 'Aktualisiert am', types: ['web'], short: true },
  { name: 'accessed', kind: 'date', label: 'Abgerufen am', types: ['web'], short: true },
  { name: 'url', kind: 'url', label: 'URL', types: ALL, required: ['web'], placeholder: 'https://',
    hint: 'Erscheint nur, wenn keine DOI angegeben ist.' },
  { name: 'doi', label: 'DOI', types: ALL, placeholder: '10.1515/cclm-…', mid: true },
  { name: 'pmid', label: 'PMID', types: ['article'], inputmode: 'numeric', short: true },
];

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Builds the dialog body once and returns open(ref?) -> Promise<ref | null>.
 * `dialog` is an empty <dialog> element from doc.html.
 */
export function setupReferenceForm(dialog) {
  const form = document.createElement('form');
  form.className = 'ref-form';
  form.noValidate = true;
  const heading = document.createElement('h2');
  heading.className = 'h3';
  heading.id = 'ref-dialog-title';
  dialog.setAttribute('aria-labelledby', heading.id);

  const typeSelect = document.createElement('select');
  typeSelect.className = 'form-select';
  typeSelect.id = 'ref-type';
  typeSelect.append(...REFERENCE_TYPES.map((type) => new Option(t(TYPE_LABELS[type]), type)));
  const typeLabel = document.createElement('label');
  typeLabel.className = 'form-label';
  typeLabel.htmlFor = typeSelect.id;
  typeLabel.textContent = t('Art der Quelle');
  const typeRow = document.createElement('div');
  typeRow.className = 'ref-field ref-field-wide';
  typeRow.append(typeLabel, typeSelect);

  const grid = document.createElement('div');
  grid.className = 'ref-grid';
  grid.append(typeRow);
  const inputs = {};
  const rows = [];
  for (const field of FIELDS) {
    const row = document.createElement('div');
    row.className = `ref-field ${field.short ? '' : field.mid ? 'ref-field-mid' : 'ref-field-wide'}`;
    const label = document.createElement('label');
    label.className = 'form-label';
    const input = document.createElement(field.kind === 'names' ? 'textarea' : 'input');
    input.className = 'form-control';
    input.id = `ref-${field.name}`;
    input.name = field.name;
    label.htmlFor = input.id;
    if (field.kind === 'names') input.rows = 2;
    else input.type = field.kind === 'date' ? 'date' : field.kind === 'url' ? 'url' : 'text';
    if (field.placeholder) input.placeholder = field.placeholder;
    if (field.inputmode) input.inputMode = field.inputmode;
    row.append(label, input);
    if (field.hint) {
      const hint = document.createElement('div');
      hint.className = 'form-hint';
      hint.textContent = t(field.hint);
      row.append(hint);
    }
    inputs[field.name] = input;
    rows.push({ field, row, label, input });
    grid.append(row);
  }

  const previewLabel = document.createElement('div');
  previewLabel.className = 'form-label';
  previewLabel.textContent = t('Vorschau (Vancouver)');
  const preview = document.createElement('p');
  preview.className = 'ref-preview';
  preview.setAttribute('aria-live', 'polite');
  const error = document.createElement('div');
  error.className = 'text-danger small';
  error.setAttribute('role', 'alert');

  const buttons = document.createElement('div');
  buttons.className = 'd-flex justify-content-end gap-2 mt-3';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn';
  cancel.textContent = t('Abbrechen');
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn-primary';
  submit.textContent = t('Speichern');
  buttons.append(cancel, submit);

  const footer = document.createElement('div');
  footer.className = 'ref-footer';
  footer.append(previewLabel, preview, error, buttons);
  form.append(heading, grid, footer);
  dialog.append(form);

  const isRequired = (field, type) => field.required === true || (Array.isArray(field.required) && field.required.includes(type));

  function collect() {
    const type = typeSelect.value;
    const ref = { type };
    for (const { field, input } of rows) {
      if (!field.types.includes(type)) continue;
      if (field.kind === 'names') {
        const names = parseNames(input.value);
        if (names.length) ref[field.name] = names;
      } else if (input.value.trim()) {
        ref[field.name] = input.value.trim();
      }
    }
    if (type === 'article') delete ref.type; // same shape as DOI/PMID lookups
    return ref;
  }

  function update() {
    const type = typeSelect.value;
    for (const { field, row, label } of rows) {
      row.hidden = !field.types.includes(type);
      label.textContent = t(field.labels?.[type] || field.label) + (isRequired(field, type) ? ' *' : '');
    }
    const ref = collect();
    preview.textContent = ref.title ? formatReference(ref) : t('Gib mindestens einen Titel ein.');
  }

  typeSelect.addEventListener('change', () => {
    if (typeSelect.value === 'web' && !inputs.accessed.value) inputs.accessed.value = today();
    update();
  });
  form.addEventListener('input', update);

  let resolve = () => {};
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => resolve(null));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const type = typeSelect.value;
    const missing = rows.find(({ field, input }) => field.types.includes(type) && isRequired(field, type) && !input.value.trim());
    if (missing) {
      error.textContent = t('Bitte fülle alle Pflichtfelder (*) aus.');
      missing.input.focus();
      return;
    }
    const done = resolve;
    resolve = () => {};
    done(collect());
    dialog.close();
  });

  /** Opens the dialog, prefilled with `ref` when editing. Resolves with the new reference or null. */
  return function open(ref = null) {
    heading.textContent = t(ref ? 'Quelle bearbeiten' : 'Quelle manuell eingeben');
    typeSelect.value = ref?.type || 'article';
    for (const { field, input } of rows) {
      const value = ref?.[field.name];
      input.value = field.kind === 'names' ? formatNames(value) : value || '';
    }
    if (typeSelect.value === 'web' && !inputs.accessed.value) inputs.accessed.value = today();
    error.textContent = '';
    update();
    dialog.showModal();
    (ref ? inputs.title : typeSelect).focus();
    return new Promise((r) => { resolve = r; });
  };
}
