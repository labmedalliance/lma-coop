// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// File page: a file with versions (Excel, PowerPoint, PDF …). Download, check out, upload the changed file,
// restore an old version. The rules against a version mess live on the server (server/files.js).
import { api, toast } from './base.js';
import { STATUSES } from './status.js';
import { t, locale } from './i18n.js';
import { url } from './paths.js';
import { setupSharing } from './share.js';
import { showNoAccess, setupEditRequest } from './access.js';
import { kindIcon, formatSize, extOf } from './file-kinds.js';
import './editor.css';

const docId = window.location.pathname.split('/').pop();
const $ = (id) => document.getElementById(id);
const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
const fileApi = `/api/docs/${docId}/file`;

let me;
let meta;
try {
  [me, meta] = await Promise.all([api('/api/me'), api(`/api/docs/${docId}`)]);
} catch {
  await showNoAccess(docId);
  await new Promise(() => {});
}
if (meta.kind !== 'file') {
  window.location.replace(url(`/d/${docId}`));
  await new Promise(() => {});
}
const role = meta.role;
const canChange = role === 'owner' || role === 'editor';
let state = { versions: [], checkout: null, canDownload: false };
let canDownload = false;

// --- Title and status (same as the document page) ----------------------------

const titleInput = $('doc-title');
titleInput.value = meta.title;
titleInput.readOnly = !canChange;
document.title = `${meta.title} – LMA Coop`;
titleInput.addEventListener('change', async () => {
  const title = titleInput.value.trim() || meta.title;
  titleInput.value = title;
  meta.title = title;
  document.title = `${title} – LMA Coop`;
  await api(`/api/docs/${docId}`, { method: 'PATCH', body: { title } });
  render();
});
titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') titleInput.blur(); });

const stateSelect = $('doc-state');
stateSelect.append(...Object.entries(STATUSES).map(([value, s]) => new Option(s.label, value)));
stateSelect.value = meta.status;
stateSelect.disabled = !canChange;
stateSelect.dataset.state = meta.status;
stateSelect.addEventListener('change', async () => {
  try {
    await api(`/api/docs/${docId}`, { method: 'PATCH', body: { status: stateSelect.value } });
    stateSelect.dataset.state = stateSelect.value;
  } catch (err) {
    stateSelect.value = stateSelect.dataset.state;
    toast(err.message);
  }
});

// --- Downloads ----------------------------------------------------------------

/** Starts the download of one version ("latest" or a number) through a hidden link. */
function download(version = 'latest') {
  const a = document.createElement('a');
  a.href = url(`${fileApi}/versions/${version}`);
  a.download = '';
  document.body.append(a);
  a.click();
  a.remove();
}

/** POST/DELETE without a JSON body; returns the parsed answer and keeps error details (code, version …). */
async function call(path, method, { body, headers } = {}) {
  const res = await fetch(url(path), { method, body, headers });
  if (res.status === 401) window.location.href = url('/login');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ? t(data.error) : `${t('Fehler')} ${res.status}`), { data });
  return data;
}

/** User-facing text for a refused upload or checkout, built from the error code. */
function explain(err) {
  const d = err.data || {};
  switch (d.code) {
    case 'unchanged':
      return t('Die Datei ist unverändert. Sie gleicht der aktuellen Version {v}.', { v: d.version });
    case 'old-version':
      return t('Das ist Version {v}, aktuell ist Version {current}. Du hast vermutlich eine alte Fassung gewählt. Lade die aktuelle Version herunter und übertrage deine Änderungen.', { v: d.version, current: d.current });
    case 'outdated':
      return t('Deine Datei beruht auf Version {base}, inzwischen gibt es Version {current}. Lade die aktuelle Version herunter und übertrage deine Änderungen.', { base: d.base, current: d.current });
    case 'wrong-type':
      return t('Falscher Dateityp: erwartet .{expected}, gewählt .{got}.', { expected: d.expected, got: d.got || '–' });
    case 'quota':
      return t('Dein Speicherplatz für Dateien ist voll (höchstens {mb} MB). Bitte die Eigentümer:in, alte Versionen zu löschen.', { mb: d.quotaMb });
    case 'checked-out':
      return t('{name} bearbeitet die Datei gerade.', { name: d.checkout?.name || t('Jemand') });
    case 'not-checked-out':
      return d.checkout
        ? t('{name} bearbeitet die Datei gerade. Deine Reservierung wurde aufgehoben.', { name: d.checkout.name })
        : t('Deine Reservierung wurde aufgehoben. Lade die Datei erneut mit „Zum Bearbeiten herunterladen“.');
    default:
      return err.message;
  }
}

// --- Rendering --------------------------------------------------------------------

function render() {
  // Answers of checkout/upload carry no canDownload; keep the last known value.
  if (typeof state.canDownload === 'boolean') canDownload = state.canDownload;
  else state.canDownload = canDownload;
  const [latest] = state.versions;
  if (!latest) return;
  const ext = extOf(latest.name);
  $('file-icon').replaceChildren(kindIcon({ kind: 'file', file_name: latest.name }, 'avatar-lg'));
  $('current-title').textContent = t('Version {v}', { v: latest.version });
  $('current-meta').textContent = `${latest.user || t('unbekannt')} · ${dateFmt.format(latest.created_at)} · ${formatSize(latest.size)}${ext ? ` · .${ext}` : ''}`;
  $('current-note').textContent = noteText(latest);

  const co = state.checkout;
  const mine = co && co.userId === me.id;
  const box = $('checkout-box');
  box.hidden = !co;
  if (co) {
    box.className = `alert mt-3 mb-0 ${mine ? 'alert-info' : 'alert-warning'}`;
    box.textContent = mine
      ? t('Du bearbeitest diese Datei seit {at}. Lade die geänderte Datei hoch, wenn du fertig bist. Bis dahin kann niemand sonst eine neue Version hochladen.', { at: dateFmt.format(co.at) })
      : canChange
        ? t('{name} bearbeitet diese Datei seit {at}. Du kannst sie herunterladen, aber erst danach eine neue Version hochladen.', { name: co.name, at: dateFmt.format(co.at) })
        : t('{name} bearbeitet diese Datei seit {at}.', { name: co.name, at: dateFmt.format(co.at) });
  }
  // Without download permission the page shows the file and its history, but no download.
  $('download-btn').hidden = !state.canDownload;
  $('no-download').hidden = state.canDownload;
  $('checkout-btn').hidden = !canChange || !!co;
  $('upload-btn').hidden = !mine;
  $('release-btn').hidden = !mine;
  $('break-btn').hidden = !(co && !mine && role === 'owner');
  $('how-to').hidden = !canChange;

  $('version-rows').replaceChildren(...state.versions.map((v) => {
    const tr = document.createElement('tr');
    const cells = [
      t('Version {v}', { v: v.version }) + (v === latest ? ` (${t('aktuell')})` : ''),
      dateFmt.format(v.created_at),
      v.user || t('unbekannt'),
      formatSize(v.size),
      noteText(v),
    ];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (i === 3) td.className = 'd-none d-md-table-cell text-secondary';
      if (i === 4) td.className = 'text-secondary small';
      tr.append(td);
    });
    const actions = document.createElement('td');
    actions.className = 'text-end text-nowrap';
    if (state.canDownload) {
      const dl = button('ti-download', t('Version {v} herunterladen', { v: v.version }));
      dl.addEventListener('click', () => download(v.version));
      actions.append(dl);
    }
    if (canChange && v !== latest && !(co && !mine)) {
      const restore = button('ti-history', t('Version {v} wiederherstellen', { v: v.version }));
      restore.addEventListener('click', () => confirmRestore(v));
      actions.append(restore);
    }
    if (role === 'owner' && v !== latest) {
      const del = button('ti-trash', t('Version {v} löschen', { v: v.version }));
      del.classList.replace('btn-ghost-secondary', 'btn-ghost-danger');
      del.addEventListener('click', () => confirmDeleteVersion(v));
      actions.append(del);
    }
    tr.append(actions);
    return tr;
  }));
}

function noteText(v) {
  if (v.restored_from) return t('Wiederhergestellt aus Version {v}', { v: v.restored_from });
  return v.note || '';
}

function button(icon, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-ghost-secondary btn-icon btn-sm';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = `<i class="ti ${icon}"></i>`;
  return b;
}

async function load() {
  state = await api(fileApi);
  render();
}

// --- Confirm dialog -------------------------------------------------------------

const confirmDialog = $('confirm-dialog');
function confirmAction(text, okLabel) {
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = okLabel;
  confirmDialog.returnValue = '';
  confirmDialog.showModal();
  return new Promise((resolve) => {
    confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'ok'), { once: true });
  });
}

// --- Actions ----------------------------------------------------------------------

$('download-btn').addEventListener('click', () => download());

$('checkout-btn').addEventListener('click', async () => {
  try {
    state = await call(`${fileApi}/checkout`, 'POST');
    render();
    download();
    toast(t('Die Datei ist jetzt für dich reserviert. Lade die geänderte Datei hier wieder hoch.'));
  } catch (err) {
    if (err.data?.versions) { state = err.data; render(); }
    toast(explain(err));
  }
});

$('release-btn').addEventListener('click', async () => {
  if (!await confirmAction(t('Deine Reservierung endet, ohne dass eine neue Version entsteht. Änderungen in deiner heruntergeladenen Datei kannst du dann nicht mehr hochladen, ohne die Datei erneut zu reservieren.'), t('Bearbeitung beenden'))) return;
  state = await call(`${fileApi}/checkout`, 'DELETE');
  render();
});

$('break-btn').addEventListener('click', async () => {
  const name = state.checkout?.name;
  if (!await confirmAction(t('{name} kann die Änderungen dann nicht mehr hochladen. Sprich dich am besten vorher ab.', { name }), t('Reservierung aufheben'))) return;
  try {
    state = await call(`${fileApi}/checkout`, 'DELETE');
    render();
  } catch (err) {
    toast(explain(err));
  }
});

async function confirmRestore(v) {
  const latest = state.versions[0];
  if (!await confirmAction(t('Version {v} wird als neue Version {next} gespeichert. Version {current} bleibt im Verlauf erhalten.', { v: v.version, next: latest.version + 1, current: latest.version }), t('Wiederherstellen'))) return;
  try {
    state = await call(`${fileApi}/versions/${v.version}/restore`, 'POST');
    render();
    toast(t('Version {v} wiederhergestellt', { v: v.version }));
  } catch (err) {
    if (err.data?.versions) { state = err.data; render(); }
    toast(explain(err));
  }
}

// Owner only: removes an old version for good, e.g. one that contains personal data by mistake.
async function confirmDeleteVersion(v) {
  if (!await confirmAction(t('Version {v} wird endgültig gelöscht. Das lässt sich nicht rückgängig machen.', { v: v.version }), t('Löschen'))) return;
  try {
    state = await call(`${fileApi}/versions/${v.version}`, 'DELETE');
    render();
    toast(t('Version {v} gelöscht', { v: v.version }));
  } catch (err) {
    toast(explain(err));
  }
}

// Upload dialog. Warns (without blocking) if the chosen file was last saved before the checkout: then it is
// probably not the copy that was just edited.
const uploadDialog = $('upload-dialog');
const fileInput = $('upload-file');
$('upload-btn').addEventListener('click', () => {
  $('upload-form').reset();
  $('upload-error').textContent = '';
  $('upload-warning').hidden = true;
  const ext = state.versions[0].name.match(/\.[^.]+$/)?.[0] || '';
  fileInput.accept = ext;
  $('upload-hint').textContent = t('Wähle die Datei, die du seit {at} bearbeitet hast. Sie wird Version {next}.', {
    at: dateFmt.format(state.checkout.at), next: state.versions[0].version + 1,
  });
  uploadDialog.showModal();
});
fileInput.addEventListener('change', () => {
  const [file] = fileInput.files;
  const warning = $('upload-warning');
  warning.hidden = !(file && state.checkout && file.lastModified < state.checkout.at);
  if (!warning.hidden) {
    warning.textContent = t('Diese Datei wurde zuletzt am {date} gespeichert, also vor deiner Reservierung. Ist das wirklich die geänderte Fassung?', { date: dateFmt.format(file.lastModified) });
  }
});
$('upload-submit').addEventListener('click', async () => {
  const [file] = fileInput.files;
  if (!file) { $('upload-error').textContent = t('Bitte eine Datei wählen'); return; }
  const submit = $('upload-submit');
  submit.disabled = true;
  try {
    state = await call(`${fileApi}/versions`, 'POST', {
      body: file,
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
        'X-Note': encodeURIComponent($('upload-note').value.trim()),
      },
    });
    uploadDialog.close();
    render();
    toast(t('Version {v} gespeichert', { v: state.versions[0].version }));
  } catch (err) {
    $('upload-error').textContent = explain(err);
    if (err.data?.code === 'not-checked-out') load();
  } finally {
    submit.disabled = false;
  }
});

// --- Sharing and requests -------------------------------------------------------------

// No live connection on this page; the owner sees new requests when opening the dialog.
setupSharing({ docId, role, provider: { on() {} }, isFile: true });
if ((role === 'suggester' || role === 'viewer') && me.canRequest) setupEditRequest(docId, 'suggester');

await load();
// Others may check out or upload meanwhile; refresh while the page is visible.
setInterval(() => { if (!document.hidden && !uploadDialog.open) load().catch(() => {}); }, 20_000);
