/**
 * Manual source — paste a job link (and optionally the advert text).
 *
 * This is the workhorse for platforms whose rules prohibit automated access
 * (LinkedIn, Indeed, PNet, Careers24, Glassdoor, Workday, Wellfound …). You browse
 * normally, paste the link, and everything after that — matching, tailoring,
 * answers, tracking, reminders — is automated on your own data.
 *
 * Also detects which ATS hosts the link so the application can be routed correctly.
 */
import { JobConnector, ConnectorError, httpText } from './base.js';
import { extractApplyEmail, companyDomainFromUrl } from '../services/jobNormalizer.js';

const ATS_HOSTS = [
  { host: 'greenhouse.io', connector: 'greenhouse' },
  { host: 'lever.co', connector: 'lever' },
  { host: 'workable.com', connector: 'workable' },
  { host: 'smartrecruiters.com', connector: 'smartrecruiters' },
  { host: 'myworkdayjobs.com', connector: 'workday' },
  { host: 'workday.com', connector: 'workday' },
  { host: 'linkedin.com', connector: 'linkedin' },
  { host: 'indeed.com', connector: 'indeed' },
  { host: 'glassdoor.com', connector: 'glassdoor' },
  { host: 'pnet.co.za', connector: 'pnet' },
  { host: 'careers24.com', connector: 'careers24' },
  { host: 'wellfound.com', connector: 'wellfound' },
  { host: 'angel.co', connector: 'wellfound' },
];

export function detectAtsHost(url = '') {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return ATS_HOSTS.find((a) => host === a.host || host.endsWith(`.${a.host}`)) || null;
  } catch {
    return null;
  }
}

/**
 * Derives as much as possible from a URL alone: many boards put the slug in the path
 * (e.g. linkedin.com/jobs/view/senior-ux-designer-at-acme-4123456789).
 */
export function parseJobUrl(url = '') {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new ConnectorError('That does not look like a valid URL.', 'bad_url');
  }
  const ats = detectAtsHost(url);
  const segments = u.pathname.split('/').filter(Boolean);
  const slug = segments.find((s) => /-at-|at-|-[a-z0-9]{6,}$/i.test(s) && s.length > 8) || segments[segments.length - 1] || '';
  const cleanedSlug = slug.replace(/-\d{6,}$/, '').replace(/^jobs?[-,]?/i, '');
  let title = null;
  let company = null;
  const atSplit = /^(.*?)-at-(.*)$/i.exec(cleanedSlug);
  if (atSplit) {
    title = humanise(atSplit[1]);
    company = humanise(atSplit[2]);
  } else if (cleanedSlug) {
    title = humanise(cleanedSlug);
  }
  // Greenhouse URLs: boards.greenhouse.io/<token>/jobs/<id>
  if (ats?.connector === 'greenhouse') {
    const idx = segments.indexOf('jobs');
    if (idx > 0) company = humanise(segments[idx - 1]);
  }
  if (ats?.connector === 'workday') {
    company = humanise(u.hostname.split('.')[0]);
  }
  const queryTitle = u.searchParams.get('title') || u.searchParams.get('jobTitle');
  if (queryTitle) title = queryTitle;

  return {
    url: u.toString(),
    externalId: segments.reverse().find((s) => /^\d{4,}$/.test(s)) || u.searchParams.get('currentJobId') || u.searchParams.get('gh_jid') || null,
    title,
    company,
    ats: ats?.connector || null,
    companyDomain: companyDomainFromUrl(url),
  };
}

function humanise(slug = '') {
  return slug
    .replace(/[-_+]+/g, ' ')
    .replace(/\b(jobs?|hiring|apply|careers?|vacancy|position)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 90) || null;
}

export class ManualConnector extends JobConnector {
  static meta = {
    key: 'manual',
    name: 'Paste a job link',
    category: 'manual',
    description:
      'Add any job by pasting its URL. AI Job Hunter extracts what it can, detects the underlying ATS, and runs matching + tailoring immediately. Use this for LinkedIn, Indeed, PNet, Careers24, Glassdoor, Wellfound, Workday and company careers pages.',
    automationPolicy: {
      automatedSearch: 'user_initiated',
      automatedApply: 'depends_on_host',
      basis: 'A single fetch of a page you explicitly paste, on your behalf. No crawling, no bulk access, no bypassing of any login or anti-bot control.',
    },
    credentials: [],
    configuration: [],
    capabilities: { search: false, autoApply: false, assistantHandoff: true, pasteUrl: true },
    complianceNote: 'You supply the link; AI Job Hunter never browses a platform on its own initiative.',
  };

  async search() {
    return { jobs: [], warnings: ['The manual source is driven by links you paste, not by an automatic search.'] };
  }

  /**
   * Adds one job from a URL plus optional copied advert text.
   * @param {{url:string, title?:string, company?:string, location?:string, description?:string, fetchPage?:boolean}} input
   */
  async addFromUrl(input = {}) {
    const parsed = parseJobUrl(input.url);
    const warnings = [];
    let description = input.description || '';
    let pageTitle = null;

    if (!description && input.fetchPage) {
      // Single, user-initiated fetch of a public page. No login, no bypass.
      try {
        const html = await httpText(input.url, { accept: 'text/html,application/xhtml+xml' });
        const extracted = extractReadableText(html);
        description = extracted.text;
        pageTitle = extracted.title;
      } catch (err) {
        warnings.push(
          `Could not read the page automatically (${err.message}). Paste the advert text into the description field instead — everything else works the same.`
        );
      }
    }

    const title = input.title || guessTitleFromDescription(description) || pageTitle || parsed.title || 'Untitled role';
    const job = {
      sourceKey: 'manual',
      externalId: parsed.externalId || null,
      title,
      company: input.company || parsed.company || guessCompanyFromDescription(description) || null,
      companyDomain: parsed.companyDomain,
      location: input.location || guessLocationFromDescription(description) || null,
      description,
      url: parsed.url,
      applyUrl: parsed.url,
      applyEmail: extractApplyEmail(description) || null,
      postedAt: guessPostedAt(description),
      atsHost: parsed.ats,
      tags: [],
      apply:
        parsed.ats === 'greenhouse'
          ? { mode: 'api_apply', provider: 'greenhouse', note: 'Hosted on Greenhouse — add the board token to the Greenhouse connector to automate submission.' }
          : extractApplyEmail(description)
            ? { mode: 'email', email: extractApplyEmail(description), note: 'Advert invites applications by email.' }
            : { mode: 'assisted', provider: parsed.ats || 'manual', note: 'Complete the prepared application on the employer’s own form.' },
    };

    return { jobs: this.normalizeAll([job]), warnings, detected: parsed };
  }
}

/** Very light readability pass: prefers JSON-LD JobPosting, then the <main>/<body> text. */
export function extractReadableText(html = '') {
  const jsonLd = [...String(html).matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of jsonLd) {
    try {
      const parsed = JSON.parse(block[1].trim());
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of candidates) {
        const graph = item['@graph'] ? item['@graph'] : [item];
        for (const node of graph) {
          const type = Array.isArray(node['@type']) ? node['@type'].join(',') : node['@type'];
          if (type && /JobPosting/i.test(String(type))) {
            return {
              title: node.title || null,
              text: htmlToText([node.description, node.responsibilities, node.qualifications, node.skills ? JSON.stringify(node.skills) : ''].filter(Boolean).join('\n')),
            };
          }
        }
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const body = /<main[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] || /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] || html;
  return { title: title ? htmlToText(title).trim().slice(0, 120) : null, text: htmlToText(body).slice(0, 20_000) };
}

export function htmlToText(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function guessTitleFromDescription(description = '') {
  if (!description) return null;
  const first = description.split('\n').map((l) => l.trim()).find((l) => l.length > 3 && l.length < 90);
  if (!first) return null;
  return /\b(designer|developer|engineer|manager|lead|consultant|specialist|analyst|architect|writer|marketer)\b/i.test(first) ? first : null;
}

function guessCompanyFromDescription(description = '') {
  const m = /(?:at|join|with)\s+([A-Z][A-Za-z0-9&.'-]+(?:\s+[A-Z][A-Za-z0-9&.'-]+){0,3})\b/.exec(description.split('\n').slice(0, 12).join(' '));
  if (!m) return null;
  const candidate = m[1].trim();
  return /^(the|our|a|an|least|scale)$/i.test(candidate) ? null : candidate.slice(0, 60);
}

function guessLocationFromDescription(description = '') {
  const m = /(?:location|based in|office in|located in)\s*[:\-]?\s*([A-Za-z .,'-]{3,50})/i.exec(description);
  return m ? m[1].trim() : null;
}

function guessPostedAt(description = '') {
  const m = /(?:posted|published|advertised)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\s+\w+\s+\d{4}|today|yesterday)/i.exec(description);
  return m ? m[1] : null;
}

export { ConnectorError };
