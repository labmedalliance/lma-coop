// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * LMA Coop — provenance, licence and mandatory LabMed Alliance attribution.
 *
 * Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version, together with the additional terms under
 * section 7 stated in the NOTICE file.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public
 * License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * The constants below are the single source of truth for who built this app,
 * under which licence it may be used, and where its source lives. They are
 * hard-coded on purpose and rendered by `base.js` (footer credit on every page)
 * and `about.js` (/about). The NOTICE file makes that credit a licence
 * condition (AGPL section 7(b)): forks must keep it visible. Add your own
 * credits next to it — do not remove or hide the original ones.
 */

export const APP_NAME = 'LMA Coop';
export const VERSION = '1.0.0';

export const AUTHOR = 'Janne Cadamuro';
export const ORGANIZATION = 'LabMed Alliance Inc.';
export const ORGANIZATION_SHORT = 'LabMed Alliance';
export const ORGANIZATION_URL = 'https://labmedalliance.com';
export const COPYRIGHT_HOLDER = `${AUTHOR} / ${ORGANIZATION}`;
export const COPYRIGHT_YEAR = 2026;

export const LICENSE_SPDX = 'AGPL-3.0-or-later';
export const LICENSE_NAME = 'GNU Affero General Public License v3.0 or later';
export const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

/**
 * Public source of this app — the AGPL section 13 source offer for network
 * users. Forks that run a modified version must point this at their own repo.
 */
export const SOURCE_URL = 'https://github.com/labmedalliance/lma-coop';

/** The LabMed Alliance logo (not covered by the AGPL, see NOTICE term 3). */
export const LOGO_URL = '/img/lma-logo-mark.svg';
