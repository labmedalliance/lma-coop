// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// User and role administration page.
import { api, toast } from './base.js';
import { t } from './i18n.js';
import { tagBadge } from './tags.js';

const $ = (id) => document.getElementById(id);
const me = await api('/api/me');

async function load() {
  const users = await api('/api/admin/users');
  $('user-rows').replaceChildren(...users.map((u) => {
    const tr = document.createElement('tr');

    const name = document.createElement('td');
    name.textContent = u.name;
    if (u.id === me.id) {
      const you = document.createElement('span');
      you.className = 'badge bg-secondary-lt ms-2';
      you.textContent = t('du');
      name.append(you);
    }
    const username = document.createElement('td');
    username.className = 'text-secondary';
    username.textContent = u.username;

    const admin = document.createElement('td');
    const toggle = document.createElement('label');
    toggle.className = 'form-check form-switch m-0';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'form-check-input';
    box.checked = u.isAdmin;
    box.disabled = u.id === me.id; // No self-demotion: there must always be an admin.
    box.setAttribute('aria-label', t('{name} ist Admin', { name: u.name }));
    box.addEventListener('change', async () => {
      try {
        await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { isAdmin: box.checked } });
        toast(t(box.checked ? '{name} ist jetzt Admin' : '{name} ist kein Admin mehr', { name: u.name }));
      } catch (err) {
        box.checked = !box.checked;
        toast(err.message);
      }
    });
    toggle.append(box);
    admin.append(toggle);

    const docs = document.createElement('td');
    docs.className = 'text-secondary';
    docs.textContent = String(u.ownedDocs);

    const actions = document.createElement('td');
    actions.className = 'text-nowrap';
    const perm = document.createElement('button');
    perm.type = 'button';
    perm.className = 'btn btn-ghost-secondary btn-icon';
    perm.setAttribute('aria-label', t('Berechtigungen von {name}', { name: u.name }));
    perm.title = t('Berechtigungen');
    perm.innerHTML = '<i class="ti ti-lock-access"></i>';
    perm.addEventListener('click', () => openPermissions(u));
    actions.append(perm);
    const pw = document.createElement('button');
    pw.type = 'button';
    pw.className = 'btn btn-ghost-secondary btn-icon';
    pw.setAttribute('aria-label', t('Passwort von {name} zurücksetzen', { name: u.name }));
    pw.title = t('Passwort zurücksetzen');
    pw.innerHTML = '<i class="ti ti-key"></i>';
    pw.addEventListener('click', () => resetPassword(u));
    actions.append(pw);
    if (u.id !== me.id) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn-ghost-danger btn-icon';
      del.setAttribute('aria-label', t('{name} löschen', { name: u.name }));
      del.title = t('Löschen');
      del.innerHTML = '<i class="ti ti-trash"></i>';
      del.addEventListener('click', () => remove(u));
      actions.append(del);
    }
    tr.append(name, username, admin, docs, actions);
    return tr;
  }));
}

// Deleting an account cannot be undone, so this is the one place with a confirmation.
async function remove(u) {
  const note = u.ownedDocs ? t(' Die {n} Dokument(e) dieser Person gehen an dich über.', { n: u.ownedDocs }) : '';
  if (!window.confirm(t('{name} endgültig löschen?{note}', { name: u.name, note }))) return;
  try {
    await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
    toast(t('{name} gelöscht', { name: u.name }));
    load();
  } catch (err) {
    toast(err.message);
  }
}

const pwDialog = $('pw-dialog');
let pwTarget = null;
function resetPassword(u) {
  pwTarget = u;
  $('pw-who').textContent = t('Für {name} ({username}). Bestehende Anmeldungen werden beendet.', u);
  $('pw-input').value = '';
  $('pw-error').textContent = '';
  pwDialog.showModal();
}
$('pw-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault();
  try {
    await api(`/api/admin/users/${pwTarget.id}`, { method: 'PATCH', body: { password: $('pw-input').value } });
    pwDialog.close();
    toast(t('Passwort für {name} gesetzt', { name: pwTarget.name }));
  } catch (err) {
    $('pw-error').textContent = err.message;
  }
});

// --- Permissions of one person ---

const ROLE_LABELS = { '': t('Kein Zugriff'), viewer: t('Lesen'), suggester: t('Vorschlagen'), editor: t('Bearbeiten') };
const PERMISSIONS = [
  ['canCreate', t('Neue Dokumente anlegen'), t('Auch „Word importieren“ in der Dokumentliste.')],
  ['canRequest', t('Rechte beantragen'), t('Zugriff auf fremde Dokumente oder „Bearbeiten“ statt „Vorschlagen“ beantragen.')],
  ['seeOthers', t('Fremde Dokumente in der Liste sehen'), t('Titel und Eigentümer:in unter „Weitere Dokumente“, ohne Inhalt.')],
];
const permDialog = $('perm-dialog');
let permDocs = [];
let permUser = null;

async function openPermissions(u) {
  permUser = u;
  $('perm-title').textContent = t('Berechtigungen von {name}', { name: u.name });
  $('perm-switches').replaceChildren(...PERMISSIONS.map(([field, label, hint]) => {
    const wrap = document.createElement('label');
    wrap.className = 'form-check form-switch mb-2';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'form-check-input';
    box.checked = u[field];
    box.addEventListener('change', async () => {
      try {
        await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { [field]: box.checked } });
        u[field] = box.checked;
        toast(t(box.checked ? '{name} darf jetzt: {what}' : '{name} darf nicht mehr: {what}', { name: u.name, what: label }));
      } catch (err) {
        box.checked = !box.checked;
        toast(err.message);
      }
    });
    const text = document.createElement('span');
    text.className = 'form-check-label';
    text.textContent = label;
    const small = document.createElement('span');
    small.className = 'form-check-description';
    small.textContent = hint;
    wrap.append(box, text, small);
    return wrap;
  }));
  $('perm-filter').value = '';
  permDocs = await api(`/api/admin/users/${u.id}/docs`);
  renderPermDocs();
  if (!permDialog.open) permDialog.showModal();
}

function renderPermDocs() {
  const self = permUser.id === me.id;
  const q = $('perm-filter').value.trim().toLowerCase();
  const shown = permDocs.filter((d) => d.title.toLowerCase().includes(q));
  const rows = shown.map((d) => {
    const li = document.createElement('li');
    const title = document.createElement('span');
    title.className = 'perm-doc-title';
    title.textContent = d.title;
    const owner = document.createElement('span');
    owner.className = 'd-block text-secondary small';
    owner.textContent = d.role === 'owner' ? t('gehört {name}', { name: permUser.name }) : t('von {owner}', { owner: d.owner || '–' });
    title.append(owner);
    li.append(title);
    if (d.role === 'owner') {
      const badge = document.createElement('span');
      badge.className = 'text-secondary small';
      badge.textContent = t('Eigentümer:in');
      li.append(badge);
      return li;
    }
    const select = document.createElement('select');
    select.className = 'form-select form-select-sm';
    select.disabled = self; // Admins do not open documents of others this way.
    select.setAttribute('aria-label', t('Rolle von {name} in „{title}“', { name: permUser.name, title: d.title }));
    for (const [value, label] of Object.entries(ROLE_LABELS)) select.append(new Option(label, value, false, value === (d.role || '')));
    select.addEventListener('change', () => setDocRole(d, select.value || null, select));
    li.append(select);
    return li;
  });
  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'text-secondary';
    li.textContent = t(permDocs.length ? 'Kein Dokument gefunden.' : 'Es gibt noch keine Dokumente.');
    rows.push(li);
  }
  $('perm-docs').replaceChildren(...rows);
  $('perm-docs-hint').hidden = self;
  if (self) {
    const note = document.createElement('li');
    note.className = 'text-secondary small';
    note.textContent = t('Deine eigenen Zugriffe vergibt die Eigentümer:in.');
    $('perm-docs').prepend(note);
  }
}

async function setDocRole(doc, role, select) {
  const previous = doc.role;
  try {
    await api(`/api/admin/users/${permUser.id}/docs/${doc.id}`, { method: 'PUT', body: { role } });
    doc.role = role;
    const user = permUser;
    toast(role ? t('{name}: „{role}“ in „{title}“', { name: user.name, role: ROLE_LABELS[role], title: doc.title })
      : t('{name} hat keinen Zugriff mehr auf „{title}“', { name: user.name, title: doc.title }), {
      actionLabel: t('Rückgängig'),
      onAction: async () => {
        await api(`/api/admin/users/${user.id}/docs/${doc.id}`, { method: 'PUT', body: { role: previous } });
        doc.role = previous;
        if (permDialog.open && permUser === user) renderPermDocs();
      },
    });
  } catch (err) {
    select.value = previous || '';
    toast(err.message);
  }
}

$('perm-filter').addEventListener('input', renderPermDocs);
permDialog.addEventListener('close', load);

const form = $('new-user-form');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  $('new-user-error').classList.add('d-none');
  try {
    await api('/api/admin/users', { method: 'POST', body: { ...data, isAdmin: data.isAdmin === 'on' } });
    toast(t('{name} angelegt', { name: data.name }));
    form.reset();
    load();
  } catch (err) {
    $('new-user-error').textContent = err.message;
    $('new-user-error').classList.remove('d-none');
  }
});

// --- Tags -------------------------------------------------------------------

async function loadTags() {
  const tags = await api('/api/admin/tags');
  $('tags-empty').hidden = tags.length > 0;
  $('tag-rows').replaceChildren(...tags.map((tag) => {
    const li = document.createElement('li');
    li.className = 'list-group-item tag-row';
    const preview = tagBadge(tag.name);
    const name = document.createElement('input');
    name.className = 'form-control form-control-sm';
    name.value = tag.name;
    name.maxLength = 40;
    name.setAttribute('aria-label', t('Tag „{name}" umbenennen', { name: tag.name }));
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
    name.addEventListener('change', async () => {
      try {
        await api(`/api/admin/tags/${tag.id}`, { method: 'PATCH', body: { name: name.value } });
        toast(t('Tag umbenannt'));
      } catch (err) {
        toast(err.message);
      }
      loadTags();
    });
    const docs = document.createElement('span');
    docs.className = 'text-secondary small text-nowrap';
    docs.textContent = tag.docs === 1 ? t('1 Dokument') : t('{n} Dokumente', { n: tag.docs });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-ghost-danger btn-icon';
    del.setAttribute('aria-label', t('Tag „{name}" löschen', { name: tag.name }));
    del.innerHTML = '<i class="ti ti-trash"></i>';
    del.addEventListener('click', () => removeTag(tag));
    li.append(preview, name, docs, del);
    return li;
  }));
}

// Deleting removes the tag from every document, so it asks first when documents carry it.
async function removeTag(tag) {
  if (tag.docs && !window.confirm(t('Tag „{name}" löschen? Er verschwindet aus {n} Dokument(en).', { name: tag.name, n: tag.docs }))) return;
  try {
    await api(`/api/admin/tags/${tag.id}`, { method: 'DELETE' });
    toast(t('Tag „{name}" gelöscht', { name: tag.name }));
  } catch (err) {
    toast(err.message);
  }
  loadTags();
}

$('new-tag-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { name } = await api('/api/admin/tags', { method: 'POST', body: { name: $('new-tag-name').value } });
    $('new-tag-name').value = '';
    toast(t('Tag „{name}" angelegt', { name }));
    loadTags();
  } catch (err) {
    toast(err.message);
  }
});

load();
loadTags();
