// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// /about: name, authors, licence and source offer (NOTICE term 1(b), AGPL section 13).
import './base.js';
import * as app from './attribution.js';

const $ = (id) => document.getElementById(id);

function setLink(el, href, text) {
  el.href = href;
  el.textContent = text;
}

$('about-org-logo').href = app.ORGANIZATION_URL;
$('about-name').textContent = `${app.APP_NAME} ${app.VERSION}`;
const org = document.createElement('a');
org.rel = 'noopener';
setLink(org, app.ORGANIZATION_URL, app.ORGANIZATION);
$('about-author').append(`${app.AUTHOR} / `, org);
$('about-copyright').textContent = `Copyright © ${app.COPYRIGHT_YEAR} ${app.COPYRIGHT_HOLDER}`;
setLink($('about-license'), app.LICENSE_URL, `${app.LICENSE_NAME} (${app.LICENSE_SPDX})`);
setLink($('about-source'), app.SOURCE_URL, app.SOURCE_URL);
