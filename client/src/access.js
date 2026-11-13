// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Access requests from the requester's side: the "no access" screen and "… beantragen" for suggesters and viewers.
// Admins can take the right to request away from an account; the server then refuses requests.
import { api, toast } from './base.js';
import { t } from './i18n.js';
import { url } from './paths.js';

const $ = (id) => document.getElementById(id);
const ROLE_LABELS = { editor: t('Bearbeiten'), suggester: t('Vorschlagen'), viewer: t('Lesen') };
const REQUEST_ROLES = ['suggester', 'editor'];
const POLL_MS = 15_000;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/**
 * Replaces the editor with a "no access" screen. If the document exists, the user can request access
 * as editor or suggester; the page reloads as soon as the owner approves.
 */
export async function showNoAccess(docId) {
  $('sync-status').textContent = t('Kein Zugriff');
  document.querySelectorAll('#toolbar, .doc-header > :not(:first-child)').forEach((node) => { node.hidden = true; });
  const box = el('div', 'empty');
  $('editor').replaceChildren(box);

  let state;
  try {
    state = await api(`/api/docs/${docId}/request`);
  } catch {
    box.append(
      el('p', 'empty-title', t('Dokument nicht gefunden')),
      el('p', 'empty-subtitle text-secondary', t('Das Dokument gibt es nicht oder es wurde gelöscht.')),
      backLink(),
    );
    return;
  }
  if (state.role) {
    window.location.reload();
    return;
  }
  document.title = `${state.title} – LMA Coop`;

  const render = () => {
    const children = [el('p', 'empty-title', state.title),
      el('p', 'text-secondary small', t('Dokument von {owner} – du hast noch keinen Zugriff.', { owner: state.owner || t('unbekannt') }))];
    if (state.pending) {
      const text = el('p', 'empty-subtitle text-secondary');
      text.append(t('Du hast '), el('strong', '', ROLE_LABELS[state.pending.role]),
        t(' beantragt. Sobald die Eigentümer:in zustimmt, öffnet sich das Dokument hier.'));
      const withdraw = el('button', 'btn btn-ghost-secondary', t('Antrag zurückziehen'));
      withdraw.type = 'button';
      withdraw.addEventListener('click', async () => {
        const previous = state.pending.role;
        await api(`/api/docs/${docId}/request`, { method: 'DELETE' });
        state.pending = null;
        render();
        toast(t('Antrag zurückgezogen'), { actionLabel: t('Rückgängig'), onAction: () => submit(previous) });
      });
      children.push(text, actionsOf(withdraw, backLink('btn-link')));
    } else if (!state.canRequest) {
      children.push(el('p', 'empty-subtitle text-secondary',
        t('Bitte die Eigentümer:in oder einen Admin, dir das Dokument freizugeben.')), backLink('btn-link'));
    } else {
      children.push(el('p', 'empty-subtitle text-secondary', t('Bitte die Eigentümer:in um Zugriff:')));
      const select = el('select', 'form-select');
      select.setAttribute('aria-label', t('Gewünschte Rolle'));
      for (const value of REQUEST_ROLES) {
        const o = el('option', '', ROLE_LABELS[value]);
        o.value = value;
        select.append(o);
      }
      select.value = 'suggester';
      const send = el('button', 'btn btn-primary', t('Zugriff beantragen'));
      send.type = 'button';
      send.addEventListener('click', () => submit(select.value));
      children.push(actionsOf(select, send), el('p', 'text-secondary small mt-3',
        t('Vorschlagen: Änderungen erscheinen als Vorschlag. Bearbeiten: Änderungen direkt im Text.')), backLink('btn-link'));
    }
    box.replaceChildren(...children);
  };

  async function submit(role) {
    try {
      ({ pending: state.pending } = await api(`/api/docs/${docId}/request`, { method: 'PUT', body: { role } }));
      render();
    } catch (err) {
      toast(err.message);
    }
  }

  render();
  // Opens the document once the owner approves.
  setInterval(async () => {
    try {
      if ((await api(`/api/docs/${docId}/request`)).role) window.location.reload();
    } catch { /* deleted or offline: keep the screen */ }
  }, POLL_MS);
}

function actionsOf(...nodes) {
  const wrap = el('div', 'access-actions');
  wrap.append(...nodes);
  return wrap;
}

function backLink(extra = 'btn-primary') {
  const a = el('a', `btn ${extra}`, t('Zur Dokumentliste'));
  a.href = url('/');
  return a;
}

/**
 * Header button for the next step up: "Lesen" requests "Vorschlagen", "Vorschlagen" requests "Bearbeiten".
 * A second click withdraws the pending request.
 */
export async function setupEditRequest(docId, role) {
  const button = $('request-edit');
  const label = button.querySelector('span');
  const wanted = role === 'viewer' ? 'suggester' : 'editor';
  let pending = null;
  const render = () => {
    button.hidden = false;
    if (wanted === 'suggester') label.textContent = t(pending ? 'Vorschlagen beantragt' : 'Vorschlagen beantragen');
    else label.textContent = t(pending ? 'Bearbeiten beantragt' : 'Bearbeiten beantragen');
    if (pending) button.title = t('Antrag zurückziehen');
    else if (wanted === 'suggester') button.title = t('Die Eigentümer:in bitten, Änderungen vorschlagen zu dürfen');
    else button.title = t('Die Eigentümer:in um Bearbeitungsrechte bitten');
    button.classList.toggle('active', !!pending);
  };
  const request = async () => {
    ({ pending } = await api(`/api/docs/${docId}/request`, { method: 'PUT', body: { role: wanted } }));
    render();
  };
  try {
    ({ pending } = await api(`/api/docs/${docId}/request`));
  } catch {
    return;
  }
  render();
  button.addEventListener('click', async () => {
    try {
      if (!pending) {
        await request();
        toast(t('Antrag gestellt. Sobald die Eigentümer:in zustimmt, lädt die Seite neu.'));
        return;
      }
      await api(`/api/docs/${docId}/request`, { method: 'DELETE' });
      pending = null;
      render();
      toast(t('Antrag zurückgezogen'), { actionLabel: t('Rückgängig'), onAction: request });
    } catch (err) {
      toast(err.message);
    }
  });
}
