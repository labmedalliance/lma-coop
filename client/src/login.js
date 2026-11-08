// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
import './base.js';
import { t } from './i18n.js';
import { url } from './paths.js';

const form = document.getElementById('login-form');
const errorBox = document.getElementById('login-error');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.classList.add('d-none');
  const res = await fetch(url('/api/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.fromEntries(new FormData(form))),
  });
  if (res.ok) {
    window.location.href = url('/');
    return;
  }
  const { error } = await res.json().catch(() => ({ error: 'Anmeldung fehlgeschlagen' }));
  errorBox.textContent = t(error);
  errorBox.classList.remove('d-none');
});
