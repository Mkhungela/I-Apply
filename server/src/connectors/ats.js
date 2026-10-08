/**
 * ATS connectors — Greenhouse, Lever, Workable, SmartRecruiters.
 *
 * These platforms are used directly by employers and publish documented,
 * unauthenticated *read* APIs for their job boards. Searching them is permitted
 * through those APIs.
 *
 * Application submission is a different matter and is handled per platform:
 *   • Greenhouse  — the Job Board API exposes a documented application POST for
 *                   boards that accept it. Enabled only when the user turns on
 *                   automatic submission; every response is recorded verbatim.
 *   • Lever       — postings API is read-only. Automated submission needs an
 *                   approved Lever/ATS integration, so we hand off.
 *   • Workable    — hosted apply requires per-account credentials → hand off.
 *   • SmartRecruiters — read API is public; applying needs the employer's
 *                   SmartRecruiters API credentials → hand off.
 */
import { JobConnector, ConnectorNeedsSetup, httpJson, handoffResult, parseTokenList, selectBoards } from './base.js';
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
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

function matchesQuery(job, query) {
  const terms = [...(query.roleTitles || []), ...(query.keywords || [])].map((t) => String(t).toLowerCase()).filter(Boolean);
  if (!terms.length) return true;
  const haystack = `${job.title} ${job.description || ''} ${(job.tags || []).join(' ')}`.toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

/* =================================================================== *
 * Greenhouse
 * =================================================================== */

export class GreenhouseConnector extends JobConnector {
  static meta = {
    key: 'greenhouse',
    name: 'Greenhouse job boards',
    category: 'ats',
    description:
      'Reads live vacancies straight from employers’ Greenhouse job boards using the published Job Board API, and can submit applications through the board’s application endpoint when enabled.',
    automationPolicy: {
      automatedSearch: 'allowed',
      automatedApply: 'requires_employer_credentials',
      basis:
        'Reading a Greenhouse board uses the public Job Board API, which needs no credentials. Submitting an application uses the same API’s POST endpoint, and Greenhouse requires HTTP Basic authentication on it with a Job Board API key that only the HIRING COMPANY can create (Configure → Dev Center → API Credentials). A job seeker cannot obtain that key, so automated submission is only possible if an employer has given you one — everyone else is handed a prepared application instead.',
      rateLimitNote: 'Batched requests, a few companies at a time, with a short delay between boards.',
    },
    credentials: [
      {
        name: 'boardApiKey',
        label: 'Greenhouse Job Board API key (only if you have one)',
        required: false,
        help:
          'This key is issued to the employer, not to candidates: the hiring company creates it in their own Greenhouse account (Configure → Dev Center → API Credentials) and uses it for their custom careers page. Supply it only if a company has given you access — for example because you administer that board. Without it, applications are prepared and handed to you to submit.',
      },
    ],
    configuration: [
      {
        name: 'boardTokens',
        label: 'Greenhouse board tokens',
        required: true,
        help: 'The token in boards.greenhouse.io/<token> or job-boards.greenhouse.io/<token> — e.g. “stripe”, “figma”. Comma-separated, one per line, or a JSON array. Many are fine: they are searched in rotation.',
      },
      {
        name: 'maxBoardsPerRun',
        label: 'Boards searched per run',
        required: false,
        help: 'How many of your tokens each hunt run visits. The rest are picked up on later runs, in rotation, so a long list stays polite.',
      },
    ],
    capabilities: { search: true, autoApply: false, assistantHandoff: true },
    complianceNote:
      'Searching uses Greenhouse’s documented public API. Applications are prepared in full (tailored CV, letter, answers) and handed to you unless you hold that employer’s Job Board API key, in which case submission runs through the documented endpoint with it. Custom questions the API cannot answer always pause the application for you.',
  };

  get boardTokens() {
    return parseTokenList(this.config.boardTokens ?? this.config.tokens ?? '');
  }

  readiness() {
    const missing = this.boardTokens.length ? [] : ['boardTokens'];
    return {
      ready: missing.length === 0,
      missing,
      requiresSetup: missing.length > 0,
      // Only claim the ability to submit when the employer-side key is actually present.
      canAutoApply: Boolean(this.credential('boardApiKey')),
      autoApplyRequires: this.credential('boardApiKey') ? [] : ['boardApiKey (issued by the hiring company, not by Greenhouse to candidates)'],
    };
  }

  async search(query = {}) {
    if (!this.boardTokens.length) {
      throw new ConnectorNeedsSetup('Add at least one Greenhouse board token to search this source.', { required: ['boardTokens'] });
    }
    const jobs = [];
    const warnings = [];
    const limit = Math.min(query.limit ?? 40, 100);

    const { selected, nextOffset } = selectBoards(this.boardTokens, this.config, 'greenhouse');
    const hasKey = Boolean(this.credential('boardApiKey'));
    for (const token of selected) {
      const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
      try {
        const data = await httpJson(url);
        for (const raw of data.jobs || []) {
          const description = stripHtml(raw.content || '');
          const job = {
            sourceKey: 'greenhouse',
            externalId: raw.id,
            title: raw.title,
            company: tokenToName(token, raw),
            companyDomain: null,
            location: raw.location?.name || null,
            description,
            url: raw.absolute_url,
            applyUrl: raw.absolute_url,
            postedAt: raw.updated_at || raw.first_published || null,
            tags: (raw.departments || []).map((d) => d.name).filter(Boolean),
            apply: {
              // Only advertise an API submission route when this account actually holds
              // the employer-side key; otherwise the honest route is assisted.
              mode: hasKey ? 'api_apply' : 'assisted',
              endpoint: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs/${raw.id}`,
              provider: 'greenhouse',
              note: hasKey
                ? 'Greenhouse job board application endpoint (employer API key present).'
                : 'Greenhouse submission needs the hiring company’s API key — apply through the posting, everything is prepared for you.',
            },
          };
          if (!matchesQuery(job, query)) continue;
          jobs.push(job);
        }
        await sleep(350);
      } catch (err) {
        warnings.push(`Greenhouse board “${token}”: ${err.message}`);
        this.log.warn(`board ${token} failed: ${err.message}`);
        // Nothing will succeed while the environment blocks outbound calls — stop
        // hammering the remaining boards and report the reason once.
        if (err.code === 'network_disabled') break;
      }
    }
    this.rotateBoardOffset(nextOffset);
    if (this.boardTokens.length > selected.length) {
      warnings.push(
        `Greenhouse: searched ${selected.length} of ${this.boardTokens.length} board token(s) this run; the rest follow on later runs (rotation).`
      );
    }
    return { jobs: this.normalizeAll(jobs.slice(0, limit)), warnings };
  }

  /**
   * Submits through the Greenhouse job board endpoint (multipart form).
   *
   * Greenhouse requires HTTP Basic authentication on this endpoint, using a Job Board
   * API key created in the HIRING COMPANY's Greenhouse account. Without such a key the
   * request is rejected — so we never attempt it and hand the prepared application
   * over instead, rather than reporting a submission that did not happen.
   */
  async submitApplication(pkg) {
    const apiKey = this.credential('boardApiKey');
    if (!apiKey) {
      return {
        status: 'requires_human',
        mode: 'assisted',
        detail:
          'Greenhouse only accepts applications through this endpoint with an API key issued to the hiring company, which candidates cannot obtain. Your application is prepared in full — open the posting and submit it (the letter and tailored CV are ready to download). If a company has given you their board API key, add it under this source and automatic submission will work.',
        handoff: handoffResult(this.meta, pkg.job, null).handoff,
      };
    }
    if (!this.config.allowAutoSubmit) {
      return {
        status: 'requires_human',
        mode: 'assisted',
        detail:
          'Automatic submission is switched off for this connector. Enable “Submit automatically where the platform permits it” in Connectors to let AI Job Hunter post through the Greenhouse board endpoint.',
        handoff: handoffResult(this.meta, pkg.job, null).handoff,
      };
    }
    const endpoint = pkg.job.apply?.endpoint;
    if (!endpoint) {
      return { status: 'failed', mode: 'api_apply', detail: 'No Greenhouse application endpoint stored for this job.' };
    }
    const answers = Object.fromEntries((pkg.answers || []).filter((a) => a.answer).map((a) => [a.question, a.answer]));
    const form = new FormData();
    form.append('first_name', pkg.candidate.firstName || '');
    form.append('last_name', pkg.candidate.lastName || '');
    form.append('email', pkg.candidate.email || '');
    if (pkg.candidate.phone) form.append('phone', pkg.candidate.phone);
    if (answers) form.append('answers', JSON.stringify(answers));
    if (pkg.documents?.cv?.buffer) {
      form.append('resume', new Blob([pkg.documents.cv.buffer], { type: 'application/pdf' }), pkg.documents.cv.filename);
    } else if (pkg.documents?.cvText) {
      form.append('resume_text', pkg.documents.cvText);
    }
    if (pkg.coverLetterText) form.append('cover_letter_text', pkg.coverLetterText);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: form,
        headers: {
          'user-agent': 'AIJobHunter/1.0',
          // Greenhouse requires Basic auth on the submission endpoint: "<api_key>:" base64.
          authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
        },
      });
      const text = await res.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text.slice(0, 600) };
      }
      if (res.ok) {
        return {
          status: 'submitted',
          mode: 'api_apply',
          confirmation: {
            source: 'greenhouse_job_board_api',
            httpStatus: res.status,
            applicationId: body?.id ?? body?.application_id ?? null,
            raw: body,
            receivedAt: new Date().toISOString(),
          },
          detail: 'Greenhouse accepted the submission.',
        };
      }
      const message = body?.error || body?.message || `HTTP ${res.status}`;
      const needsHuman = res.status === 422 || /question|field|captcha|not accepting/i.test(String(message));
      return {
        status: needsHuman ? 'requires_human' : 'failed',
        mode: 'api_apply',
        detail: needsHuman
          ? `Greenhouse needs information AI Job Hunter cannot supply automatically: ${message}. Complete the form yourself — everything is prepared.`
          : `Greenhouse rejected the submission: ${message}`,
        confirmation: { source: 'greenhouse_job_board_api', httpStatus: res.status, raw: body },
        handoff: handoffResult(this.meta, pkg.job, String(message)).handoff,
      };
    } catch (err) {
      return { status: 'failed', mode: 'api_apply', detail: `Could not reach Greenhouse: ${err.message}` };
    }
  }
}

function tokenToName(token, raw) {
  const fromMetadata = raw?.metadata?.find?.((m) => /company/i.test(m.name || ''))?.value;
  return fromMetadata || token.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* =================================================================== *
 * Lever
 * =================================================================== */

export class LeverConnector extends JobConnector {
  static meta = {
    key: 'lever',
    name: 'Lever job boards',
    category: 'ats',
    description:
      'Reads vacancies from employers’ Lever postings API (documented, public, read-only). Applications are prepared for you and handed off, because automating Lever’s apply form requires an approved Lever integration.',
    automationPolicy: {
      automatedSearch: 'allowed',
      automatedApply: 'not_permitted_without_partner_access',
      basis:
        'Lever’s public postings API is documented for reading jobs. Submitting applications programmatically requires Lever partner access, so AI Job Hunter prepares the application and opens the employer’s own form for you to submit.',
    },
    credentials: [],
    configuration: [
      { name: 'companies', label: 'Lever company slugs', required: true, help: 'The slug in jobs.lever.co/<slug> — e.g. “netflix”, “spotify”. Comma-separated.' },
    ],
    capabilities: { search: true, autoApply: false, assistantHandoff: true },
    complianceNote:
      'Search uses Lever’s documented read API only. No form posting, no scraping of authenticated areas.',
  };

  get companies() {
    return parseTokenList(this.config.companies || '');
  }

  readiness() {
    const missing = this.companies.length ? [] : ['companies'];
    return { ready: missing.length === 0, missing, requiresSetup: missing.length > 0, canAutoApply: false };
  }

  async search(query = {}) {
    if (!this.companies.length) throw new ConnectorNeedsSetup('Add at least one Lever company slug.', { required: ['companies'] });
    const jobs = [];
    const warnings = [];
    const leverWindow = selectBoards(this.companies, this.config, 'lever');
    for (const company of leverWindow.selected) {
      try {
        const data = await httpJson(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`);
        for (const raw of Array.isArray(data) ? data : []) {
          const description = [stripHtml(raw.description), stripHtml(raw.descriptionPlain), ...(raw.lists || []).map((l) => `${l.text}\n${stripHtml(l.content)}`)]
            .filter(Boolean)
            .join('\n');
          const job = {
            sourceKey: 'lever',
            externalId: raw.id,
            title: raw.text,
            company: raw.categories?.team ? company : company,
            location: raw.categories?.location || null,
            description,
            url: raw.hostedUrl,
            applyUrl: raw.applyUrl || raw.hostedUrl,
            postedAt: raw.createdAt ? new Date(Number(raw.createdAt)).toISOString() : null,
            employmentType: raw.categories?.commitment || null,
            workMode: /remote/i.test(raw.categories?.location || raw.text || '') ? 'remote' : undefined,
            tags: [raw.categories?.team, raw.categories?.department].filter(Boolean),
            apply: { mode: 'assisted', provider: 'lever', note: 'Lever automated submission requires partner access; complete the prepared application in Lever’s own form.' },
          };
          if (!matchesQuery(job, query)) continue;
          jobs.push(job);
        }
        await sleep(300);
      } catch (err) {
        warnings.push(`Lever “${company}”: ${err.message}`);
        if (err.code === 'network_disabled') break;
      }
    }
    this.rotateBoardOffset(leverWindow.nextOffset);
    if (this.companies.length > leverWindow.selected.length) {
      warnings.push(`Lever: searched ${leverWindow.selected.length} of ${this.companies.length} company slug(s) this run; the rest follow on later runs (rotation).`);
    }
    return { jobs: this.normalizeAll(jobs), warnings };
  }

  async submitApplication(pkg) {
    return handoffResult(this.meta, pkg.job, 'Lever applications are submitted by you in Lever’s own form — the prepared documents and answers are on this application record.');
  }
}

/* =================================================================== *
 * Workable
 * =================================================================== */

export class WorkableConnector extends JobConnector {
  static meta = {
    key: 'workable',
    name: 'Workable job boards',
    category: 'ats',
    description:
      'Reads vacancies from the published Workable account widget feed. Applications are prepared and handed off; Workable’s apply endpoint requires per-account credentials.',
    automationPolicy: {
      automatedSearch: 'allowed',
      automatedApply: 'not_permitted_without_account_access',
      basis:
        'Workable exposes a public widget feed for job listings (embedded on careers pages). Application POSTs require the account’s own API credentials, so submission is handed to you.',
    },
    credentials: [],
    configuration: [{ name: 'subdomains', label: 'Workable account subdomains', required: true, help: 'The part before .workable.com — e.g. “apply” in apply.workable.com/acme.' }],
    capabilities: { search: true, autoApply: false, assistantHandoff: true },
    complianceNote: 'Reads the public widget feed only.',
  };

  get subdomains() {
    return parseTokenList(this.config.subdomains || '');
  }

  readiness() {
    const missing = this.subdomains.length ? [] : ['subdomains'];
    return { ready: missing.length === 0, missing, requiresSetup: missing.length > 0, canAutoApply: false };
  }

  async search(query = {}) {
    if (!this.subdomains.length) throw new ConnectorNeedsSetup('Add at least one Workable account subdomain.', { required: ['subdomains'] });
    const jobs = [];
    const warnings = [];
    const workableWindow = selectBoards(this.subdomains, this.config, 'workable');
    for (const sub of workableWindow.selected) {
      try {
        const data = await httpJson(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(sub)}?details=true`);
        for (const raw of data.jobs || []) {
          const description = [stripHtml(raw.description), stripHtml(raw.requirements)].filter(Boolean).join('\n\n');
          const job = {
            sourceKey: 'workable',
            externalId: raw.shortcode || raw.id,
            title: raw.title,
            company: data.name || sub,
            location: [raw.location?.city, raw.location?.region, raw.location?.country].filter(Boolean).join(', ') || null,
            description,
            url: raw.url || raw.application_url,
            applyUrl: raw.application_url || raw.url,
            postedAt: raw.created_at,
            employmentType: raw.type,
            workMode: raw.telecommuting || raw.remote ? 'remote' : undefined,
            tags: [raw.department, raw.function].filter(Boolean),
            apply: { mode: 'assisted', provider: 'workable', note: 'Workable submission needs account credentials; complete the prepared application on Workable.' },
          };
          if (!matchesQuery(job, query)) continue;
          jobs.push(job);
        }
        await sleep(300);
      } catch (err) {
        warnings.push(`Workable “${sub}”: ${err.message}`);
        if (err.code === 'network_disabled') break;
      }
    }
    this.rotateBoardOffset(workableWindow.nextOffset);
    if (this.subdomains.length > workableWindow.selected.length) {
      warnings.push(`Workable: searched ${workableWindow.selected.length} of ${this.subdomains.length} subdomain(s) this run; the rest follow on later runs (rotation).`);
    }
    return { jobs: this.normalizeAll(jobs), warnings };
  }

  async submitApplication(pkg) {
    return handoffResult(this.meta, pkg.job, 'Submit the prepared application in Workable’s own form — per-account credentials are required for automation.');
  }
}

/* =================================================================== *
 * SmartRecruiters
 * =================================================================== */

export class SmartRecruitersConnector extends JobConnector {
  static meta = {
    key: 'smartrecruiters',
    name: 'SmartRecruiters job boards',
    category: 'ats',
    description: 'Reads vacancies from the public SmartRecruiters postings API for employers you follow.',
    automationPolicy: {
      automatedSearch: 'allowed',
      automatedApply: 'not_permitted_without_employer_api_credentials',
      basis: 'SmartRecruiters publishes a public read API for postings; application submission requires the employer’s API credentials (POST /postings/{id}/candidates).',
    },
    credentials: [],
    configuration: [{ name: 'companies', label: 'SmartRecruiters company identifiers', required: true, help: 'The identifier in jobs.smartrecruiters.com/<company>.' }],
    capabilities: { search: true, autoApply: false, assistantHandoff: true },
    complianceNote: 'Read-only public postings API.',
  };

  get companies() {
    const raw = this.config.companies || '';
    return (Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/)).map((t) => t.trim()).filter(Boolean);
  }

  readiness() {
    const missing = this.companies.length ? [] : ['companies'];
    return { ready: missing.length === 0, missing, requiresSetup: missing.length > 0, canAutoApply: false };
  }

  async search(query = {}) {
    if (!this.companies.length) throw new ConnectorNeedsSetup('Add at least one SmartRecruiters company identifier.', { required: ['companies'] });
    const jobs = [];
    const warnings = [];
    const smartrecruitersWindow = selectBoards(this.companies, this.config, 'smartrecruiters');
    for (const company of smartrecruitersWindow.selected) {
      try {
        const data = await httpJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=100`);
        for (const raw of data.content || []) {
          const loc = raw.location || {};
          const job = {
            sourceKey: 'smartrecruiters',
            externalId: raw.id,
            title: raw.name,
            company: raw.company?.name || company,
            companyDomain: companyDomainFromUrl(raw.company?.website) || null,
            location: [loc.city, loc.region, loc.country].filter(Boolean).join(', ') || (loc.remote ? 'Remote' : null),
            description: stripHtml(raw.jobAd?.sections?.jobDescription?.text || ''),
            url: `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}/${raw.id}`,
            applyUrl: `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}/${raw.id}`,
            postedAt: raw.releasedDate,
            employmentType: raw.typeOfEmployment?.label || null,
            workMode: loc.remote ? 'remote' : undefined,
            tags: (raw.department ? [raw.department.label] : []).concat(raw.function ? [raw.function.label] : []),
            apply: { mode: 'assisted', provider: 'smartrecruiters', note: 'Submission requires the employer’s SmartRecruiters API credentials.' },
          };
          if (!matchesQuery(job, query)) continue;
          jobs.push(job);
        }
        await sleep(300);
      } catch (err) {
        warnings.push(`SmartRecruiters “${company}”: ${err.message}`);
        if (err.code === 'network_disabled') break;
      }
    }
    this.rotateBoardOffset(smartrecruitersWindow.nextOffset);
    if (this.companies.length > smartrecruitersWindow.selected.length) {
      warnings.push(`SmartRecruiters: searched ${smartrecruitersWindow.selected.length} of ${this.companies.length} company identifier(s) this run; the rest follow on later runs (rotation).`);
    }
    return { jobs: this.normalizeAll(jobs), warnings };
  }

  async submitApplication(pkg) {
    return handoffResult(this.meta, pkg.job, 'SmartRecruiters submission needs the employer’s API credentials — complete the prepared application on their site.');
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
