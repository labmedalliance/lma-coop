// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
import { api, logout, toast } from './base.js';
import { t, locale } from './i18n.js';
import { url } from './paths.js';
import { statusBadge } from './status.js';

const grid = document.getElementById('doc-grid');
const empty = document.getElementById('empty-state');
const filter = document.getElementById('filter');
const stateFilter = document.getElementById('state-filter');
let docs = [];
let others = [];

const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
const ROLE_BADGES = { editor: [t('Bearbeiten'), 'bg-blue-lt'], suggester: [t('Vorschlagen'), 'bg-orange-lt'] };

// "active" hides archived documents; "all" shows everything; otherwise exactly that status.
function matches(d, q) {
  const state = stateFilter.value;
  const stateOk = state === 'all' || (state === 'active' ? d.status !== 'archived' : d.status === state);
  return stateOk && d.title.toLowerCase().includes(q);
}

function render() {
  const q = filter.value.trim().toLowerCase();
  const shown = docs.filter((d) => matches(d, q));
  grid.replaceChildren(...shown.map((d) => {
    const card = document.createElement('div');
    card.className = 'card card-link doc-card';
    const link = document.createElement('a');
    link.href = url(`/d/${d.id}`);
    link.className = 'card-body text-reset text-decoration-none';
    const title = document.createElement('div');
    title.className = 'fw-bold mb-1 text-truncate';
    title.textContent = d.title;
    const meta = document.createElement('div');
    meta.className = 'text-secondary small';
    meta.textContent = `${d.owner || '–'} · ${dateFmt.format(d.updated_at)}`;
    link.append(title, meta);
    const state = statusBadge(d.status);
    if (state) link.append(state);
    if (ROLE_BADGES[d.role]) {
      const [text, cls] = ROLE_BADGES[d.role];
      const badge = document.createElement('span');
      badge.className = `badge ${cls} d-inline-block mt-2 ms-1`;
      badge.textContent = t('Geteilt · {role}', { role: text });
      link.append(badge);
    }
    if (d.requests) {
      const badge = document.createElement('span');
      badge.className = 'badge bg-red-lt d-inline-block mt-2 ms-1';
      badge.textContent = d.requests === 1 ? t('1 offener Antrag') : t('{n} offene Anträge', { n: d.requests });
      link.append(badge);
    }
    card.append(link);
    if (d.role !== 'owner') return card;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-ghost-danger btn-icon doc-delete';
    del.setAttribute('aria-label', t('„{title}" löschen', { title: d.title }));
    del.innerHTML = '<i class="ti ti-trash"></i>';
    del.addEventListener('click', () => confirmRemove(d));
    card.append(del);
    return card;
  }));
  empty.classList.toggle('d-none', docs.length > 0);
  const hiddenEl = document.getElementById('state-empty');
  hiddenEl.hidden = !(docs.length > 0 && shown.length === 0);
  renderOthers(q);
}

// Documents of others: title and owner only; the card opens the access request page.
function renderOthers(q) {
  const shown = others.filter((d) => matches(d, q));
  document.getElementById('other-section').hidden = !shown.length;
  document.getElementById('other-grid').replaceChildren(...shown.map((d) => {
    const card = document.createElement('div');
    card.className = 'card card-link doc-card doc-card-locked';
    const link = document.createElement('a');
    link.href = url(`/d/${d.id}`);
    link.className = 'card-body text-reset text-decoration-none';
    const title = document.createElement('div');
    title.className = 'fw-bold mb-1 text-truncate';
    title.textContent = d.title;
    const meta = document.createElement('div');
    meta.className = 'text-secondary small';
    meta.textContent = `${d.owner || '–'} · ${dateFmt.format(d.updated_at)}`;
    const action = document.createElement('span');
    if (d.requested) {
      action.className = 'badge bg-yellow-lt d-inline-block mt-2';
      action.textContent = t('Beantragt · {role}', { role: ROLE_BADGES[d.requested][0] });
    } else {
      action.className = 'd-inline-block mt-2 small text-primary';
      action.innerHTML = '<i class="ti ti-lock me-1"></i>';
      action.append(t('Zugriff beantragen'));
    }
    const state = statusBadge(d.status);
    link.append(title, meta, ...(state ? [state] : []), action);
    card.append(link);
    return card;
  }));
}

async function load() {
  [docs, others] = await Promise.all([api('/api/docs'), api('/api/docs/discover')]);
  render();
}

// Only the owner sees the delete button; the server enforces the same rule.
const deleteDialog = document.getElementById('delete-dialog');
let deleteTarget = null;
function confirmRemove(doc) {
  deleteTarget = doc;
  document.getElementById('delete-text').textContent =
    t('„{title}" wird gelöscht. Alle Personen mit Freigabe verlieren den Zugriff.', { title: doc.title });
  deleteDialog.returnValue = '';
  deleteDialog.showModal();
}
deleteDialog.addEventListener('close', () => {
  if (deleteDialog.returnValue === 'ok' && deleteTarget) remove(deleteTarget);
  deleteTarget = null;
});

async function remove(doc) {
  await api(`/api/docs/${doc.id}`, { method: 'DELETE' });
  await load();
  toast(t('„{title}" gelöscht', { title: doc.title }), {
    actionLabel: t('Rückgängig'),
    onAction: async () => { await api(`/api/docs/${doc.id}/restore`, { method: 'POST' }); load(); },
  });
}

document.getElementById('new-doc-btn').addEventListener('click', async () => {
  const { id } = await api('/api/docs', { method: 'POST', body: { title: t('Unbenanntes Dokument') } });
  window.location.href = url(`/d/${id}`);
});
document.getElementById('logout-btn').addEventListener('click', logout);
filter.addEventListener('input', render);
stateFilter.addEventListener('change', () => {
  render();
  try { localStorage.setItem('lma-coop-state-filter', stateFilter.value); } catch { /* storage blocked */ }
});
try {
  const saved = localStorage.getItem('lma-coop-state-filter');
  if (saved && [...stateFilter.options].some((o) => o.value === saved)) stateFilter.value = saved;
} catch { /* storage blocked */ }

api('/api/me').then((me) => {
  document.getElementById('me-name').textContent = me.name;
  document.getElementById('admin-link').hidden = !me.isAdmin;
});
load();
