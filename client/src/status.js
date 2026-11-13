// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Document status: label and badge colour. Keys match STATUSES in server/docs.js.
import { t } from './i18n.js';

export const STATUSES = {
  idea: { label: t('Idee'), badge: 'bg-yellow-lt' },
  wip: { label: t('Work in Progress'), badge: 'bg-blue-lt' },
  finished: { label: t('Finished'), badge: 'bg-green-lt' },
  archived: { label: t('Archived'), badge: 'bg-secondary-lt' },
};

/** Badge element for a status, or null for an unknown one. */
export function statusBadge(status) {
  const s = STATUSES[status];
  if (!s) return null;
  const badge = document.createElement('span');
  badge.className = `badge ${s.badge} doc-state-badge`;
  badge.textContent = s.label;
  return badge;
}
