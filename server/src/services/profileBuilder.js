/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
/**
 * CV understanding: raw CV text -> structured candidate profile.
 *
 * Deterministic by design: every extracted value carries evidence (the CV text it
 * came from) so the user can audit it, and so the application generator can prove
 * that nothing was invented. An LLM can be layered on top (services/llm.js) but is
 * never required.
 */
import { extractSkills, normaliseText, detectSeniority, SKILL_BY_ID, SENIORITY_LEVELS } from './skillTaxonomy.js';
import { rejoinWrappedLinks } from './cvParser.js';

const SECTION_ALIASES = {
  contact: ['contact', 'contact details', 'personal details', 'personal information'],
  summary: ['summary', 'profile', 'professional summary', 'professional profile', 'about me', 'about', 'personal summary', 'career summary', 'career profile', 'overview', 'objective', 'career objective'],
  experience: ['experience', 'work experience', 'professional experience', 'employment history', 'employment', 'work history', 'career history', 'relevant experience'],
  education: ['education', 'education & training', 'education and training', 'academic background', 'qualifications', 'academic qualifications', 'training'],
  skills: ['skills', 'technical skills', 'core skills', 'key skills', 'core competencies', 'competencies', 'areas of expertise', 'expertise', 'professional skills', 'software', 'software skills', 'tools', 'tools & technologies', 'technical proficiencies', 'technology stack', 'skills & tools', 'skills and tools'],
  certifications: ['certifications', 'certification', 'certificates', 'licences', 'licenses', 'accreditations', 'professional development', 'courses', 'training courses'],
  projects: ['projects', 'key projects', 'selected projects', 'portfolio', 'personal projects', 'side projects', 'case studies'],
  achievements: ['achievements', 'awards', 'awards & recognition', 'key achievements', 'accomplishments', 'honours', 'honors', 'recognition'],
  languages: ['languages', 'language proficiency'],
  interests: ['interests', 'hobbies', 'interests & hobbies', 'volunteering', 'volunteer experience'],
  references: ['references', 'referees'],
};

const SECTION_LOOKUP = (() => {
  const map = new Map();
  for (const [key, aliases] of Object.entries(SECTION_ALIASES)) {
    for (const alias of aliases) map.set(alias, key);
  }
  return map;
})();

const DEGREE_PATTERNS = [
  /\bphd\b|\bdoctorate\b/i,
  /\bmaster'?s?\b|\bmba\b|\bmsc\b|\bm\.?sc\b|\bma\b|\bmcom\b|\bmphil\b/i,
  /\bhonours\b|\bhonors\b|\bbhons\b|\bhons\b/i,
  /\bbachelor'?s?\b|\bbsc\b|\bb\.?sc\b|\bba\b|\bbcom\b|\bbeng\b|\bbtech\b|\bb\.?tech\b/i,
  /\bnational diploma\b|\badvanced diploma\b|\bdiploma\b|\bhigher certificate\b|\bcertificate iv\b/i,
  /\bmatric\b|\bgrade 12\b|\bhigh school\b|\bnsc\b/i,
];

const CERT_PATTERNS = [
  /\bcertified\b/i, /\bcertification\b/i, /\bcertificate\b/i, /\baccredit/i,
  /nielsen norman/i, /google ux/i, /scrum master/i, /\bpmp\b/i, /\bitil\b/i,
  /\baws certified\b/i, /\bazure\b.*\bcertified\b/i, /\badobe certified\b/i, /\bcspo\b/i, /\bcsd\b/i,
];

const INDUSTRY_KEYWORDS = [
  ['fintech', 'FinTech'], ['financial services', 'Financial Services'], ['banking', 'Banking'],
  ['insurance', 'Insurance'], ['e-commerce', 'E-commerce'], ['ecommerce', 'E-commerce'],
  ['retail', 'Retail'], ['healthcare', 'Healthcare'], ['health tech', 'HealthTech'],
  ['edtech', 'EdTech'], ['education', 'Education'], ['telecom', 'Telecommunications'],
  ['telecommunications', 'Telecommunications'], ['logistics', 'Logistics'], ['media', 'Media'],
  ['gaming', 'Gaming'], ['saas', 'SaaS'], ['software', 'Software'], ['technology', 'Technology'],
  ['government', 'Public Sector'], ['public sector', 'Public Sector'], ['municipal', 'Public Sector'],
  ['ngo', 'NGO / Non-profit'], ['non-profit', 'NGO / Non-profit'], ['mining', 'Mining'],
  ['energy', 'Energy'], ['agriculture', 'Agriculture'], ['travel', 'Travel & Hospitality'],
  ['hospitality', 'Travel & Hospitality'], ['property', 'Property'], ['legal', 'Legal'],
  ['consulting', 'Consulting'], ['advertising', 'Advertising'], ['marketing', 'Marketing'],
  ['automotive', 'Automotive'], ['crypto', 'Crypto / Web3'], ['blockchain', 'Crypto / Web3'],
  ['security', 'Security'], ['manufacturing', 'Manufacturing'], ['hr', 'HR Tech'],
];

const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

const BULLET_RE = /^\s*(?:[-•▪◦*·‣–—]|\d{1,2}[.)])\s+/;

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * @param {string} rawText CV as plain text
 * @param {{ filename?: string }} [opts]
 * @returns {{ profile: object, extraction: object }}
 */
export function buildProfile(rawText, opts = {}) {
  // Links and emails wrapped across lines by a PDF text layer are rejoined first.
  const text = normaliseLines(rejoinWrappedLinks(String(rawText || '')));
  if (text.replace(/\s/g, '').length < 80) {
    throw Object.assign(new Error('The CV text is too short to understand. Upload a fuller CV or paste more detail.'), {
      status: 422,
      code: 'cv_too_short',
    });
  }

  const sections = splitSections(text);
  const warnings = [];
  const evidence = {};

  const contact = extractContact(text, sections);
  const summary = extractSummary(sections);
  const experience = extractExperience(sections, text);
  const education = extractEducation(sections, text);
  const certifications = extractCertifications(sections, text);
  const projects = extractProjects(sections);
  const achievements = extractAchievements(sections, text);
  const skills = extractSkills(text, { limit: 80 });
  const declaredSkills = extractDeclaredSkills(sections);
  const languages = extractLanguages(sections, text);
  const industries = extractIndustries(text);
  const jobTitles = uniqueBy(
    [
      ...experience.map((e) => e.title).filter(Boolean),
      ...(sections.summary ? [firstTitleLikeLine(sections.summary)].filter(Boolean) : []),
    ],
    (t) => t.toLowerCase()
  );

  const years = estimateYears(experience, text);
  const seniority = estimateSeniority(jobTitles, years, text);

  const salaryExpectation = matchFirst(text, /(?:expected|desired|required)\s+salary[:\s]*([^\n]{2,60})/i) || matchFirst(text, /salary\s+expectation[:\s]*([^\n]{2,60})/i);
  const salaryCurrency = salaryExpectation ? guessCurrency(salaryExpectation) : undefined;
  const noticeRaw = matchFirst(text, /notice\s+period[:\s]*([^\n.]{2,40})/i) || matchFirst(text, /(available\s+(?:immediately|from)[^\n.]{0,30})/i);
  const noticePeriod = noticeRaw ? noticeRaw.replace(/^notice\s+period[:\s]*/i, '').replace(/\s{2,}/g, ' ').trim() : null;
  const workAuthRaw = matchFirst(text, /(?:work\s+(?:authorisation|authorization|permit)|right\s+to\s+work|visa)[:\s]*([^\n]{2,140})/i);
  const workAuth = workAuthRaw ? workAuthRaw.replace(/^[^:]{0,40}[:]\s*/, '').trim() : null;

  if (!contact.email) warnings.push('No email address found on the CV — add one so applications can be attributed to you.');
  if (!contact.phone) warnings.push('No phone number found on the CV.');
  if (!experience.length) warnings.push('No work-experience entries were detected. Check the “Experience” section of the CV.');
  if (contact.phone) evidence.phone = contact.phone;
  if (contact.email) evidence.email = contact.email;

  const profile = {
    fullName: contact.name || guessNameFromEmail(contact.email) || null,
    headline: jobTitles[0] || summaryFirstLine(summary) || null,
    email: contact.email || null,
    phone: contact.phone || null,
    location: contact.location || null,
    country: contact.country || null,
    city: contact.city || null,
    linkedinUrl: contact.linkedin || null,
    portfolioUrl: contact.portfolio || null,
    githubUrl: contact.github || null,
    summary: summary || null,
    yearsExperience: years.value,
    seniority: seniority.id,
    workAuthorization: workAuth || null,
    salaryExpectation: salaryExpectation || null,
    salaryCurrency: salaryCurrency || null,
    noticePeriod: noticePeriod || null,
    skills: skills.map((s) => ({ id: s.id, label: s.label, category: s.category, hits: s.hits })),
    declaredSkills,
    tools: skills.filter((s) => s.category === 'tool').map((s) => s.label),
    jobTitles,
    experience,
    education,
    certifications,
    projects,
    languages,
    industries,
    achievements,
  };

  const extraction = {
    method: 'heuristic',
    source: opts.filename ? { filename: opts.filename } : undefined,
    parsedAt: new Date().toISOString(),
    confidence: confidenceScore(profile),
    sectionsDetected: Object.keys(sections),
    yearsBasis: years.basis,
    seniorityBasis: seniority.basis,
    warnings,
    evidence: {
      ...evidence,
      name: contact.nameEvidence,
      years: years.evidence,
      titles: jobTitles.slice(0, 5),
    },
    /** Everything that is *true* about this candidate — the generator may only use this. */
    truthIndex: buildTruthIndex(profile, text),
  };

  return { profile: { ...profile, extraction }, extraction };
}

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

function normaliseLines(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\t/g, '    ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Splits the CV into named sections using heading detection (ALL CAPS or short bold-ish lines). */
export function splitSections(text) {
  const lines = text.split('\n');
  const sections = {};
  let current = 'preamble';
  sections[current] = [];
  let seen = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      sections[current].push('');
      continue;
    }
    seen += 1;
    // Unknown headings (e.g. "NOTICE PERIOD", "REFEREES") must still end the
    // previous section, but the first lines of the CV are the candidate's name
    // and headline, so they are never treated as headings.
    const unknownHeading = seen > 2 ? slugHeading(line) : null;
    const key = headingKey(line) || unknownHeading;
    if (key) {
      current = key;
      sections[current] = sections[current] || [];
      const trailing = line.replace(/^[^A-Za-z]*/, '');
      const rest = trailing.replace(new RegExp(`^\\s*${escapeRegex(aliasFor(key, trailing))}`, 'i'), '').replace(/^[\s:|•\-–]+/, '');
      if (rest.trim().length > 2) sections[current].push(rest.trim());
      continue;
    }
    sections[current].push(line);
  }

  const out = {};
  for (const [k, v] of Object.entries(sections)) {
    const joined = v.join('\n').trim();
    if (joined) out[k] = joined;
  }
  return out;
}

function aliasFor(key, line) {
  const aliases = SECTION_ALIASES[key] || [];
  const t = line.toLowerCase();
  return aliases.find((a) => t.includes(a)) || '';
}

/** Detects a short ALL-CAPS line used as a section heading by CV templates. */
function slugHeading(line) {
  const clean = line.replace(/[:|]+$/, '').trim();
  if (clean.length < 3 || clean.length > 32) return null;
  if (!/^[A-Z][A-Z0-9 &/'.-]*$/.test(clean)) return null;
  if (clean.split(/\s+/).length > 4) return null;
  if (/^[A-Z]{2,4}$/.test(clean)) return null; // all-caps acronyms/countries
  return `other_${clean.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

function headingKey(line) {
  const cleaned = line.replace(/[:|]+$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!cleaned || cleaned.length > 42) return null;
  if (SECTION_LOOKUP.has(cleaned)) return SECTION_LOOKUP.get(cleaned);
  // "Skills: Figma, CSS" / "Technical Skills — Figma"
  const head = cleaned.split(/[:|–—-]/)[0].trim();
  if (SECTION_LOOKUP.has(head)) return SECTION_LOOKUP.get(head);
  return null;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------------ *
 * Contact
 * ------------------------------------------------------------------ */

function extractContact(text, sections) {
  const head = (sections.preamble || '') + '\n' + (sections.contact || '');
  const email = matchFirst(text, /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
  const phoneRaw = matchFirst(head, /(\+?\d[\d\s().-]{7,}\d)/);
  const phone = phoneRaw ? phoneRaw.trim().replace(/\s{2,}/g, ' ') : null;
  // Links may appear with or without a scheme ("linkedin.com/in/x"), so both are accepted.
  const linkedin = matchFirst(text, /((?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub)\/[^\s,;)]+)/i);
  const github = matchFirst(text, /((?:https?:\/\/)?(?:www\.)?github\.com\/[^\s,;)]+)/i);
  const portfolio = matchFirst(text, /((?:https?:\/\/)?(?:www\.)?(?!(?:www\.)?(?:linkedin|github)\.com)[a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?\/[^\s,;)]*)/i)
    || matchFirst(text, /\b((?:www\.)[a-z0-9-]+\.[a-z]{2,}[^\s,;)]*)/i);

  const lines = (sections.preamble || text).split('\n').map((l) => l.trim()).filter(Boolean);
  let name = null;
  let nameEvidence = null;
  for (const line of lines.slice(0, 6)) {
    if (line.includes('@') || /\d{4}/.test(line) || /https?:/i.test(line)) continue;
    const words = line.replace(/[^\p{L}\s'-]/gu, '').trim().split(/\s+/);
    if (words.length < 2 || words.length > 5) continue;
    if (line.length > 45) continue;
    if (/curriculum vitae|resume|cv\b/i.test(line)) continue;
    const titleCased = words.filter((w) => /^[A-Z]/.test(w)).length;
    if (titleCased >= Math.ceil(words.length / 2)) {
      const joined = words.join(' ');
      name = joined === joined.toUpperCase() ? titleCase(joined.toLowerCase()) : joined;
      nameEvidence = line;
      break;
    }
  }

  const location = detectLocation(head);
  return {
    name,
    nameEvidence,
    email: email || null,
    phone,
    linkedin,
    github,
    portfolio: portfolio && !/linkedin|github/i.test(portfolio) ? normaliseUrl(portfolio) : null,
    location: location?.raw || null,
    city: location?.city || null,
    country: location?.country || null,
  };
}

const CITY_COUNTRY = [
  ['johannesburg', 'South Africa', ['johannesburg', 'joburg', 'jhb', 'sandton', 'midrand', 'rosebank']],
  ['cape town', 'South Africa', ['cape town', 'capetown', 'stellenbosch', 'paarl']],
  ['durban', 'South Africa', ['durban', 'umhlanga', 'pinetown']],
  ['pretoria', 'South Africa', ['pretoria', 'centurion', 'tshwane']],
  ['port elizabeth', 'South Africa', ['port elizabeth', 'gqeberha']],
  ['east london', 'South Africa', ['east london']],
  ['bloemfontein', 'South Africa', ['bloemfontein']],
  ['london', 'United Kingdom', ['london', 'manchester', 'birmingham', 'leeds', 'edinburgh', 'bristol']],
  ['dublin', 'Ireland', ['dublin', 'cork']],
  ['amsterdam', 'Netherlands', ['amsterdam', 'rotterdam', 'utrecht']],
  ['berlin', 'Germany', ['berlin', 'munich', 'hamburg']],
  ['new york', 'United States', ['new york', 'nyc', 'brooklyn', 'san francisco', 'austin', 'seattle', 'boston', 'chicago', 'los angeles', 'denver', 'atlanta']],
  ['toronto', 'Canada', ['toronto', 'vancouver', 'montreal', 'calgary']],
  ['sydney', 'Australia', ['sydney', 'melbourne', 'brisbane', 'perth']],
  ['dubai', 'United Arab Emirates', ['dubai', 'abu dhabi']],
  ['nairobi', 'Kenya', ['nairobi']],
  ['lagos', 'Nigeria', ['lagos', 'abuja']],
  ['bangalore', 'India', ['bangalore', 'bengaluru', 'hyderabad', 'pune', 'mumbai', 'delhi']],
];

const COUNTRY_NAMES = ['south africa', 'united kingdom', 'ireland', 'netherlands', 'germany', 'united states', 'usa', 'canada', 'australia', 'new zealand', 'united arab emirates', 'kenya', 'nigeria', 'india', 'singapore', 'portugal', 'spain', 'france', 'poland', 'brazil', 'mexico', 'namibia', 'botswana', 'zimbabwe', 'ghana', 'rwanda', 'mauritius', 'sweden', 'norway', 'denmark', 'switzerland'];

function detectLocation(text) {
  const t = normaliseText(text);
  for (const [city, country, keys] of CITY_COUNTRY) {
    const hit = keys.find((k) => t.includes(k));
    if (hit) return { raw: `${titleCase(hit)}${country ? `, ${country}` : ''}`, city: titleCase(city), country };
  }
  const country = COUNTRY_NAMES.find((c) => t.includes(c));
  if (country) return { raw: titleCase(country), city: null, country: titleCase(country) };
  if (/\bremote\b|\bwork from home\b|\bwfh\b/.test(t)) return { raw: 'Remote', city: null, country: null };
  return null;
}

function normaliseUrl(url) {
  if (!url) return null;
  return url.startsWith('http') ? url : `https://${url.replace(/^www\./, 'www.')}`;
}

/* ------------------------------------------------------------------ *
 * Summary / titles
 * ------------------------------------------------------------------ */

function extractSummary(sections) {
  const raw = sections.summary;
  if (raw) {
    const cleaned = raw
      .split('\n')
      .filter((l) => l.trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length > 40) return cleaned.slice(0, 1200);
  }
  return null;
}

function summaryFirstLine(summary) {
  if (!summary) return null;
  const first = summary.split(/(?<=[.!?])\s/)[0];
  return first && first.length <= 90 ? first : null;
}

function firstTitleLikeLine(text) {
  const titleWords = /\b(designer|developer|engineer|lead|manager|specialist|consultant|architect|analyst)\b/i;
  const line = text.split('\n').find((l) => l.length < 80 && titleWords.test(l));
  return line ? line.replace(/^[\s\-–•|]+/, '').trim() : null;
}

/* ------------------------------------------------------------------ *
 * Experience
 * ------------------------------------------------------------------ */

const DATE_RANGE_RE = new RegExp(
  [
    // Jan 2020 - Present | January 2020 – December 2022
    `((?:${Object.keys(MONTHS).join('|')})\\.?\\s+\\d{4})\\s*(?:-|–|—|to|until|\\u2013)\\s*((?:${Object.keys(MONTHS).join('|')})\\.?\\s+\\d{4}|present|current|now|to\\s+date)`,
    // 2020 - 2023 | 2020–Present
    `(\\b(?:19|20)\\d{2})\\s*(?:-|–|—|to|until|\\u2013)\\s*(\\b(?:19|20)\\d{2}\\b|present|current|now|to\\s+date)`,
    // 2020 - 06/2023
    `(\\b(?:19|20)\\d{2})\\s*(?:-|–|—|to|\\u2013)\\s*(\\d{1,2}\\/\\d{4})`,
  ].join('|'),
  'i'
);

function extractExperience(sections, wholeText) {
  const body = sections.experience || '';
  if (!body) return [];
  const blocks = splitEntries(body);
  const entries = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const blockText = lines.join(' ');
    const range = parseDateRange(blockText);
    const headerLine = lines[0];
    const { title, company } = splitTitleCompany(headerLine, lines);
    const highlights = lines.filter((l) => BULLET_RE.test(l)).map((l) => l.replace(BULLET_RE, '').trim()).filter((l) => l.length > 12);
    const description = lines
      .filter((l) => l !== lines[0] && !BULLET_RE.test(l))
      .join(' ')
      .trim();

    if (!title && !company && highlights.length === 0) continue;
    entries.push({
      title: cleanTitle(title),
      company: company ? cleanCompany(company) : null,
      location: detectLocation(block)?.raw || null,
      startDate: range.start,
      endDate: range.end,
      current: range.current,
      employmentType: detectEmploymentType(blockText),
      highlights: highlights.slice(0, 8),
      description: description ? description.slice(0, 800) : null,
      sourceText: blockText.slice(0, 600),
    });
  }

  // Keep only plausible entries (must have a title or a company)
  const filtered = entries.filter((e) => e.title || e.company);
  if (!filtered.length && body) {
    // Fallback: the section may be a single free-text paragraph
    const range = parseDateRange(body);
    return [
      {
        title: cleanTitle(firstTitleLikeLine(body)) || null,
        company: null,
        location: detectLocation(body)?.raw || null,
        startDate: range.start,
        endDate: range.end,
        current: range.current,
        employmentType: detectEmploymentType(body),
        highlights: body.split('\n').filter((l) => BULLET_RE.test(l)).map((l) => l.replace(BULLET_RE, '').trim()).slice(0, 6),
        description: body.replace(/\s+/g, ' ').slice(0, 800),
        sourceText: body.slice(0, 400),
      },
    ].filter((e) => e.title || e.highlights.length);
  }
  return filtered;
}

/** Splits an experience section into entries, starting a new entry at each date range or header. */
function splitEntries(body) {
  const lines = body.split('\n');
  const chunks = [];
  let current = [];
  let seenRange = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (current.length && seenRange) {
        chunks.push(current.join('\n'));
        current = [];
        seenRange = false;
      }
      continue;
    }
    const hasRange = DATE_RANGE_RE.test(trimmed);
    const isHeaderish = !BULLET_RE.test(trimmed) && trimmed.length < 90 && /\||·|—|–|\bat\b|-/.test(trimmed);
    if (hasRange && seenRange && current.length) {
      chunks.push(current.join('\n'));
      current = [];
    }
    if (!seenRange && !hasRange && !BULLET_RE.test(trimmed) && trimmed.length < 70) {
      // Potential job title above its date line — keep accumulating.
      current.push(trimmed);
      continue;
    }
    if (hasRange) seenRange = true;
    if (!hasRange && !seenRange && current.length === 0 && !isHeaderish) continue;
    current.push(trimmed);
  }
  if (current.length) chunks.push(current.join('\n'));
  return chunks.length ? chunks : [body];
}

function splitTitleCompany(headerLine, allLines) {
  const line = headerLine.replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ').trim();
  const withoutDates = line.replace(DATE_RANGE_RE, '').replace(/[|·]\s*$/, '').trim();
  const separators = ['|', '·', '•', '—', '–', ' at ', ', @ ', ' @ ', ' - ', ' – ', ','];
  for (const sep of separators) {
    if (withoutDates.toLowerCase().includes(sep)) {
      const parts = withoutDates.split(sep).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const [a, b] = parts;
        return titleCompanyOrder(a, b);
      }
    }
  }
  // No separator: look at the second line for a company, otherwise guess by keywords
  const next = allLines[1] || '';
  const titleish = /\b(designer|developer|engineer|manager|lead|consultant|specialist|analyst|architect|director|intern|officer|associate)\b/i.test(withoutDates);
  if (titleish) return { title: withoutDates, company: looksLikeCompany(next) ? next.trim() : null };
  return { title: withoutDates || null, company: null };
}

function titleCompanyOrder(a, b) {
  const isTitle = (v) => /\b(designer|developer|engineer|manager|lead|consultant|specialist|analyst|architect|director|intern|officer|associate|head)\b/i.test(v);
  if (isTitle(a) && !isTitle(b)) return { title: a, company: b };
  if (isTitle(b) && !isTitle(a)) return { title: b, company: a };
  return { title: a, company: b };
}

function looksLikeCompany(line = '') {
  if (!line || line.length > 60) return false;
  if (BULLET_RE.test(line)) return false;
  if (DATE_RANGE_RE.test(line)) return false;
  return !/^(remote|hybrid|onsite|on-site|full[- ]time|contract|freelance)/i.test(line.trim());
}

function cleanTitle(title) {
  if (!title) return null;
  return title
    .replace(DATE_RANGE_RE, '')
    .replace(/[|,;·–—-]+\s*$/, '')
    .replace(/^[|,;·–—-]+\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || null;
}

function cleanCompany(company) {
  if (!company) return null;
  return company
    .replace(DATE_RANGE_RE, '')
    .replace(/\b(remote|hybrid|on-?site)\b/gi, '')
    .replace(/[|,;·–—-]+\s*$/, '')
    .replace(/^[|,;·–—-]+\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || null;
}

export function parseDateRange(text = '') {
  const m = DATE_RANGE_RE.exec(text);
  if (!m) return { start: null, end: null, current: false, months: null };
  let startRaw = m[1] || m[3] || m[5];
  let endRaw = m[2] || m[4] || m[6];
  const start = parseMonthYear(startRaw);
  const current = /present|current|now|to\s+date/i.test(endRaw || '');
  const end = current ? null : parseMonthYear(endRaw);
  let months = null;
  if (start) {
    const endPoint = current ? new Date() : end;
    if (endPoint) months = Math.max(0, monthsBetween(start, endPoint));
  }
  return { start, end, current, months, raw: m[0] };
}

function parseMonthYear(value) {
  if (!value) return null;
  const v = String(value).trim();
  const iso = /^(\d{4})-(\d{1,2})$/.exec(v);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, 1);
  const slashed = /^(\d{1,2})\/(\d{4})$/.exec(v);
  if (slashed) return new Date(Number(slashed[2]), Math.min(11, Number(slashed[1]) - 1), 1);
  const monthYear = /^([a-z]{3,9})\.?\s+(\d{4})$/i.exec(v);
  if (monthYear) {
    const month = MONTHS[monthYear[1].toLowerCase()];
    if (month !== undefined) return new Date(Number(monthYear[2]), month, 1);
  }
  const yearOnly = /^(\d{4})$/.exec(v);
  if (yearOnly) return new Date(Number(yearOnly[1]), 0, 1);
  return null;
}

function monthsBetween(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export function detectEmploymentType(text = '') {
  const t = normaliseText(text);
  if (/\bfreelance\b|\bcontractor\b|\bcontract\b/.test(t)) return 'contract';
  if (/\bpart[- ]time\b/.test(t)) return 'part-time';
  if (/\bintern(ship)?\b|\bgraduate programme\b/.test(t)) return 'internship';
  if (/\bpermanent\b|\bfull[- ]time\b|\bemployed\b/.test(t)) return 'full-time';
  return null;
}

/** Estimates total professional experience in years, with the basis recorded. */
export function estimateYears(experience, wholeText) {
  // A figure the candidate states themselves ("6 years of experience") is used as-is;
  // date arithmetic is only a fallback, because employment gaps and part-time roles
  // make it less reliable than the CV's own claim.
  const explicit = /(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years|yrs)(?:'|’)?\s*(?:of\s*)?(?:experience|industry)/i.exec(wholeText || '');
  if (explicit) {
    const value = Number(explicit[1]);
    if (Number.isFinite(value) && value > 0 && value < 60) {
      return { value, basis: 'stated on CV', evidence: [explicit[0]] };
    }
  }

  const withMonths = experience.filter((e) => e.startDate && (e.endDate || e.current));
  if (withMonths.length) {
    let totalMonths = 0;
    for (const e of withMonths) {
      const start = e.startDate;
      const end = e.current ? new Date() : e.endDate;
      if (start && end) totalMonths += Math.max(0, monthsBetween(start, end));
    }
    // Overlapping roles would double count: cap at the calendar span instead.
    const starts = withMonths.map((e) => e.startDate.getTime());
    const ends = withMonths.map((e) => (e.current ? Date.now() : e.endDate.getTime()));
    const spanMonths = monthsBetween(new Date(Math.min(...starts)), new Date(Math.max(...ends)));
    const months = Math.min(totalMonths, spanMonths || totalMonths);
    const value = Math.round((months / 12) * 10) / 10;
    if (value > 0) {
      return { value, basis: 'summed dated roles (overlaps capped)', evidence: withMonths.map((e) => e.sourceText?.slice(0, 80)) };
    }
  }

  const ranges = [...(wholeText || '').matchAll(DATE_RANGE_RE)];
  const years = ranges
    .flatMap((m) => [m[1] || m[3] || m[5], m[2] || m[4] || m[6]])
    .map((v) => (/^\d{4}$/.test(v || '') ? Number(v) : parseMonthYear(v)?.getFullYear()))
    .filter((y) => Number.isFinite(y) && y > 1970);
  if (years.length >= 2) {
    const span = Math.max(...years) - Math.min(...years);
    return { value: Math.max(0.5, span), basis: 'span of dated history', evidence: [`${Math.min(...years)}–${Math.max(...years)}`] };
  }
  return { value: null, basis: 'insufficient dated history', evidence: [] };
}

function estimateSeniority(titles, years, text) {
  const fromTitles = titles.map((t) => detectSeniority(t)).filter(Boolean);
  const fromText = detectSeniority(text.slice(0, 1500));
  let level = fromTitles.sort((a, b) => b.rank - a.rank)[0] || fromText;
  let basis = level ? `titles/text mention “${level.label}”` : 'not stated';
  if (level && years.value !== null) {
    // A "senior" title with <2 years is almost certainly not senior.
    if (level.rank >= 4 && years.value < 2) {
      level = SENIORITY_LEVELS.find((l) => l.id === 'junior');
      basis = 'title suggested seniority but dated history is short';
    } else if (level.rank >= 4 && years.value < 4 && level.id === 'senior') {
      basis = 'senior title with ' + years.value + ' years of dated history';
    }
  }
  if (!level && years.value !== null) {
    level = years.value >= 8 ? SENIORITY_LEVELS.find((l) => l.id === 'lead') : years.value >= 4 ? SENIORITY_LEVELS.find((l) => l.id === 'mid') : SENIORITY_LEVELS.find((l) => l.id === 'junior');
    basis = `inferred from ${years.value} years of experience`;
  }
  return { id: level?.id || 'unknown', label: level?.label || 'Unknown', rank: level?.rank ?? 0, basis };
}

/* ------------------------------------------------------------------ *
 * Education / certifications / projects / achievements
 * ------------------------------------------------------------------ */

function extractEducation(sections, text) {
  const body = sections.education || '';
  if (!body) {
    const loose = matchAllLines(text, DEGREE_PATTERNS);
    return loose.slice(0, 4).map((line) => educationEntry(line));
  }
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && (DEGREE_PATTERNS.some((p) => p.test(l)) || /\b(19|20)\d{2}\b/.test(l)))
    .map((line) => educationEntry(line))
    .filter((e) => e.qualification)
    .slice(0, 8);
}

function educationEntry(line) {
  const clean = line.replace(BULLET_RE, '').trim();
  const year = /(\b(?:19|20)\d{2}\b[\s,–-]*(?:\b(?:19|20)\d{2}\b)?)/.exec(clean);
  const institutionMatch = /(?:,|\||–|—|-| at | from )\s*([A-Z][\w'&.\- ]{3,60})$/.exec(clean);
  const qualification = clean.split(/[,|–—]| at | from /)[0].trim();
  return {
    qualification: qualification || clean,
    institution: institutionMatch ? institutionMatch[1].trim() : null,
    year: year ? year[1].trim() : null,
    raw: clean,
  };
}

function extractCertifications(sections, text) {
  const fromSection = (sections.certifications || '')
    .split('\n')
    .map((l) => l.replace(BULLET_RE, '').trim())
    .filter((l) => l.length > 3 && l.length < 160);
  const fromText = matchAllLines(text, CERT_PATTERNS).map((l) => l.replace(BULLET_RE, '').trim());
  const all = [...new Set([...fromSection, ...fromText])].filter((l) => l.length < 160);
  return all.slice(0, 12).map((raw) => {
    const year = /(\b(?:19|20)\d{2}\b)/.exec(raw);
    return { name: raw.split(/[,–—|]| from | by /)[0].trim() || raw, issuer: null, year: year ? year[1] : null, raw };
  });
}

function extractProjects(sections) {
  const body = sections.projects || '';
  if (!body) return [];
  return splitEntries(body)
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return null;
      const title = lines[0].replace(BULLET_RE, '').replace(DATE_RANGE_RE, '').replace(/[|–—-]\s*$/, '').trim();
      const description = lines
        .slice(1)
        .filter((l) => !DATE_RANGE_RE.test(l))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!title) return null;
      return {
        name: title.slice(0, 120),
        description: (description || lines[0]).slice(0, 600),
        startDate: parseDateRange(block).start,
        endDate: parseDateRange(block).end,
        url: matchFirst(block, /(https?:\/\/[^\s)]+)/i) || null,
      };
    })
    .filter((p) => p && p.name.length > 2)
    .slice(0, 8);
}

function extractAchievements(sections, text) {
  const pool = [sections.achievements || '', sections.summary || '', sections.experience || ''].join('\n');
  const lines = pool
    .split('\n')
    .map((l) => l.replace(BULLET_RE, '').trim())
    .filter((l) => l.length > 20 && l.length < 300);
  const quantified = lines.filter(
    (l) => /\d+\s*%|\bR\s?\d|[$€£]\s?\d|\b\d{2,}\s*(users|clients|projects|screens|designs|releases|teams|people|leads|conversions|hours|days|weeks)\b|\b(increased|reduced|improved|grew|cut|saved|accelerated|led|launched|scaled|drove)\b/i.test(l)
  );
  const unique = [...new Set(quantified)];
  return unique.slice(0, 10).map((raw) => ({ text: raw, quantified: /\d/.test(raw) }));
}

function extractDeclaredSkills(sections) {
  const body = sections.skills || '';
  if (!body) return [];
  const tokens = body
    .split(/[\n,;|•·\/]|(?:\s{3,})/)
    .map((t) => t.replace(BULLET_RE, '').replace(/^[A-Za-z ]{0,18}:/, '').trim())
    .filter((t) => t.length > 1 && t.length < 40 && !/^(skills|tools|technical|software|other)$/i.test(t));
  return [...new Set(tokens)].slice(0, 60);
}

function extractLanguages(sections, text) {
  const body = sections.languages || '';
  const source = body || '';
  if (!source) return [];
  return source
    .split(/[\n,;|•·]/)
    .map((l) => l.replace(BULLET_RE, '').trim())
    .filter((l) => l.length > 2 && l.length < 60)
    .filter((l) => !/\d|@|period|salary|authorisation|authorization|expected|http/i.test(l))
    .filter((l) => /^[\p{L}][\p{L}\s()\-–—',]+$/u.test(l))
    .slice(0, 8)
    .map((raw) => {
      const [name, level] = raw.split(/[-–—(:]| - /).map((p) => p?.trim());
      return { name: name || raw, level: level?.replace(/\)$/, '') || null };
    })
    .filter((l) => l.name);
}

function extractIndustries(text) {
  const t = normaliseText(text);
  const found = new Map();
  for (const [keyword, label] of INDUSTRY_KEYWORDS) {
    if (t.includes(keyword)) found.set(label, (found.get(label) || 0) + 1);
  }
  return [...found.keys()].slice(0, 8);
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function matchFirst(text, re) {
  const m = re.exec(text || '');
  return m ? (m[1] ?? m[0]).trim() : null;
}

function matchAllLines(text, patterns) {
  return (text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && patterns.some((p) => p.test(l)));
}

function guessNameFromEmail(email) {
  if (!email) return null;
  const local = email.split('@')[0].replace(/\d+/g, '');
  const parts = local.split(/[._-]/).filter((p) => p.length > 1);
  if (parts.length < 2) return null;
  return parts.map(titleCase).join(' ');
}

function titleCase(value = '') {
  return String(value).replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function guessCurrency(value = '') {
  if (/R\s?\d|zar|rand/i.test(value)) return 'ZAR';
  if (/\$|usd/i.test(value)) return 'USD';
  if (/£|gbp/i.test(value)) return 'GBP';
  if (/€|eur/i.test(value)) return 'EUR';
  return null;
}

function uniqueBy(list, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function confidenceScore(profile) {
  const checks = [
    [!!profile.fullName, 10], [!!profile.email, 10], [!!profile.phone, 5],
    [!!profile.summary, 10], [profile.experience.length > 0, 20], [profile.education.length > 0, 10],
    [profile.skills.length >= 5, 20], [profile.jobTitles.length > 0, 10], [!!profile.yearsExperience, 5],
  ];
  const score = checks.reduce((acc, [ok, weight]) => acc + (ok ? weight : 0), 0);
  return Math.min(100, score);
}

/**
 * The set of facts the generator is allowed to use. Anything outside this index
 * must not appear in a generated application.
 */
export function buildTruthIndex(profile, rawText) {
  const skillIds = profile.skills.map((s) => (typeof s === 'string' ? s : s.id));
  return {
    name: profile.fullName,
    emails: [profile.email].filter(Boolean),
    phone: profile.phone,
    location: profile.location,
    linkedin: profile.linkedinUrl,
    portfolio: profile.portfolioUrl,
    github: profile.githubUrl,
    companies: (profile.experience || []).map((e) => e.company).filter(Boolean),
    titles: uniqueBy([...profile.jobTitles, ...profile.experience.map((e) => e.title).filter(Boolean)], (t) => String(t).toLowerCase()),
    skillIds,
    skillLabels: profile.skills.map((s) => (typeof s === 'string' ? s : s.label)),
    declaredSkills: profile.declaredSkills,
    tools: profile.tools,
    education: (profile.education || []).map((e) => e.qualification),
    institutions: profile.education.map((e) => e.institution).filter(Boolean),
    certifications: (profile.certifications || []).map((c) => c.name),
    languages: (profile.languages || []).map((l) => l.name),
    industries: profile.industries,
    yearsExperience: profile.yearsExperience,
    seniority: profile.seniority,
    achievements: (profile.achievements || []).map((a) => (typeof a === 'string' ? a : a.text)),
    projects: (profile.projects || []).map((p) => p.name),
    salaryExpectation: profile.salaryExpectation,
    noticePeriod: profile.noticePeriod,
    workAuthorization: profile.workAuthorization,
    rawText,
  };
}

export { SKILL_BY_ID };
