// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// User and role administration page.
import { api, toast } from './base.js';
import { t } from './i18n.js';

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

load();
