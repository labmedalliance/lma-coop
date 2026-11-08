// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// "Freigeben" dialog: owners add people as editor or suggester, change roles, remove access and
// answer access requests.
import { api, toast } from './base.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const ROLE_LABELS = { editor: t('Bearbeiten'), suggester: t('Vorschlagen') };

export function setupSharing({ docId, role, provider }) {
  const button = $('share-btn');
  if (role !== 'owner') {
    // Others can see who has access, but not change it.
    button.innerHTML = '<i class="ti ti-users me-1"></i><span class="header-label"></span>';
    button.querySelector('span').textContent = t('Zugriff');
    button.title = t('Zugriff');
    button.classList.replace('btn-primary', 'btn-ghost-secondary');
  }
  const dialog = $('share-dialog');
  const errorBox = $('share-error');
  const canManage = role === 'owner';
  $('share-add').hidden = !canManage;

  // --- Access requests (owner only) ---
  let requests = [];
  async function loadRequests({ announce = false } = {}) {
    if (!canManage) return;
    const before = new Set(requests.map((r) => r.id));
    requests = await api(`/api/docs/${docId}/requests`);
    const count = $('request-count');
    count.hidden = !requests.length;
    count.textContent = String(requests.length);
    button.title = requests.length ? t('{n} offene Anträge', { n: requests.length }) : '';
    const fresh = requests.filter((r) => !before.has(r.id));
    if (announce && fresh.length && !dialog.open) {
      toast(t('{name} bittet um „{role}“', { name: fresh[0].name, role: ROLE_LABELS[fresh[0].role] }), { actionLabel: t('Ansehen'), onAction: open });
    }
    if (dialog.open) renderRequests();
  }

  function renderRequests() {
    $('request-section').hidden = !requests.length;
    $('request-list').replaceChildren(...requests.map((r) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'member-name';
      name.textContent = r.current ? t('{name} (bisher {role})', { name: r.name, role: ROLE_LABELS[r.current] }) : r.name;
      const select = document.createElement('select');
      select.className = 'form-select form-select-sm';
      select.setAttribute('aria-label', t('Rolle für {name}', { name: r.name }));
      for (const [value, text] of Object.entries(ROLE_LABELS)) {
        if (r.current && value === r.current) continue; // Only upgrades make sense.
        const o = document.createElement('option');
        o.value = value;
        o.textContent = text;
        o.selected = value === r.role;
        select.append(o);
      }
      const actions = document.createElement('span');
      actions.className = 'd-flex gap-1';
      const accept = document.createElement('button');
      accept.type = 'button';
      accept.className = 'btn btn-sm btn-success';
      accept.textContent = t('Annehmen');
      accept.addEventListener('click', () => approve(r, select.value));
      const decline = document.createElement('button');
      decline.type = 'button';
      decline.className = 'btn btn-sm btn-ghost-danger';
      decline.textContent = t('Ablehnen');
      decline.addEventListener('click', () => declineRequest(r));
      actions.append(accept, decline);
      li.append(name, select, actions);
      return li;
    }));
  }

  const restoreRequest = (r) => api(`/api/docs/${docId}/requests/${r.id}`, {
    method: 'PUT', body: { role: r.role, created_at: r.created_at },
  });

  async function approve(r, newRole) {
    await save(r.id, newRole);
    toast(t('{name} darf jetzt „{role}“', { name: r.name, role: ROLE_LABELS[newRole] }), {
      actionLabel: t('Rückgängig'),
      onAction: async () => {
        if (r.current) await api(`/api/docs/${docId}/members/${r.id}`, { method: 'PUT', body: { role: r.current } });
        else await api(`/api/docs/${docId}/members/${r.id}`, { method: 'DELETE' });
        await restoreRequest(r);
        await refresh();
      },
    });
  }

  async function declineRequest(r) {
    await api(`/api/docs/${docId}/requests/${r.id}`, { method: 'DELETE' });
    await refresh();
    toast(t('Antrag von {name} abgelehnt', { name: r.name }), {
      actionLabel: t('Rückgängig'),
      onAction: async () => { await restoreRequest(r); await refresh(); },
    });
  }

  async function refresh() {
    await loadRequests();
    if (dialog.open) await render();
  }

  async function render() {
    renderRequests();
    const [{ owner, members }, users] = await Promise.all([api(`/api/docs/${docId}/members`), api('/api/users')]);
    const rows = [];
    if (owner) rows.push(row(owner, t('Eigentümer:in'), null));
    for (const m of members) rows.push(row(m, ROLE_LABELS[m.role], m));
    $('member-list').replaceChildren(...rows);

    const taken = new Set([owner?.id, ...members.map((m) => m.id)]);
    const free = users.filter((u) => !taken.has(u.id));
    $('share-user').replaceChildren(...(free.length ? free : [{ id: '', name: t('Alle Personen haben schon Zugriff') }]).map((u) => {
      const o = document.createElement('option');
      o.value = u.id;
      o.textContent = u.username ? `${u.name} (${u.username})` : u.name;
      return o;
    }));
    $('share-add-btn').disabled = !free.length;
  }

  function row(user, label, member) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'member-name';
    name.textContent = user.name;
    li.append(name);
    if (!member || !canManage) {
      const badge = document.createElement('span');
      badge.className = 'text-secondary small';
      badge.textContent = label;
      li.append(badge);
      return li;
    }
    const select = document.createElement('select');
    select.className = 'form-select form-select-sm';
    select.setAttribute('aria-label', t('Rolle von {name}', { name: user.name }));
    for (const [value, text] of Object.entries(ROLE_LABELS)) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      o.selected = value === member.role;
      select.append(o);
    }
    select.addEventListener('change', () => save(user.id, select.value));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-ghost-danger btn-icon btn-sm';
    remove.setAttribute('aria-label', t('{name} entfernen', { name: user.name }));
    remove.innerHTML = '<i class="ti ti-x"></i>';
    remove.addEventListener('click', async () => {
      await api(`/api/docs/${docId}/members/${user.id}`, { method: 'DELETE' });
      await render();
      toast(t('{name} hat keinen Zugriff mehr', { name: user.name }), { actionLabel: t('Rückgängig'), onAction: () => save(user.id, member.role) });
    });
    li.append(select, remove);
    return li;
  }

  async function save(userId, newRole) {
    errorBox.textContent = '';
    try {
      await api(`/api/docs/${docId}/members/${userId}`, { method: 'PUT', body: { role: newRole } });
      await loadRequests(); // Setting a role answers that person's request.
      await render();
    } catch (err) {
      errorBox.textContent = err.message;
    }
  }

  $('share-add-btn').addEventListener('click', () => save($('share-user').value, $('share-role').value));
  async function open() {
    errorBox.textContent = '';
    await loadRequests();
    await render();
    if (!dialog.open) dialog.showModal();
  }
  button.addEventListener('click', open);

  if (canManage) {
    loadRequests().catch(() => {});
    // The server pings the owner's open document when requests change.
    provider.on('stateless', ({ payload }) => {
      if (payload === 'access-requests') loadRequests({ announce: true }).catch(() => {});
    });
  }
}
