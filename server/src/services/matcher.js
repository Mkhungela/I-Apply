/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
/**
 * AI job matching.
 *
 * Produces a 0-100 match score with an auditable breakdown, the strong matches
 * that justify the score, the genuine gaps, and a policy decision
 * (auto_apply / review / skip) that respects the user's thresholds.
 *
 * Engine is deterministic and explainable. If an LLM provider is configured it is
 * used only to *enrich* the narrative fields (see services/llm.js), never to
 * override the arithmetic.
 */
import { extractSkills, resolveRole, SKILL_BY_ID, detectSeniority, SENIORITY_LEVELS, normaliseText } from './skillTaxonomy.js';
import { assessJobRisk } from './scamDetector.js';

export const WEIGHTS = {
  skills: 0.3,
  experience: 0.2,
  roleFit: 0.18,
  titleAlignment: 0.08,
  location: 0.08,
  industry: 0.05,
  education: 0.05,
  employmentType: 0.03,
  recency: 0.03,
};

const QUALIFIERS = [
  'advanced', 'expert', 'deep', 'extensive', 'enterprise', 'large-scale', 'complex',
  'at scale', 'highly experienced', 'proven track record', 'mastery',
];

/**
 * @param {object} params
 * @param {object} params.profile      structured profile (see profileBuilder)
 * @param {object} params.truthIndex   facts the candidate can legitimately claim
 * @param {object} params.job          normalised job record
 * @param {object} params.settings     user settings (thresholds, preferences)
 * @returns {object} match result
 */
export function scoreJob({ profile, truthIndex, job, settings = {} }) {
  const role = resolveRole(job.title) || resolveRole((settings.roles || [])[0] || '');
  const profileSkillIds = new Set(
    (truthIndex?.skillIds || profile?.skills?.map((s) => s.id) || []).map(String)
  );
  const jobSkills = collectJobSkills(job, role);
  const jobText = `${job.title || ''}\n${job.description || ''}\n${JSON.stringify(job.requirements || {})}`;

  const skillResult = scoreSkills({ jobSkills, profileSkillIds, jobText });
  const experience = scoreExperience(profile, truthIndex, job);
  const roleFit = scoreRoleFit(job, settings, role);
  const titleAlignment = scoreTitleAlignment(job, truthIndex, profile);
  const location = scoreLocation(job, settings, profile);
  const industry = scoreIndustry(jobText, truthIndex, profile);
  const education = scoreEducation(job, jobText, profile, truthIndex);
  const employmentType = scoreEmploymentType(job, settings);
  const recency = scoreRecency(job);

  const components = {
    skills: skillResult.score,
    experience: experience.score,
    roleFit: roleFit.score,
    titleAlignment: titleAlignment.score,
    location: location.score,
    industry: industry.score,
    education: education.score,
    employmentType: employmentType.score,
    recency: recency.score,
  };

  let raw = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) raw += (components[key] ?? 0) * weight;
  let score = Math.round(clamp(raw * 100, 0, 100));

  const caps = [];
  const ruleNotes = [];
  if (experience.seniorityGap >= 2) {
    const cap = Math.max(30, Math.min(64, score - 25));
    caps.push({ reason: `Role is ${experience.levelsAbove} level(s) above the CV's demonstrated seniority`, cap });
    score = Math.min(score, cap);
    ruleNotes.push('Seniority overshoot — capped to avoid wasting an application.');
  } else if (experience.seniorityGap === 1) {
    const cap = Math.min(84, score - 10);
    caps.push({ reason: 'Slightly more senior than the CV timeline supports', cap });
    score = Math.min(score, cap);
  }
  if (experience.levelsBelow >= 2) {
    const cap = Math.min(78, score);
    caps.push({ reason: `Advert is ${experience.levelsBelow} levels below the CV's demonstrated seniority`, cap });
    ruleNotes.push('Advert sits well below your seniority — applying is possible but likely a step down.');
    score = Math.min(score, cap);
  }
  if (roleFit.score < 0.5) {
    const cap = Math.min(79, score - 5);
    caps.push({ reason: 'Advert is outside your selected target roles', cap });
    score = Math.min(score, cap);
    ruleNotes.push('Not one of your target roles — kept below the auto-apply band.');
  }
  if (experience.yearsShortfall >= 4) {
    const cap = Math.max(35, Math.min(70, score - 15));
    caps.push({ reason: `Job asks for ${experience.required}+ years; CV evidences ${experience.evidenced ?? 'fewer'}`, cap });
    score = Math.min(score, cap);
    ruleNotes.push('Experience requirement materially exceeds the CV.');
  }
  score = clamp(score, 0, 100);

  const risk = assessJobRisk({
    title: job.title,
    company: job.company,
    description: job.description,
    url: job.url || job.applyUrl,
    applyEmail: job.apply?.email || job.applyEmail,
    requirements: job.requirements,
    sourceKey: job.sourceKey,
  });

  // ---- policy decision -----------------------------------------------------
  const { decision, decisionReason } = decidePolicy({ score, risk, settings });

  const priority = computePriority({ score, job, settings, location, recency, experience });

  const missing = skillResult.missing.map((id) => SKILL_BY_ID.get(id)?.label || id);
  const strong = skillResult.matched.map((id) => SKILL_BY_ID.get(id)?.label || id);

  return {
    score,
    breakdown: {
      components,
      weights: WEIGHTS,
      contribution: Object.fromEntries(Object.entries(WEIGHTS).map(([k, w]) => [k, Math.round((components[k] ?? 0) * w * 100)])),
      caps,
      notes: [
        ...ruleNotes,
        ...skillResult.notes,
        ...experience.notes,
        ...roleFit.notes,
        ...location.notes,
        ...education.notes,
      ],
      detail: {
        skills: skillResult.detail,
        experience: experience.detail,
        roleFit: roleFit.detail,
        location: location.detail,
        seniority: {
          jobLevel: experience.jobLevel?.label ?? null,
          candidateLevel: experience.candidateLevel?.label ?? null,
          requiredYears: experience.required ?? null,
          evidencedYears: experience.evidenced,
        },
      },
    },
    strongMatches: strong.slice(0, 8),
    gaps: gapLabels(skillResult.missing, jobText).slice(0, 8),
    riskFlags: risk.flags,
    risk,
    priority,
    decision,
    decisionReason,
    engine: 'deterministic-v1',
    detectedRole: role?.id || null,
    evaluatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * Component scorers — each returns { score 0..1, notes, detail }
 * ------------------------------------------------------------------ */

/** Required/preferred skills for the job, weighted by how the advert frames them. */
export function collectJobSkills(job, role) {
  const text = `${job.title || ''}\n${job.description || ''}\n${JSON.stringify(job.requirements || {})}`;
  const fromText = extractSkills(text, { limit: 80 });
  const weight = new Map();

  for (const s of fromText) {
    const isRoleCore = role?.core?.includes(s.id);
    const isRoleSupporting = role?.supporting?.includes(s.id);
    weight.set(s.id, (weight.get(s.id) || 0) + 1 + (isRoleCore ? 2 : isRoleSupporting ? 1 : 0));
  }

  // Explicit requirement lists from structured connectors (Greenhouse/Lever/Workable).
  const req = job.requirements || {};
  for (const raw of [...(req.skills || []), ...(req.technologies || []), ...(req.tools || [])]) {
    const cleaned = String(raw).split(':').pop();
    const found = extractSkills(cleaned, { limit: 3 });
    for (const s of found) weight.set(s.id, (weight.get(s.id) || 0) + 3);
    if (!found.length && cleaned.trim().length > 1) {
      const key = normaliseText(cleaned);
      if (key) weight.set(`raw:${key}`, (weight.get(`raw:${key}`) || 0) + 2);
    }
  }

  // Adverts often list "Requirements: A, B, C" — capture those tokens even if unaliased.
  const requirementBlock = /(?:requirements?|must[- ]have|essential|you(?:'| wi)ll need|what you(?:'|'ll) bring)\s*[:\-]?\s*([\s\S]{0,400})/i.exec(job.description || '');
  if (requirementBlock) {
    const tokens = requirementBlock[1]
      .split(/[\n•·▪;,]|\s{3,}/)
      .map((t) => t.replace(/^[-–—*]\s*/, '').trim())
      .filter((t) => t.length > 2 && t.length < 60)
      .slice(0, 12);
    for (const token of tokens) {
      const found = extractSkills(token, { limit: 2 });
      if (found.length) for (const s of found) weight.set(s.id, (weight.get(s.id) || 0) + 2);
    }
  }
  return [...weight.entries()]
    .map(([id, weightValue]) => ({ id, weight: weightValue }))
    .sort((a, b) => b.weight - a.weight);
}

function scoreSkills({ jobSkills, profileSkillIds, jobText }) {
  if (!jobSkills.length) {
    return { score: 0.5, matched: [], missing: [], notes: ['No explicit skill requirements detected in the advert.'], detail: {} };
  }
  const matched = [];
  const missing = [];
  let totalWeight = 0;
  let earned = 0;

  for (const { id, weight } of jobSkills) {
    const isCanonical = SKILL_BY_ID.has(id);
    const has = isCanonical ? profileSkillIds.has(id) : roughTokenPresent(id, jobText) && false;
    totalWeight += weight;
    if (has) {
      earned += weight;
      matched.push(id);
    } else if (isCanonical) {
      missing.push(id);
    } else {
      totalWeight -= weight; // unknown raw tokens can't be scored fairly
    }
  }

  if (totalWeight === 0) {
    return { score: 0.5, matched, missing, notes: ['Skill requirements could not be normalised — treated as neutral.'], detail: {} };
  }
  // Non-linear: covering the core requirements matters more than raw coverage.
  const coverage = earned / totalWeight;
  // Slightly punishing curve: partial coverage should not flatter the score.
  let score = clamp(Math.pow(coverage, 1.02), 0, 1);
  if (coverage < 0.65) score *= 0.92;
  if (coverage < 0.4) score *= 0.9;
  const notes = [];
  if (coverage < 0.5) notes.push(`Only ${Math.round(coverage * 100)}% of the advert's weighted requirements appear in the CV.`);
  return {
    score,
    matched,
    missing,
    notes,
    detail: { coverage: Math.round(coverage * 100), matchedCount: matched.length, missingCount: missing.length, topRequirements: jobSkills.slice(0, 10).map((s) => SKILL_BY_ID.get(s.id)?.label || s.id) },
  };
}

/** Raw (unaliased) requirement tokens can never be *proven* against the CV; ignored. */
function roughTokenPresent() {
  return false;
}

function scoreExperience(profile, truthIndex, job) {
  const text = `${job.title || ''}\n${job.description || ''}\n${JSON.stringify(job.requirements || {})}`;
  const required = detectRequiredYears(text, job.requirements);
  const evidenced = truthIndex?.yearsExperience ?? profile?.yearsExperience ?? null;
  const jobLevel = detectSeniority(job.title) || detectSeniority(text.slice(0, 400));
  const candidateLevel = SENIORITY_LEVELS.find((l) => l.id === (profile?.seniority || 'unknown')) || null;
  const levelsAbove = jobLevel && candidateLevel ? Math.max(0, jobLevel.rank - candidateLevel.rank) : 0;
  const notes = [];

  const levelsBelow = jobLevel && candidateLevel ? Math.max(0, candidateLevel.rank - jobLevel.rank) : 0;
  let score = 0.7;
  let yearsShortfall = 0;
  if (required !== null && evidenced !== null) {
    if (evidenced >= required) {
      score = clamp(0.85 + Math.min(0.15, (evidenced - required) * 0.02), 0, 1);
    } else {
      yearsShortfall = required - evidenced;
      score = clamp(0.85 - yearsShortfall * 0.16, 0.1, 1);
      notes.push(`Advert asks for ${required}+ years; the CV evidences about ${evidenced}.`);
    }
  } else if (required !== null && evidenced === null) {
    score = 0.55;
    notes.push(`Advert asks for ${required}+ years; the CV does not state a total, so this is unverified.`);
  } else if (evidenced !== null) {
    score = 0.8;
  }

  // Seniority fit adjustment
  if (levelsAbove >= 2) score = Math.min(score, 0.35);
  else if (levelsAbove === 1) score = Math.min(score, 0.68);
  else if (jobLevel && candidateLevel && jobLevel.rank < candidateLevel.rank - 2) {
    // Job is much more junior than the candidate: fine to apply, slight preference penalty.
    score = Math.min(score, 0.75);
  }

  return {
    score,
    notes,
    yearsShortfall,
    required,
    evidenced,
    seniorityGap: levelsAbove,
    levelsAbove,
    levelsBelow,
    jobLevel,
    candidateLevel,
    detail: { requiredYears: required, evidencedYears: evidenced, levelsAbove },
  };
}

export function detectRequiredYears(text = '', requirements = {}) {
  if (Number.isFinite(requirements?.minYears)) return requirements.minYears;
  const patterns = [
    /(\d{1,2})\s*\+\s*(?:years|yrs)\b/i,
    /(?:minimum|min\.?|at least)\s*(?:of\s*)?(\d{1,2})\s*(?:\+\s*)?(?:years|yrs)\b/i,
    /(\d{1,2})\s*(?:-|–|to)\s*\d{1,2}\s*(?:years|yrs)\b/i,
    /(\d{1,2})\s*(?:years|yrs)(?:'|’)?\s*(?:of\s*)?(?:experience|industry\s*experience)/i,
    /(?:experience|track record)\s*(?:of\s*)?(\d{1,2})\s*\+?\s*(?:years|yrs)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const value = Number(m[1]);
      if (value > 0 && value < 40) return value;
    }
  }
  return null;
}

function scoreRoleFit(job, settings, role) {
  const wanted = (settings.roles || []).map((r) => resolveRole(r) || { id: String(r).toLowerCase() }).filter(Boolean);
  const title = normaliseText(job.title || '');
  if (!wanted.length) return { score: 0.6, notes: [], detail: {} };

  let best = { score: 0.2, label: null };
  for (const want of wanted) {
    let s = 0.2;
    if (role && role.id === want.id) s = 1;
    else if (title.includes(normaliseText(want.label || ''))) s = 0.92;
    else if (role && want.group === role.group) s = 0.62;
    else if (role && shareCore(role, want)) s = 0.55;
    if (s > best.score) best = { score: s, label: want.label };
  }
  const notes = [];
  if (best.score < 0.5) notes.push(`Advert reads as “${role?.label || 'a different discipline'}”, outside the selected target roles.`);
  return { score: best.score, notes, detail: { matchedRole: best.label, detectedRole: role?.id || null } };
}

function shareCore(a, b) {
  if (!a?.core || !b?.core) return false;
  const shared = a.core.filter((c) => b.core.includes(c)).length;
  return shared >= 2;
}

function scoreTitleAlignment(job, truthIndex, profile) {
  const jobTitle = normaliseText(job.title || '');
  const titles = [...(truthIndex?.titles || []), ...(profile?.jobTitles || [])].map(normaliseText);
  if (!jobTitle || !titles.length) return { score: 0.4, notes: [], detail: {} };
  let best = 0;
  for (const t of titles) {
    const jobTokens = new Set(jobTitle.split(' ').filter((w) => w.length > 2));
    const titleTokens = new Set(t.split(' ').filter((w) => w.length > 2));
    if (!jobTokens.size || !titleTokens.size) continue;
    let overlap = 0;
    for (const token of jobTokens) if (titleTokens.has(token)) overlap += 1;
    best = Math.max(best, overlap / Math.max(jobTokens.size, titleTokens.size));
  }
  return {
    score: clamp(0.45 + best * 0.75, 0, 1),
    notes: [],
    detail: { overlap: Math.round(best * 100) },
  };
}

function scoreLocation(job, settings, profile) {
  const notes = [];
  const mode = job.workMode || inferWorkMode(job);
  const wantedLocations = (settings.locations || []).map(normaliseText);
  const jobLoc = normaliseText(`${job.location || ''} ${job.country || ''}`);
  const candidateCountry = normaliseText(profile?.country || '');
  const jobCountry = normaliseText(job.country || extractCountry(job.location) || '');
  const allowsRemote = (settings.workModes || []).includes('remote');
  const wantsRemoteFirst = (settings.workModes || [])[0] === 'remote' || settings.preferRemote;

  if (mode === 'remote') {
    if (!allowsRemote) {
      notes.push('The advert is remote but remote roles are not in the current work-mode preferences.');
      return { score: 0.25, notes, detail: { mode } };
    }
    if (job.remoteRestriction && candidateCountry && !sameCountry(job.remoteRestriction, candidateCountry)) {
      notes.push(`Remote role appears restricted to ${job.remoteRestriction}.`);
      return { score: 0.35, notes, detail: { mode, restriction: job.remoteRestriction } };
    }
    return { score: wantsRemoteFirst ? 1 : 0.92, notes, detail: { mode } };
  }

  if (!wantedLocations.length) return { score: 0.6, notes, detail: { mode } };

  const matchesWanted = wantedLocations.some((l) => l && (jobLoc.includes(l) || l.includes(jobLoc)) || (jobCountry && l.includes(jobCountry)));
  if (matchesWanted) return { score: 0.95, notes, detail: { mode } };
  if (jobCountry && candidateCountry && jobCountry === candidateCountry) {
    if (mode === 'onsite' && !(settings.workModes || []).includes('onsite')) {
      notes.push('On-site role, but on-site work is not selected.');
      return { score: 0.4, notes, detail: { mode } };
    }
    return { score: 0.75, notes, detail: { mode } };
  }
  if (workAuthorizationCovered(profile, jobCountry)) return { score: 0.6, notes, detail: { mode } };
  notes.push(`Located in ${job.location || jobCountry || 'another country'}, outside the selected locations; work authorisation not evidenced on the CV.`);
  return { score: 0.2, notes, detail: { mode } };
}

function inferWorkMode(job) {
  const t = normaliseText(`${job.title} ${job.location} ${job.description?.slice(0, 600)}`);
  if (/\bremote\b|\bwork from home\b|\bfully remote\b|\banywhere\b|\bdistributed team\b/.test(t)) return 'remote';
  if (/\bhybrid\b|\bpartially remote\b|\d\s*days?\s*(?:a week\s*)?in (?:the )?office/.test(t)) return 'hybrid';
  if (/\bon-?site\b|\bin-?office\b|\boffice-based\b/.test(t)) return 'onsite';
  return 'unknown';
}

function extractCountry(location = '') {
  const t = normaliseText(location);
  const country = ['south africa', 'united kingdom', 'england', 'ireland', 'netherlands', 'germany', 'united states', 'usa', 'canada', 'australia', 'new zealand', 'united arab emirates', 'kenya', 'nigeria', 'india', 'singapore', 'portugal', 'spain', 'france', 'poland', 'brazil', 'mexico', 'ghana', 'rwanda'];
  return country.find((c) => t.includes(c)) || null;
}

function workAuthorizationCovered(profile, jobCountry) {
  const auth = normaliseText(profile?.workAuthorization || '');
  if (!auth || !jobCountry) return false;
  return auth.includes(jobCountry) || /\b(any|all|global|worldwide)\b/.test(auth);
}

function sameCountry(a, b) {
  const na = normaliseText(a);
  const nb = normaliseText(b);
  return na.includes(nb) || nb.includes(na) || (na.length > 3 && nb.length > 3 && na.slice(0, 4) === nb.slice(0, 4));
}

function scoreIndustry(jobText, truthIndex, profile) {
  const industries = truthIndex?.industries || profile?.industries || [];
  if (!industries.length) return { score: 0.6, notes: [], detail: {} };
  const t = normaliseText(jobText);
  const hits = industries.filter((i) => t.includes(normaliseText(i)));
  return {
    score: hits.length ? 0.95 : 0.55,
    notes: [],
    detail: { matched: hits },
  };
}

function scoreEducation(job, jobText, profile, truthIndex) {
  const t = normaliseText(jobText);
  const requiresDegree = /\b(bachelor|bsc|degree|b\.?com|honours|masters?|msc|mba|tertiary qualification|relevant qualification)\b/.test(t);
  const education = truthIndex?.education || profile?.education?.map((e) => e.qualification) || [];
  const certifications = truthIndex?.certifications || profile?.certifications?.map((c) => c.name) || [];
  if (!requiresDegree) return { score: 0.9, notes: [], detail: { required: false } };
  if (education.length) return { score: 1, notes: [], detail: { required: true, met: true } };
  if (certifications.length) {
    return { score: 0.7, notes: ['Advert mentions a qualification; the CV shows certifications but no degree line.'], detail: { required: true, met: 'partial' } };
  }
  return { score: 0.45, notes: ['Advert asks for a qualification that is not stated on the CV.'], detail: { required: true, met: false } };
}

function scoreEmploymentType(job, settings) {
  const accepted = settings.employmentTypes || [];
  const type = job.employmentType || detectJobEmploymentType(job.description || '');
  if (!type) return { score: 0.75, notes: [], detail: {} };
  const normalised = type === 'contract' ? 'contract' : type;
  const ok = accepted.includes(normalised) || (normalised === 'freelance' && accepted.includes('contract'));
  return { score: ok ? 1 : 0.3, notes: ok ? [] : [`Employment type “${type}” is outside the selected preferences.`], detail: { type } };
}

function detectJobEmploymentType(text) {
  const t = normaliseText(text);
  if (/\bfreelance\b/.test(t)) return 'freelance';
  if (/\bpart[- ]time\b/.test(t)) return 'part-time';
  if (/\b(contract|contractor|fixed[- ]term|12[- ]month)\b/.test(t)) return 'contract';
  if (/\binternship\b|\bgraduate programme\b/.test(t)) return 'internship';
  if (/\bfull[- ]time\b|\bpermanent\b/.test(t)) return 'full-time';
  return null;
}

function scoreRecency(job) {
  const posted = job.postedAt ? new Date(job.postedAt) : null;
  if (!posted || Number.isNaN(posted.getTime())) return { score: 0.5, notes: [], detail: { ageDays: null } };
  const ageDays = Math.floor((Date.now() - posted.getTime()) / 86_400_000);
  let score;
  if (ageDays <= 3) score = 1;
  else if (ageDays <= 7) score = 0.85;
  else if (ageDays <= 14) score = 0.65;
  else if (ageDays <= 30) score = 0.45;
  else score = 0.2;
  return { score, notes: [], detail: { ageDays } };
}

/** Gaps: prefer specific requirement wording, with qualifiers when the advert uses them. */
function gapLabels(missing, jobText) {
  const text = String(jobText);
  return missing.map((id) => {
    const label = SKILL_BY_ID.get(id)?.label || id;
    if (!label) return null;
    const re = new RegExp(`([a-z]+\\s+)?${escapeRegex(label.split(' ')[0])}`, 'i');
    const window = re.exec(text);
    if (window) {
      const snippet = text.slice(Math.max(0, window.index - 30), Math.min(text.length, window.index + label.length + 30));
      const qualifier = QUALIFIERS.find((q) => snippet.toLowerCase().includes(q));
      if (qualifier) return `${titleCase(qualifier)} ${label}`;
    }
    return label;
  }).filter(Boolean);
}

function computePriority({ score, job, settings, location, recency, experience }) {
  const parts = [
    [score / 100, 0.45],
    [recency.score, 0.15],
    [location.score, 0.12],
    [experience.score, 0.1],
  ];
  if (settings.prioritizeLowApplicants && Number.isFinite(job.applicantsCount)) {
    const n = job.applicantsCount;
    parts.push([n <= 10 ? 1 : n <= 25 ? 0.8 : n <= 50 ? 0.6 : n <= 100 ? 0.4 : 0.2, 0.1]);
  } else {
    parts.push([0.6, 0.1]);
  }
  // Application complexity: direct applies and known ATS are easier to complete truthfully.
  const complexity = job.apply?.mode === 'api_apply' || job.apply?.mode === 'api_ats' ? 1 : job.apply?.mode === 'email' ? 0.85 : 0.6;
  parts.push([complexity, 0.08]);
  const total = parts.reduce((acc, [v, w]) => acc + v * w, 0) / parts.reduce((acc, [, w]) => acc + w, 0);
  return Math.round(clamp(total, 0, 1) * 1000) / 10;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function escapeRegex(s = '') {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleCase(s = '') {
  return String(s).replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * The application policy: decide what to do with a scored job.
 *
 * Exported so the scheduler can re-evaluate stored matches against the *current*
 * settings — a match scored last week under different thresholds must not be
 * applied to under last week's rules.
 *
 * @returns {{ decision: 'auto_apply'|'review'|'skip', decisionReason: string }}
 */
export function decidePolicy({ score, risk = {}, settings = {} }) {
  const autoApplyThreshold = num(settings.autoApplyThreshold, 80);
  const reviewThreshold = num(settings.reviewThreshold, num(settings.minMatchScore, 70));
  const autoApplyEnabled = !!settings.autoApplyEnabled;
  const requireConfirmation = !!settings.requireConfirmation;
  const riskLevel = risk.level || 'low';

  let decision = 'skip';
  let decisionReason = '';

  if (riskLevel === 'high') {
    decision = 'skip';
    decisionReason = `Blocked by safety screening: ${(risk.flags || []).map((f) => f.label).join('; ') || 'high-risk listing'}`;
  } else if (score < reviewThreshold) {
    decision = 'skip';
    decisionReason = `Match ${score}% is below the ${reviewThreshold}% minimum.`;
  } else if (score >= autoApplyThreshold && autoApplyEnabled && !requireConfirmation && riskLevel === 'low') {
    decision = 'auto_apply';
    decisionReason = `Match ${score}% ≥ ${autoApplyThreshold}% auto-apply threshold, low risk, automatic mode on.`;
  } else if (score >= autoApplyThreshold && (requireConfirmation || !autoApplyEnabled)) {
    decision = 'review';
    decisionReason = autoApplyEnabled
      ? `Match ${score}% qualifies, but confirmation is required before submitting.`
      : `Match ${score}% qualifies, but automatic application mode is off.`;
  } else {
    decision = 'review';
    decisionReason = `Match ${score}% is in the ${reviewThreshold}–${autoApplyThreshold - 1}% review band.`;
  }
  if (riskLevel === 'medium' && decision === 'auto_apply') {
    decision = 'review';
    decisionReason += ' Risk signals require a human look.';
  }
  return { decision, decisionReason };
}
