// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Janne Cadamuro / LabMed Alliance Inc. — see LICENSE and NOTICE
// Looks up reference metadata by DOI (Crossref) or PMID (PubMed E-utilities).

const DOI_RE = /^10\.\d{4,9}\/\S+$/;
const PMID_RE = /^\d{1,9}$/;
const USER_AGENT = 'LMA-Coop/1.0 (self-hosted publication editor)';

/** Normalizes user input like "https://doi.org/10.1/x" or "PMID: 123" to {type, id}. */
export function parseIdentifier(input) {
  const s = String(input || '').trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/^pmid:\s*/i, '');
  if (DOI_RE.test(s)) return { type: 'doi', id: s };
  if (PMID_RE.test(s)) return { type: 'pmid', id: s };
  return null;
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) throw Object.assign(new Error('Quelle nicht gefunden'), { status: 404 });
  if (!res.ok) throw new Error(`Abfrage fehlgeschlagen (${res.status})`);
  return res.json();
}

async function fromCrossref(doi) {
  const { message: m } = await getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  return {
    authors: (m.author || []).map((a) => ({ family: a.family || a.name || '', given: a.given || '' })),
    title: (m.title || [''])[0],
    journal: (m['container-title-short'] || m['short-container-title'] || m['container-title'] || [''])[0],
    year: String(((m.issued || m.published || {})['date-parts'] || [[]])[0][0] || ''),
    volume: m.volume || '',
    issue: m.issue || '',
    pages: m.page || '',
    doi: m.DOI || doi,
    pmid: '',
  };
}

async function fromPubmed(pmid) {
  const data = await getJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${pmid}`);
  const r = data.result?.[pmid];
  if (!r || r.error) throw Object.assign(new Error('PMID nicht gefunden'), { status: 404 });
  const doi = (r.articleids || []).find((a) => a.idtype === 'doi')?.value || '';
  return {
    authors: (r.authors || []).filter((a) => a.authtype === 'Author').map((a) => {
      // PubMed gives "Smith JA" — split into family name and initials.
      const parts = a.name.split(' ');
      const given = parts.length > 1 ? parts.pop() : '';
      return { family: parts.join(' '), given };
    }),
    title: (r.title || '').replace(/\.$/, ''),
    journal: r.source || '',
    year: (r.pubdate || '').slice(0, 4),
    volume: r.volume || '',
    issue: r.issue || '',
    pages: r.pages || '',
    doi,
    pmid,
  };
}

/** Returns normalized reference metadata for a DOI or PMID. */
export async function lookup(input) {
  const ident = parseIdentifier(input);
  if (!ident) throw Object.assign(new Error('Keine gültige DOI oder PMID'), { status: 400 });
  return ident.type === 'doi' ? fromCrossref(ident.id) : fromPubmed(ident.id);
}
