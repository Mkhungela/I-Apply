/**
 * Normalises heterogeneous job payloads into one internal shape.
 * Used by every connector so matching/generation never cares where a job came from.
 */
import { extractSkills, normaliseText, detectSeniority } from './skillTaxonomy.js';
import { detectRequiredYears } from './matcher.js';

const CURRENCY_SYMBOLS = { R: 'ZAR', '£': 'GBP', $: 'USD', '€': 'EUR', '¥': 'JPY', A$: 'AUD', C$: 'CAD' };
const CURRENCY_CODES = ['zar', 'usd', 'gbp', 'eur', 'aud', 'cad', 'nzd', 'inr', 'aed', 'kes', 'ngn', 'php', 'sgd'];

/** @returns {{min:number|null,max:number|null,currency:string|null,period:string|null,raw:string|null}} */
export function parseSalary(text = '') {
  const source = String(text);
  if (!source) return { min: null, max: null, currency: null, period: null, raw: null };
  if (/(market\s*related|negotiable|competitive|depending on experience|doe\b|not disclosed)/i.test(source)) {
    return { min: null, max: null, currency: null, period: null, raw: matchPhrase(source) };
  }

  const re = /(R|£|\$|€|A\$|C\$)\s?(\d[\d\s,.]{1,12}?)\s*(k|m)?\b(?:\s*(?:-|–|—|to)\s*(R|£|\$|€|A\$|C\$)?\s?(\d[\d\s,.]{1,12}?)\s*(k|m)?\b)?/i;
  const m = re.exec(source);
  if (!m) {
    const code = new RegExp(`\\b(${CURRENCY_CODES.join('|')})\\b\\s?(\\d[\\d\\s,.]{1,12})`, 'i').exec(source);
    if (!code) return { min: null, max: null, currency: null, period: null, raw: matchPhrase(source) };
    return { min: toNumber(code[2]), max: null, currency: code[1].toUpperCase(), period: detectPeriod(source), raw: m?.[0] ?? code[0] };
  }

  const currency = CURRENCY_SYMBOLS[(m[1] || '').toUpperCase()] || CURRENCY_SYMBOLS[m[1]] || null;
  const min = toNumber(m[2], m[3]);
  const max = m[5] ? toNumber(m[5], m[6]) : null;
  return {
    min,
    max,
    currency: currency || (CURRENCY_CODES.find((c) => normaliseText(source).includes(c)) || null)?.toUpperCase() || null,
    period: detectPeriod(source),
    raw: m[0].trim(),
  };
}

function toNumber(raw, magnitude) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/\s/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
  let n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  if (magnitude === 'k') n *= 1000;
  if (magnitude === 'm') n *= 1_000_000;
  return Math.round(n);
}

function detectPeriod(text) {
  const t = normaliseText(text);
  if (/(per|\/)\s*(hour|hr)\b|hourly/.test(t)) return 'hour';
  if (/(per|\/)\s*day\b|daily/.test(t)) return 'day';
  if (/(per|\/)\s*(month|monthly|pm)\b/.test(t)) return 'month';
  if (/(per|\/)\s*(annum|year|yr|pa|p\.a)\b|annual|yearly/.test(t)) return 'year';
  return null;
}

function matchPhrase(text) {
  const m = /(market\s*related|negotiable|competitive|depending on experience|not disclosed)/i.exec(text);
  return m ? m[0] : null;
}

/** Parses posted dates from ISO strings, relative phrasing or timestamps. */
export function parsePostedAt(value) {
  if (!value) return null;
  if (typeof value === 'number' || /^\d{10}$|^\d{13}$/.test(String(value))) {
    const ms = String(value).length === 10 ? Number(value) * 1000 : Number(value);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const str = String(value);
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime()) && /\d{4}/.test(str)) return parsed.toISOString();

  const rel = /(\d+)\s*(hour|day|week|month)s?\s*ago/i.exec(str);
  if (rel) {
    const n = Number(rel[1]);
    const unitMs = { hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000 }[rel[2].toLowerCase()];
    return new Date(Date.now() - n * unitMs).toISOString();
  }
  if (/just posted|today|new/i.test(str)) return new Date().toISOString();
  if (/yesterday/i.test(str)) return new Date(Date.now() - 86_400_000).toISOString();
  return null;
}

/** "25 applicants" / "over 100 applicants" / "Be an early applicant". */
export function parseApplicantCount(text = '') {
  const t = String(text);
  const m = /(\d{1,4})\s*(?:\+)?\s*applicants?/i.exec(t);
  if (m) return Number(m[1]);
  if (/early applicant|be an early applicant|no applicants/i.test(t)) return 0;
  return null;
}

export function inferWorkMode(text = '', explicit) {
  if (explicit && ['remote', 'hybrid', 'onsite', 'unknown'].includes(String(explicit).toLowerCase())) {
    return String(explicit).toLowerCase();
  }
  const t = normaliseText(text);
  if (/\bfully remote\b|\bremote\b|\bwork from home\b|\bwfh\b|\banywhere\b|\bdistributed team\b/.test(t)) return 'remote';
  if (/\bhybrid\b|\bpartially remote\b|\d\s*days?\s*(?:a week\s*)?in (?:the )?office/.test(t)) return 'hybrid';
  if (/\bon-?site\b|\bin-?office\b|\boffice[- ]based\b/.test(t)) return 'onsite';
  return 'unknown';
}

export function inferEmploymentType(text = '', explicit) {
  if (explicit) {
    const e = String(explicit).toLowerCase();
    if (/full/.test(e)) return 'full-time';
    if (/part/.test(e)) return 'part-time';
    if (/contract|contractor|fixed/.test(e)) return 'contract';
    if (/freelance/.test(e)) return 'freelance';
    if (/intern/.test(e)) return 'internship';
    if (/temp/.test(e)) return 'temporary';
    if (e) return e;
  }
  const t = normaliseText(text);
  if (/\bfreelance\b/.test(t)) return 'freelance';
  if (/\bpart[- ]time\b/.test(t)) return 'part-time';
  if (/\b(contract|contractor|fixed[- ]term)\b/.test(t)) return 'contract';
  if (/\binternship\b|\bgraduate programme\b|\bvacation work\b/.test(t)) return 'internship';
  if (/\bfull[- ]time\b|\bpermanent\b/.test(t)) return 'full-time';
  return null;
}

export function extractCountryFromLocation(location = '', fallback = null) {
  const text = String(location);
  const countries = [
    'South Africa', 'United Kingdom', 'Ireland', 'Netherlands', 'Germany', 'United States', 'USA', 'Canada',
    'Australia', 'New Zealand', 'United Arab Emirates', 'Kenya', 'Nigeria', 'India', 'Singapore', 'Portugal',
    'Spain', 'France', 'Poland', 'Brazil', 'Mexico', 'Ghana', 'Rwanda', 'Mauritius', 'Namibia', 'Botswana',
    'Zimbabwe', 'Sweden', 'Norway', 'Denmark', 'Switzerland', 'Israel', 'Japan', 'Philippines', 'Egypt',
  ];
  const t = normaliseText(text);
  const hit = countries.find((c) => t.includes(normaliseText(c)));
  if (hit) return hit === 'USA' ? 'United States' : hit;
  const cityMap = {
    johannesburg: 'South Africa', 'cape town': 'South Africa', durban: 'South Africa', pretoria: 'South Africa',
    centurion: 'South Africa', sandton: 'South Africa', 'port elizabeth': 'South Africa', london: 'United Kingdom',
    manchester: 'United Kingdom', dublin: 'Ireland', amsterdam: 'Netherlands', berlin: 'Germany', munich: 'Germany',
    'new york': 'United States', 'san francisco': 'United States', austin: 'United States', seattle: 'United States',
    toronto: 'Canada', vancouver: 'Canada', sydney: 'Australia', melbourne: 'Australia', dubai: 'United Arab Emirates',
    nairobi: 'Kenya', lagos: 'Nigeria', bangalore: 'India', bengaluru: 'India', mumbai: 'India', singapore: 'Singapore',
  };
  for (const [city, country] of Object.entries(cityMap)) if (t.includes(city)) return country;
  return fallback;
}

/**
 * Derives structured requirements from a job advert's prose.
 * @returns {{skills:string[], technologies:string[], tools:string[], minYears:number|null, education:string|null, questions:string[], seniority:string|null, language:string|null}}
 */
export function deriveRequirements(description = '', extra = {}) {
  const text = String(description || '');
  const skills = extractSkills(text, { limit: 40 });
  const educationMatch = /(bachelor[^.\n]{0,50}|bsc[^.\n]{0,40}|degree[^.\n]{0,40}|diploma[^.\n]{0,40})/i.exec(text);
  return {
    skills: extra.skills?.length ? extra.skills : skills.map((s) => s.label),
    skillIds: skills.map((s) => s.id),
    technologies: extra.technologies || skills.filter((s) => ['frontend', 'backend', 'cloud'].includes(s.category)).map((s) => s.label),
    tools: extra.tools || skills.filter((s) => s.category === 'tool').map((s) => s.label),
    minYears: Number.isFinite(extra.minYears) ? extra.minYears : detectRequiredYears(text),
    education: extra.education || (educationMatch ? educationMatch[1].trim() : null),
    seniority: extra.seniority || detectSeniority(text.slice(0, 600) + ' ' + (extra.title || ''))?.id || null,
    questions: extra.questions || [],
    language: extra.language || null,
    ...(extra.rest || {}),
  };
}

/** Builds the canonical job record used by the database and matcher. */
export function normalizeJob(input = {}, sourceMeta = {}) {
  const description = input.description || input.descriptionHtml?.replace(/<[^>]+>/g, ' ') || '';
  const requirements = deriveRequirements(description, {
    skills: input.requirements?.skills,
    technologies: input.requirements?.technologies,
    tools: input.requirements?.tools,
    minYears: input.requirements?.minYears,
    education: input.requirements?.education,
    questions: input.requirements?.questions,
    seniority: input.requirements?.seniority,
    title: input.title,
  });

  const salary = input.salaryMin || input.salaryMax
    ? { min: input.salaryMin ?? null, max: input.salaryMax ?? null, currency: input.salaryCurrency ?? null, period: input.salaryPeriod ?? null, raw: input.salaryRaw ?? null }
    : parseSalary(`${description.slice(0, 4000)} ${input.salaryRaw || ''}`);

  const location = input.location || (input.remote ? 'Remote' : null);
  const title = String(input.title || 'Untitled role').trim();

  return {
    sourceKey: input.sourceKey || sourceMeta.key || 'manual',
    externalId: input.externalId ? String(input.externalId) : null,
    title,
    company: input.company ? String(input.company).trim() : null,
    companyDomain: input.companyDomain || null,
    location: location ? String(location).trim() : null,
    country: input.country || extractCountryFromLocation(location, null),
    workMode: inferWorkMode(`${title} ${location} ${description.slice(0, 1500)}`, input.workMode),
    employmentType: inferEmploymentType(`${title} ${description.slice(0, 1500)}`, input.employmentType),
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
    salaryPeriod: salary.period,
    salaryRaw: salary.raw,
    description: description.slice(0, 20_000),
    url: input.url || null,
    applyUrl: input.applyUrl || input.url || null,
    applyEmail: input.applyEmail || extractApplyEmail(description),
    postedAt: parsePostedAt(input.postedAt || input.createdAt),
    applicantsCount: Number.isFinite(input.applicantsCount) ? input.applicantsCount : parseApplicantCount(`${description.slice(0, 1200)} ${input.applicantsRaw || ''}`),
    requirements,
    tags: input.tags || [],
    isDemo: !!input.isDemo,
    apply: input.apply || { mode: 'assisted', note: 'No automated application route configured for this source.' },
  };
}

/** Local parts that indicate a hiring mailbox, used to pick the right address. */
const HIRING_MAILBOX = /^(careers?|jobs?|hr|recruit(ment)?|talent|hiring|apply|applications?|people|vacanc(y|ies)|admin|team)[._-]?/i;
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * Picks the address an advert wants applications sent to.
 *
 * Adverts often contain several addresses (recruiters, privacy contacts, references).
 * Addresses that look like hiring mailboxes, or that sit next to “email / send / apply”,
 * win over ones that merely appear earlier in the text. The previous implementation was
 * greedy and could return a truncated local part ("s@…" out of "careers@…"), which would
 * have sent applications to the wrong address — hence the whole-address match below.
 */
export function extractApplyEmail(text = '') {
  const body = String(text || '');
  const found = [...body.matchAll(EMAIL_PATTERN)].map((m) => m[0]);
  if (!found.length) return null;

  const ranked = found
    .map((email, index) => {
      const local = email.split('@')[0];
      const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const requested = new RegExp(`(e-?mail|send|forward|apply|applications?|cv)[^@\n]{0,80}${escaped}`, 'i').test(body)
        || new RegExp(`${escaped}[^\n]{0,80}(e-?mail|apply|applications?)`, 'i').test(body);
      let rank = 0;
      if (HIRING_MAILBOX.test(local)) rank += 3;
      if (requested) rank += 2;
      if (/\.(example|test|invalid|localhost)$/i.test(email.split('@')[1] || '')) rank -= 1;
      return { email, rank, index };
    })
    .sort((a, b) => b.rank - a.rank || a.index - b.index);

  return ranked[0].email;
}

/** Stable key for duplicate protection: same posting, same company+title. */
export function dedupeKey(job) {
  if (job.externalId && job.sourceKey) return `${job.sourceKey}:${String(job.externalId).toLowerCase()}`;
  if (job.url) return `url:${canonicalUrl(job.url)}`;
  return `ct:${normaliseText(job.company || '')}|${normaliseText(job.title || '')}|${normaliseText(job.location || '')}`;
}

export function companyKey(job) {
  return normaliseText(job.company || '') || canonicalUrl(job.url || '') || 'unknown';
}

export function canonicalUrl(url = '') {
  try {
    const u = new URL(String(url));
    const dropParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', 'refId', 'trackingId'];
    for (const p of dropParams) u.searchParams.delete(p);
    u.hash = '';
    return u.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return String(url).toLowerCase();
  }
}

export function companyDomainFromUrl(url = '') {
  try {
    const host = new URL(String(url)).hostname.replace(/^www\./, '');
    const aggregators = ['linkedin.com', 'indeed.com', 'glassdoor.com', 'greenhouse.io', 'lever.co', 'workable.com', 'wellfound.com', 'pnet.co.za', 'careers24.com', 'arbeitnow.com', 'remotive.com'];
    if (aggregators.some((a) => host.endsWith(a))) return null;
    return host;
  } catch {
    return null;
  }
}
