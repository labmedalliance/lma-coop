// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Shared styles and small helpers for all pages.
import '@tabler/core/dist/css/tabler.min.css';
import '@tabler/icons-webfont/dist/tabler-icons.min.css';
import './app.css';
import { lang, setLang, t, translatePage } from './i18n.js';
import * as app from './attribution.js';

translatePage();
mountCredit();

// Language switch: a button with id "lang-switch" offers the other language.
const langSwitch = document.getElementById('lang-switch');
if (langSwitch) {
  const other = lang === 'en' ? 'de' : 'en';
  langSwitch.innerHTML = `<i class="ti ti-language me-1"></i>${other.toUpperCase()}`;
  langSwitch.title = other === 'en' ? 'English' : 'Deutsch';
  langSwitch.setAttribute('aria-label', langSwitch.title);
  langSwitch.addEventListener('click', () => setLang(other));
}

/** fetch() wrapper for the JSON API; sends the user to the login page on 401. */
export async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error(t('Nicht angemeldet'));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ? t(data.error) : `${t('Fehler')} ${res.status}`);
  return data;
}

export async function logout() {
  await api('/api/logout', { method: 'POST' });
  window.location.href = '/login';
}

/** Shows a toast at the bottom; an optional action button (e.g. "Undo") runs onAction. */
export function toast(message, { actionLabel, onAction, timeout = 6000 } = {}) {
  const el = document.createElement('div');
  el.className = 'app-toast';
  el.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);
  if (actionLabel) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-link text-white';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => { el.remove(); onAction(); });
    el.append(btn);
  }
  document.body.append(el);
  setTimeout(() => el.remove(), timeout);
}

/** Stable color per name, used for cursors and avatars. */
export function colorFor(name) {
  const palette = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#4d7c0f'];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

export function initials(name) {
  return name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

function link(href, text, className) {
  const a = document.createElement('a');
  a.href = href;
  if (className) a.className = className;
  if (text) a.textContent = text;
  return a;
}

/**
 * Mandatory LabMed Alliance credit (AGPL section 7(b), see NOTICE) - do not remove or hide.
 * Goes into the editor status bar if the page has one, otherwise into a page footer.
 */
function mountCredit() {
  const credit = document.createElement('span');
  credit.className = 'app-credit';
  const lma = link(app.ORGANIZATION_URL, '', 'lma-credit');
  lma.rel = 'noopener';
  const logo = document.createElement('img');
  logo.src = app.LOGO_URL;
  logo.alt = '';
  logo.width = 16;
  logo.height = 16;
  logo.className = 'lma-logo';
  const label = document.createElement('span');
  label.textContent = `${t('Powered by')} ${app.ORGANIZATION_SHORT}`;
  lma.append(logo, label);
  credit.append(
    lma, ' · ', link('/about', t('Über LMA Coop')), ' · ', link('/about', `${t('Open Source')}, ${app.LICENSE_SPDX}`),
  );

  const statusbar = document.getElementById('statusbar');
  if (statusbar) {
    statusbar.append(credit);
    return;
  }
  const footer = document.createElement('footer');
  footer.className = 'app-footer d-print-none';
  footer.append(credit);
  (document.querySelector('.page') || document.body).append(footer);
}
