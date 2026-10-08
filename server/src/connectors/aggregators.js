/**
 * Aggregator connectors — public job APIs and user-supplied feeds.
 *
 * These sources publish open APIs or feeds intended for consumption, so searching
 * them is permitted and stable. Applications are submitted on the *employer's* own
 * site (the advert link), so these connectors prepare the application and hand off.
 */
import { JobConnector, ConnectorNeedsSetup, ConnectorError, httpJson, httpText, parseFeed, handoffResult } from './base.js';
import { companyDomainFromUrl } from '../services/jobNormalizer.js';

const stripHtml = (html = '') =>
  String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const GUIDED_APPLY = (provider) => ({
  mode: 'assisted',
  provider,
  note: 'Applications are completed on the employer’s own site or ATS. AI Job Hunter prepares everything and tracks the outcome.',
});

/* =================================================================== *
 * Remotive — remote-first jobs, documented public API
 * =================================================================== */

export class RemotiveConnector extends JobConnector {
  static meta = {
    key: 'remotive',
    name: 'Remotive',
    category: 'remote_board',
    description: 'Remote-first job board with a documented public JSON API. Good coverage for design and front-end remote roles.',
    automationPolicy: {
      automatedSearch: 'allowed',
      automatedApply: 'not_applicable',
      basis: 'Remotive publishes a public API for its job listings; applications happen on the employer’s site, so no automation of their platform is involved.',
      attribution: 'Remotive must be credited and their listing linked back to (done automatically).',
    },
    credentials: [],
    configuration: [{ name: 'categories', label: 'Optional category filters', required: false, help: 'e.g. “Design”, “Software Development”.' }],
    capabilities: { search: true, autoApply: false, assistantHandoff: true },
    complianceNote: 'Uses Remotive’s public API with attribution and a link back to their listing.',
  };

  async search(query = {}) {
    const categories = this.config.categories || '';
    const search = (query.keywords?.[0] || query.roleTitles?.[0] || '').toString();
    const url = new URL('https://remotive.com/api/remote-jobs');
    if (search) url.searchParams.set('search', search);
    if (categories) url.searchParams.set('category', String(categories).split(',')[0].trim());
    url.searchParams.set('limit', String(Math.min(query.limit ?? 40, 100)));

    const data = await httpJson(url.toString());
    const jobs = (data.jobs || []).map((raw) => ({
      sourceKey: 'remotive',
      externalId: raw.id,
      title: raw.title,
      company: raw.company_name,
      companyDomain: companyDomainFromUrl(raw.company_logo_url || '') || null,
      location: raw.candidate_required_location || 'Remote',
      description: stripHtml(raw.description),
      url: raw.url,
      applyUrl: raw.url,
      postedAt: raw.publication_date,
      employmentType: raw.job_type,
      workMode: 'remote',
      salaryRaw: raw.salary || null,
      tags: [raw.category, ...(raw.tags || [])].filter(Boolean),
      remoteRestriction: raw.candidate_required_location || null,
      apply: GUIDED_APPLY('remotive'),
    }));
    return { jobs: this.normalizeAll(jobs, { remoteRestriction: undefined }), warnings: [], attribution: 'Job data by Remotive (remotive.com)' };
  }
}

/* =================================================================== *
 * Arbeitnow — free public job board API
 * =================================================================== */

export class ArbeitnowConnector extends JobConnector {
  static meta = {
    key: 'arbeitnow',
    name: 'Arbeitnow',
    category: 'job_board',
    description: 'Free public job-board API with a large international and remote-heavy dataset (EU focus, worldwide remote roles).',
    automationPolicy: {
      automatedSearch: 'allowed',
      automatedApply: 'not_applicable',
      basis: 'Arbeitnow publishes an open API explicitly for job-board use. Applications are completed on the employer’s site.',
    },
    credentials: [],
    configuration: [{ name: 'pages', label: 'Pages to fetch', required: false, help: '1–5. Each page holds 100 jobs.' }],
    capabilities: { search: true, autoApply: false, assistantHandoff: true },
    complianceNote: 'Open API. Attribution + link back to the listing is included.',
  };

  async search(query = {}) {
    const pages = Math.min(Number(this.config.pages) || 1, 5);
    const terms = [...(query.roleTitles || []), ...(query.keywords || [])].map((t) => String(t).toLowerCase());
    const jobs = [];
    const warnings = [];
    for (let page = 1; page <= pages; page += 1) {
      try {
        const data = await httpJson(`https://www.arbeitnow.com/api/job-board-api?page=${page}`);
        for (const raw of data.data || []) {
          const haystack = `${raw.title} ${(raw.tags || []).join(' ')}`.toLowerCase();
          if (terms.length && !terms.some((t) => haystack.includes(t))) continue;
          jobs.push({
            sourceKey: 'arbeitnow',
            externalId: raw.slug,
            title: raw.title,
            company: raw.company_name,
            location: raw.location || (raw.remote ? 'Remote' : null),
            description: stripHtml(raw.description),
            url: raw.url,
            applyUrl: raw.url,
            postedAt: raw.created_at ? new Date(Number(raw.created_at) * 1000).toISOString() : null,
            workMode: raw.remote ? 'remote' : undefined,
            tags: raw.tags || [],
            apply: GUIDED_APPLY('arbeitnow'),
          });
        }
      } catch (err) {
        warnings.push(`Arbeitnow page ${page}: ${err.message}`);
      }
      if (jobs.length >= (query.limit ?? 40)) break;
    }
    return { jobs: this.normalizeAll(jobs.slice(0, query.limit ?? 40)), warnings, attribution: 'Job data by Arbeitnow' };
  }
}

/* =================================================================== *
 * RemoteOK — public API with attribution requirement
 * =================================================================== */

export class RemoteOkConnector extends JobConnector {
  static meta = {
    key: 'remoteok',
    name: 'Remote OK',
    category: 'remote_board',
    description: 'Public remote-jobs API (attribution required). Useful for remote design/engineering roles.',
    automationPolicy: {
      automatedSearch: 'allowed',
      automatedApply: 'not_applicable',
      basis: 'Remote OK publishes a public API; their terms require attribution and a link back to the job page, which this connector always includes.',
    },
    credentials: [],
    configuration: [],
    capabilities: { search: true, autoApply: false, assistantHandoff: true },
    complianceNote: 'Attribution (“Remote OK”) and the original listing URL are always displayed.',
  };

  async search(query = {}) {
    const data = await httpJson('https://remoteok.com/api', {
      headers: { accept: 'application/json' },
    });
    const list = (Array.isArray(data) ? data : []).filter((x) => x && x.id && x.position);
    const terms = [...(query.roleTitles || []), ...(query.keywords || [])].map((t) => String(t).toLowerCase());
    const jobs = list
      .filter((raw) => {
        if (!terms.length) return true;
        const haystack = `${raw.position} ${(raw.tags || []).join(' ')}`.toLowerCase();
        return terms.some((t) => haystack.includes(t));
      })
      .slice(0, query.limit ?? 40)
      .map((raw) => ({
        sourceKey: 'remoteok',
        externalId: raw.id,
        title: raw.position,
        company: raw.company,
        location: raw.location || 'Remote',
        description: stripHtml(raw.description),
        url: raw.url || `https://remoteok.com/remote-jobs/${raw.slug || raw.id}`,
        applyUrl: raw.apply_url || raw.url,
        postedAt: raw.date,
        workMode: 'remote',
        salaryMin: Number(raw.salary_min) || null,
        salaryMax: Number(raw.salary_max) || null,
        tags: raw.tags || [],
        apply: GUIDED_APPLY('remoteok'),
      }));
    return { jobs: this.normalizeAll(jobs), warnings: [], attribution: 'Job data by Remote OK — apply via the original listing.' };
  }
}

/* =================================================================== *
 * RSS / Atom feeds (company career pages, boards that publish feeds)
 * =================================================================== */

export class RssConnector extends JobConnector {
  static meta = {
    key: 'rss',
    name: 'RSS / Atom job feeds',
    category: 'feed',
    description:
      'Add any job RSS/Atom feed — many company career pages, niche boards and ATS platforms publish one. A published feed is a permitted interface.',
    automationPolicy: {
      automatedSearch: 'allowed',
      automatedApply: 'not_applicable',
      basis: 'Feeds are published by the site owner specifically for syndication/consumption.',
    },
    credentials: [],
    configuration: [{ name: 'feeds', label: 'Feed URLs', required: true, help: 'One per line. e.g. https://example.com/careers.rss' }],
    capabilities: { search: true, autoApply: false, assistantHandoff: true },
    complianceNote: 'Reads only feeds the site owner publishes.',
  };

  get feeds() {
    const raw = this.config.feeds || '';
    const list = Array.isArray(raw) ? raw : String(raw).split(/[\n,]+/);
    return list.map((f) => f.trim()).filter((f) => /^https?:\/\//i.test(f)).slice(0, 25);
  }

  readiness() {
    const missing = this.feeds.length ? [] : ['feeds'];
    return { ready: missing.length === 0, missing, requiresSetup: missing.length > 0, canAutoApply: false };
  }

  async search(query = {}) {
    if (!this.feeds.length) throw new ConnectorNeedsSetup('Add at least one job feed URL.', { required: ['feeds'] });
    const jobs = [];
    const warnings = [];
    const terms = [...(query.roleTitles || []), ...(query.keywords || [])].map((t) => String(t).toLowerCase());
    for (const feed of this.feeds) {
      try {
        const xml = await httpText(feed, { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' });
        for (const item of parseFeed(xml)) {
          if (!item.title || !item.url) continue;
          const haystack = `${item.title} ${item.description || ''}`.toLowerCase();
          if (terms.length && !terms.some((t) => haystack.includes(t))) continue;
          jobs.push({
            sourceKey: 'rss',
            externalId: item.guid || item.url,
            title: item.title,
            company: item.company || hostLabel(feed),
            location: item.location || null,
            description: item.description ? stripHtml(item.description) : '',
            url: item.url,
            applyUrl: item.url,
            postedAt: item.postedAt,
            tags: [],
            apply: GUIDED_APPLY('rss'),
          });
        }
      } catch (err) {
        warnings.push(`${feed}: ${err.message}`);
      }
    }
    return { jobs: this.normalizeAll(jobs.slice(0, query.limit ?? 60)), warnings };
  }
}

function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/* =================================================================== *
 * CSV / JSON export import (things you already downloaded)
 * =================================================================== */

export class ImportConnector extends JobConnector {
  static meta = {
    key: 'import',
    name: 'CSV / JSON import',
    category: 'manual',
    description:
      'Import a job list you already have (a board export, an ATS report, a spreadsheet). Columns are auto-detected; you paste the file contents in the Connectors tab.',
    automationPolicy: {
      automatedSearch: 'allowed',
      automatedApply: 'not_applicable',
      basis: 'You supply the data yourself — no third-party platform is touched.',
    },
    credentials: [],
    configuration: [{ name: 'payload', label: 'CSV or JSON content', required: true, help: 'Header row with title/company/location/url/description columns.' }],
    capabilities: { search: true, autoApply: false, assistantHandoff: true },
    complianceNote: 'Operates only on data you provide.',
  };

  readiness() {
    const has = !!(this.config.payload || this.config.rows?.length);
    return { ready: has, missing: has ? [] : ['payload'], requiresSetup: !has, canAutoApply: false };
  }

  async search() {
    const payload = this.config.payload;
    if (!payload) throw new ConnectorNeedsSetup('Paste a CSV or JSON job list to import.', { required: ['payload'] });
    const rows = parseImport(payload);
    const jobs = rows.map((row) => ({
      sourceKey: 'import',
      externalId: row.id || row.url || row.title,
      title: row.title || row.position || row.role,
      company: row.company || row.company_name || row.employer,
      location: row.location || row.city,
      description: row.description || row.summary || row.details || '',
      url: row.url || row.link || row.apply_url,
      applyUrl: row.apply_url || row.url || row.link,
      applyEmail: row.email || row.apply_email || null,
      postedAt: row.posted_at || row.date || row.created_at,
      employmentType: row.employment_type || row.type,
      salaryRaw: row.salary || null,
      workMode: row.remote === 'true' || row.remote === true ? 'remote' : undefined,
      apply: row.email || row.apply_email ? { mode: 'email', email: row.email || row.apply_email } : GUIDED_APPLY('import'),
    }));
    return { jobs: this.normalizeAll(jobs), warnings: jobs.length ? [] : ['No usable rows found — check that your file has a title column.'] };
  }
}

/** Detects CSV or JSON and maps common column names. */
export function parseImport(payload) {
  const text = String(payload).trim();
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : parsed.jobs || parsed.data || parsed.results || [];
      return list.map((row) => normaliseRowKeys(row));
    } catch {
      throw new ConnectorError('That looks like JSON but could not be parsed.', 'bad_import');
    }
  }
  return parseCsv(text).map(normaliseRowKeys);
}

function normaliseRowKeys(row = {}) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const key = String(k).trim().toLowerCase().replace(/[\s-]+/g, '_');
    out[key] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delimiter = [',', ';', '\t', '|'].sort((a, b) => count(lines[0], b) - count(lines[0], a))[0];
  const header = splitCsvLine(lines[0], delimiter).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line, delimiter);
    const row = {};
    header.forEach((h, i) => {
      row[h] = cells[i] ?? '';
    });
    return row;
  });
}

function splitCsvLine(line, delimiter) {
  const out = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      out.push(current);
      current = '';
    } else current += ch;
  }
  out.push(current);
  return out.map((c) => c.trim());
}

function count(line, ch) {
  return line.split(ch).length - 1;
}

export { handoffResult, ConnectorError };
