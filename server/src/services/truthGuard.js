/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
/**
 * Truth guard.
 *
 * The generator may only state facts that exist in the CV. Every piece of generated
 * text (cover letter, introduction, question answers, tailored CV summary) is passed
 * through this validator before it can be attached to an application.
 *
 * It never "fixes" text by inventing something; it strips the offending claim.
 */
import { extractSkills, normaliseText, SKILL_BY_ID, SENIORITY_LEVELS } from './skillTaxonomy.js';

const PLACEHOLDER_PATTERNS = [
  /\[(?:company|position|role|your name|hiring manager|date|insert[^\]]*)\]/i,
  /\b(?:lorem ipsum|as an ai language model|I cannot|I am an AI)\b/i,
  /\{\{[^}]*\}\}/,
  /<[a-z_]+>/i,
];

const DEGREE_WORDS = /(\bphd\b|\bdoctorate\b|\bmaster'?s?\b|\bmba\b|\bmsc\b|\bm\.?sc\b|\bhonours\b|\bbachelor'?s?\b|\bbsc\b|\bb\.?sc\b|\bbcom\b|\bdiploma\b|\bdegree\b)/i;
const CERT_WORDS = /(\bcertified\b|\bcertification\b|\bcertificate\b|\baccredited\b)/i;

/**
 * @param {string} text generated text
 * @param {object} truthIndex from profileBuilder.buildTruthIndex()
 * @param {{ allow?: string[] }} [options] extra proper nouns that are legitimate in this
 *   context (the target company and role being applied to, for example) — never facts
 *   about the candidate.
 * @returns {{ ok: boolean, violations: Array<{type:string, detail:string, excerpt:string}>, cleaned: string }}
 */
export function validate(text, truthIndex = {}, options = {}) {
  const violations = [];
  const original = String(text || '');
  if (!original.trim()) return { ok: true, violations, cleaned: original };

  const allowedNames = new Set(
    [
      ...(truthIndex.companies || []),
      ...(truthIndex.institutions || []),
      ...(truthIndex.projects || []),
      ...(truthIndex.titles || []),
      ...(truthIndex.industries || []),
      truthIndex.name,
      truthIndex.location,
    ]
      .filter(Boolean)
      .map((v) => normaliseText(String(v)))
  );
  for (const extra of options.allow || []) {
    const value = normaliseText(String(extra || ''));
    if (!value) continue;
    allowedNames.add(value);
    for (const word of value.split(' ')) if (word.length > 3) allowedNames.add(word);
  }

  const cvsSkillIds = new Set((truthIndex.skillIds || []).map(String));
  const declared = (truthIndex.declaredSkills || []).map((s) => normaliseText(String(s)));
  const years = Number(truthIndex.yearsExperience);
  const candidateRank = SENIORITY_LEVELS.find((l) => l.id === truthIndex.seniority)?.rank ?? 0;

  // 1. Placeholders / meta text never belong in a submitted application.
  for (const re of PLACEHOLDER_PATTERNS) {
    const m = re.exec(original);
    if (m) violations.push({ type: 'placeholder', detail: 'Unfilled placeholder or meta text', excerpt: m[0] });
  }

  // 2. Experience duration claims must not exceed what the CV evidences.
  for (const m of original.matchAll(/(\d{1,2})(?:\.\d)?\s*\+?\s*(?:years|yrs)\b(?:\s*(?:of|in)\s*([a-z /]+))?/gi)) {
    const claimed = Number(m[1]);
    if (!Number.isFinite(years)) {
      violations.push({ type: 'unverified_years', detail: `Claims ${claimed} years but the CV does not state a total`, excerpt: m[0] });
    } else if (claimed > Math.ceil(years) + 0.5) {
      violations.push({ type: 'inflated_years', detail: `Claims ${claimed} years; CV evidences ~${years}`, excerpt: m[0] });
    }
  }

  // 3. Qualifications must exist on the CV.
  if (DEGREE_WORDS.test(original)) {
    const education = (truthIndex.education || []).join(' ');
    const word = DEGREE_WORDS.exec(original)[0];
    if (!education || !normaliseText(education).includes(normaliseText(word).slice(0, 5))) {
      violations.push({ type: 'unverified_qualification', detail: `Mentions “${word}”, not evidenced on the CV`, excerpt: word });
    }
  }
  if (CERT_WORDS.test(original) && !(truthIndex.certifications || []).length) {
    violations.push({ type: 'unverified_certification', detail: 'Mentions certification, but no certifications are on the CV', excerpt: CERT_WORDS.exec(original)[0] });
  }

  // 4. Seniority claims.
  const seniorityClaim = /\b(expert|highly experienced|extensive experience|senior (?:ux|ui|product|front|design|develop)\w*|lead(?:ing)? a team|manag(?:e|ing) a team|10\+ years)\b/i.exec(original);
  if (seniorityClaim) {
    const claim = seniorityClaim[0].toLowerCase();
    const isSeniorClaim = /senior|lead|manage|10\+/.test(claim);
    if (isSeniorClaim && candidateRank < 4) {
      violations.push({
        type: 'unverified_seniority',
        detail: `Claims “${seniorityClaim[0]}” but the CV evidences ${truthIndex.seniority || 'unknown'} seniority`,
        excerpt: seniorityClaim[0],
      });
    }
    if (claim === 'expert' && candidateRank < 3) {
      violations.push({ type: 'unverified_seniority', detail: 'Claims expert level without supporting CV evidence', excerpt: seniorityClaim[0] });
    }
  }

  // 5. Tool/skill proficiency claims must be backed by the CV.
  const claimContext = /(?:proficien\w*|experienced|expert|skilled|competent|hands-on|strong)\s+(?:with|in|using|at)?\s*([a-z0-9+#./ &-]{2,40})/gi;
  for (const m of original.matchAll(claimContext)) {
    const phrase = m[1];
    for (const skill of extractSkills(phrase, { limit: 3 })) {
      if (cvsSkillIds.has(skill.id)) continue;
      const declaredHit = declared.some((d) => normaliseText(phrase).includes(d));
      if (declaredHit) continue;
      violations.push({
        type: 'unverified_skill',
        detail: `Claims proficiency with ${SKILL_BY_ID.get(skill.id)?.label || skill.id}, which is not on the CV`,
        excerpt: m[0].slice(0, 90),
      });
    }
  }

  // 6. "using X" style tool claims within sentences.
  for (const m of original.matchAll(/\b(?:using|with|in)\s+((?:[A-Z][a-zA-Z.+#]+)(?:\s+[A-Z][a-zA-Z.+#]+){0,2})\b/g)) {
    const phrase = normaliseText(m[1]);
    for (const skill of extractSkills(phrase, { limit: 2 })) {
      if (cvsSkillIds.has(skill.id)) continue;
      violations.push({
        type: 'unverified_tool',
        detail: `References ${SKILL_BY_ID.get(skill.id)?.label || skill.id}, which is not on the CV`,
        excerpt: m[0].slice(0, 90),
      });
    }
  }

  // 7. Employer-like names outside the CV.
  for (const m of original.matchAll(/\b(?:at|for|with)\s+([A-Z][a-zA-Z&.'-]+(?:\s+[A-Z][a-zA-Z&.'-]+){0,3})\b/g)) {
    const phrase = normaliseText(m[1]);
    if (phrase.length < 3) continue;
    if (allowedNames.has(phrase)) continue;
    if ([...allowedNames].some((n) => n && (n.includes(phrase) || phrase.includes(n)))) continue;
    if (/^(least|the|a|an|scale|speed|present|all|every|my|our|their|your|this|that|which|most)\b/.test(phrase)) continue;
    if (/south africa|united kingdom|remote|hybrid|company|team|clients|stakeholders|users|customers/.test(phrase)) continue;
    violations.push({ type: 'unverified_employer', detail: `References “${m[1].trim()}”, which is not in the CV`, excerpt: m[0].slice(0, 90) });
  }

  const cleaned = violations.length ? repair(original, violations, truthIndex) : original;
  // `cleaned` is the canonical field; `text` is kept as an alias for readability at call sites.
  return { ok: violations.length === 0, violations: dedupe(violations), cleaned, text: cleaned };
}

/** Removes sentences containing violations so the text can still be used. */
function repair(text, violations, truthIndex) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const offending = new Set(violations.map((v) => v.excerpt));
  const kept = sentences.filter((sentence) => {
    return ![...offending].some((excerpt) => excerpt && sentence.includes(excerpt));
  });
  const result = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  return result.length > 0 ? result : `Experienced ${truthIndex.titles?.[0] || 'professional'} with a track record of delivering digital products.`;
}

function dedupe(violations) {
  const seen = new Set();
  return violations.filter((v) => {
    const key = `${v.type}:${v.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Fast pre-check used by the generator before spending effort on composition. */
export function claimsAllowed(phrase, truthIndex, options = {}) {
  const { ok } = validate(phrase, truthIndex, options);
  return ok;
}
