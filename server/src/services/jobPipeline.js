/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
/**
 * Application pipeline.
 *
 * ingest → score → policy decision → generate → apply where permitted → record.
 *
 * Guarantees encoded here:
 *  • Never apply twice to the same posting (unique job dedupe key, unique application per job).
 *  • Never apply twice to the same company + position unless the user enables reapplication.
 *  • Never apply to a high-risk (likely scam) listing.
 *  • Never exceed the user's daily / weekly / per-company caps.
 *  • Never claim a submission unless the platform or ATS confirmed it.
 *  • Pause for CAPTCHA / MFA / identity checks instead of attempting to bypass them.
 */
import { db } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { scoreJob, clamp } from './matcher.js';
import { assessJobRisk } from './scamDetector.js';
import { generateApplication, polishCoverLetter } from './applicationGenerator.js';
import { renderTailoredCv, renderCoverLetter, renderAnswerSheet } from './documentRenderer.js';
import { buildConnector, resolveApplyRoute } from '../connectors/index.js';
import { submitByEmail } from '../connectors/emailApply.js';
import { notify, NOTIFICATION_TYPES } from './notifications.js';
import { dedupeKey, companyKey, canonicalUrl } from './jobNormalizer.js';
import { stableHash } from '../lib/crypto.js';
import fs from 'node:fs';

const log = logger('pipeline');

export const APPLICATION_STATUS = {
  NEW: 'new',
  PREPARING: 'preparing',
  AWAITING_USER_ACTION: 'awaiting_user_action',
  SUBMITTED: 'submitted',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  BLOCKED: 'blocked',
  INTERVIEW: 'interview',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
  SKIPPED: 'skipped',
};

const HUMAN_STEP_PATTERNS = [
  { re: /captcha|recaptcha|hcaptcha|turnstile|i'?m not a robot/i, type: 'captcha', message: 'The application page asked for a CAPTCHA.' },
  { re: /\bmfa\b|two[- ]factor|2fa|authenticator|verification code|one[- ]time code/i, type: 'mfa', message: 'Two-factor / MFA verification was requested.' },
  { re: /identity verification|verify your identity|id verification|video interview verification|background check portal/i, type: 'identity', message: 'Identity verification was requested.' },
  { re: /log ?in|sign ?in|session expired|please authenticate/i, type: 'login', message: 'The platform requires you to sign in.' },
  { re: /blocked|unusual traffic|automated access|rate limit|too many requests/i, type: 'blocked', message: 'The platform signalled automated-access protection.' },
];

/* ------------------------------------------------------------------ *
 * 1. Ingestion + scoring
 * ------------------------------------------------------------------ */

export function ingestJobs(userId, rawJobs = [], { campaignId = null, isDemo = false } = {}) {
  const database = db();
  const inserted = [];
  let duplicates = 0;
  let skipped = 0;

  for (const raw of rawJobs) {
    const key = raw.dedupeKey || dedupeKey(raw);
    if (!key || key === 'ct:||') {
      skipped += 1;
      continue;
    }
    const existing = database.get('SELECT id FROM jobs WHERE user_id = ? AND dedupe_key = ?', userId, key);
    if (existing) {
      duplicates += 1;
      continue;
    }
    const risk = assessJobRisk({
      title: raw.title,
      company: raw.company,
      description: raw.description,
      url: raw.url || raw.applyUrl,
      applyEmail: raw.applyEmail,
      requirements: raw.requirements,
      sourceKey: raw.sourceKey,
    });
    const info = database.run(
      `INSERT INTO jobs (user_id, source_key, external_id, title, company, company_domain, location, work_mode, employment_type,
        salary_min, salary_max, salary_currency, salary_period, description, url, apply_url, apply_email, posted_at,
        applicants_count, requirements, tags, is_demo, content_hash, dedupe_key, risk)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      userId,
      raw.sourceKey || 'manual',
      raw.externalId || null,
      raw.title,
      raw.company || null,
      raw.companyDomain || null,
      raw.location || null,
      raw.workMode || null,
      raw.employmentType || null,
      raw.salaryMin ?? null,
      raw.salaryMax ?? null,
      raw.salaryCurrency || null,
      raw.salaryPeriod || null,
      raw.description || null,
      raw.url || null,
      raw.applyUrl || raw.url || null,
      raw.applyEmail || raw.apply?.email || null,
      raw.postedAt || null,
      Number.isFinite(raw.applicantsCount) ? raw.applicantsCount : null,
      JSON.stringify({ ...(raw.requirements || {}), ...(raw.apply ? { apply: raw.apply } : {}), ...(raw.remoteRestriction ? { remoteRestriction: raw.remoteRestriction } : {}) }),
      JSON.stringify(raw.tags || []),
      isDemo || raw.isDemo ? 1 : 0,
      stableHash(`${raw.title}|${raw.company}|${raw.description?.slice(0, 4000) || ''}`),
      key,
      JSON.stringify(risk)
    );
    inserted.push({
      id: Number(info.lastInsertRowid),
      isNew: true,
      job: { ...raw, id: Number(info.lastInsertRowid), dedupeKey: key, risk },
    });
  }
  return { inserted, duplicates, skipped };
}

export function scoreAndStore(userId, jobRow, { profile, truthIndex, settings, campaignId = null }) {
  const database = db();
  const job = hydrateJob(jobRow);
  const result = scoreJob({ profile, truthIndex, job, settings });

  const existing = database.get('SELECT id FROM matches WHERE user_id = ? AND job_id = ?', userId, jobRow.id);
  const payload = [
    userId,
    jobRow.id,
    campaignId,
    result.score,
    JSON.stringify(result.breakdown),
    JSON.stringify(result.strongMatches),
    JSON.stringify(result.gaps),
    JSON.stringify(result.riskFlags),
    result.priority,
    result.decision,
    result.decisionReason,
    result.engine,
  ];
  if (existing) {
    database.run(
      `UPDATE matches SET campaign_id = COALESCE(?, campaign_id), score = ?, breakdown = ?, strong_matches = ?, gaps = ?, risk_flags = ?,
       priority = ?, decision = ?, decision_reason = ?, engine = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      ...payload,
      existing.id
    );
  } else {
    database.run(
      `INSERT INTO matches (user_id, job_id, campaign_id, score, breakdown, strong_matches, gaps, risk_flags, priority, decision, decision_reason, engine)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ...payload
    );
  }
  return { ...result, job };
}

export function hydrateJob(row) {
  const requirements = safeJson(row.requirements, {});
  return {
    id: row.id,
    sourceKey: row.source_key,
    externalId: row.external_id,
    title: row.title,
    company: row.company,
    companyDomain: row.company_domain,
    location: row.location,
    workMode: row.work_mode,
    employmentType: row.employment_type,
    salaryMin: row.salary_min,
    salaryMax: row.salary_max,
    salaryCurrency: row.salary_currency,
    salaryPeriod: row.salary_period,
    description: row.description,
    url: row.url,
    applyUrl: row.apply_url,
    applyEmail: row.apply_email,
    postedAt: row.posted_at,
    discoveredAt: row.discovered_at,
    applicantsCount: row.applicants_count,
    requirements,
    tags: safeJson(row.tags, []),
    isDemo: !!row.is_demo,
    risk: safeJson(row.risk, {}),
    apply: requirements.apply || { mode: row.apply_email ? 'email' : 'assisted' },
    remoteRestriction: requirements.remoteRestriction || null,
  };
}

/* ------------------------------------------------------------------ *
 * 2. Limits + duplicate protection
 * ------------------------------------------------------------------ */

export function countApplications(userId, { since = null, until = null } = {}) {
  const clauses = ['user_id = ?', "status IN ('submitted','confirmed','interview')"];
  const params = [userId];
  if (since) {
    clauses.push('submitted_at >= ?');
    params.push(since);
  }
  if (until) {
    clauses.push('submitted_at < ?');
    params.push(until);
  }
  const row = db().get(`SELECT COUNT(*) AS c FROM applications WHERE ${clauses.join(' AND ')}`, ...params);
  return row?.c ?? 0;
}

export function applicationsToday(userId, date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
  return countApplications(userId, { since: start });
}

export function applicationsThisWeek(userId, date = new Date()) {
  const day = date.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - diffToMonday));
  return countApplications(userId, { since: monday.toISOString() });
}

export function applicationsForCompany(userId, company) {
  if (!company) return 0;
  const rows = db().all(
    `SELECT j.company FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE a.user_id = ? AND a.status IN ('submitted','confirmed','interview','awaiting_user_action')`,
    userId
  );
  const target = company.toLowerCase().trim();
  return rows.filter((r) => String(r.company || '').toLowerCase().trim() === target).length;
}

/**
 * Decides whether this job may be processed right now, and why not if not.
 * @returns {{allowed:boolean, reason?:string, code?:string}}
 */
export function checkEligibility({ userId, job, match, settings }) {
  const database = db();

  if (job.risk?.level === 'high') return { allowed: false, code: 'scam_risk', reason: `Safety screening rated this listing high risk: ${(job.risk.flags || []).map((f) => f.label).join('; ') || 'suspicious listing'}.` };

  const existing = database.get('SELECT id, status FROM applications WHERE user_id = ? AND job_id = ?', userId, job.id);
  if (existing && existing.status !== APPLICATION_STATUS.SKIPPED) {
    return { allowed: false, code: 'duplicate_job', reason: `An application for this posting already exists (status: ${existing.status}).`, applicationId: existing.id };
  }

  if (!settings.reapplicationAllowed) {
    const clash = findCompanyRoleClash({ userId, job });
    if (clash) {
      return {
        allowed: false,
        code: 'duplicate_company_role',
        applicationId: clash.id,
        reason: `You already have an application for ${job.company} — ${clash.title} (status: ${clash.status}). Reapplication is disabled in settings, so a second one will not be created.`,
      };
    }
  }

  const capPerCompany = Number(settings.maxPerCompany ?? 2);
  if (capPerCompany > 0 && applicationsForCompany(userId, job.company) >= capPerCompany) {
    return { allowed: false, code: 'company_cap', reason: `Already at the limit of ${capPerCompany} active applications for ${job.company}.` };
  }

  const perDay = Number(settings.maxApplicationsPerDay ?? 20);
  if (perDay > 0 && applicationsToday(userId) >= perDay) {
    return { allowed: false, code: 'daily_cap', reason: `Daily application limit of ${perDay} reached — the agent will continue tomorrow.` };
  }

  const perWeek = Number(settings.maxApplicationsPerWeek ?? 60);
  if (perWeek > 0 && applicationsThisWeek(userId) >= perWeek) {
    return { allowed: false, code: 'weekly_cap', reason: `Weekly application limit of ${perWeek} reached.` };
  }

  if (match.score < Number(settings.minMatchScore ?? 70)) {
    return { allowed: false, code: 'below_min_match', reason: `Match ${match.score}% is below the ${settings.minMatchScore}% minimum.` };
  }

  return { allowed: true };
}

/**
 * Finds an existing application for the same employer and role.
 *
 * "Same company + position" counts as the same application even when the advert is
 * reposted under a new URL or job id, which is common. Only applications that ended
 * without reaching the employer (skipped, failed, withdrawn, rejected) are ignored, so
 * a genuine retry stays possible.
 *
 * @param {{ userId: number, job?: object, company?: string, title?: string, excludeApplicationId?: number }} args
 * @returns {{ id:number, status:string, title:string }|null}
 */
export function findCompanyRoleClash({ userId, job = {}, company, title, excludeApplicationId = null }) {
  const database = db();
  const targetCompany = String(company ?? job.company ?? '').trim();
  if (!targetCompany) return null;
  const targetTitle = normaliseTitleKey(String(title ?? job.title ?? ''));
  if (!targetTitle) return null;

  const rows = database.all(
    `SELECT a.id, a.status, j.title, j.company FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE a.user_id = ?
       AND lower(trim(COALESCE(j.company,''))) = lower(trim(?))
       AND a.status NOT IN ('skipped','failed','withdrawn','rejected')
       AND (? IS NULL OR a.id != ?)`,
    userId,
    targetCompany,
    excludeApplicationId,
    excludeApplicationId
  );
  return rows.find((row) => normaliseTitleKey(row.title) === targetTitle) || null;
}

function normaliseTitleKey(title = '') {
  return String(title)
    .toLowerCase()
    .replace(/\b(senior|junior|lead|principal|staff|snr|jr|mid|intermediate)\b/g, '')
    .replace(/\b(full[- ]time|part[- ]time|contract|remote|hybrid|onsite)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ *
 * 3. Generation + submission
 * ------------------------------------------------------------------ */

export async function processJob({ userId, jobRow, match, settings, profileRecord, truthIndex, cvRow, campaignId = null, runId = null }) {
  const database = db();
  const job = match.job || hydrateJob(jobRow);

  const eligibility = checkEligibility({ userId, job, match, settings });
  if (!eligibility.allowed) {
    recordActivity({ userId, campaignId, runId, level: 'info', scope: 'policy', message: `Skipped “${job.title}” — ${eligibility.reason}`, meta: { jobId: job.id, code: eligibility.code } });
    if (eligibility.applicationId && eligibility.code === 'duplicate_job') {
      return { outcome: 'duplicate', applicationId: eligibility.applicationId, reason: eligibility.reason };
    }
    return { outcome: 'skipped', reason: eligibility.reason, code: eligibility.code };
  }

  // Generate the application package (deterministic + optional LLM polish).
  const generated = generateApplication({ profile: profileRecord, truthIndex, job, match, settings, userId });
  let coverLetter = generated.coverLetter;
  try {
    coverLetter = await polishCoverLetter({ draft: coverLetter, profile: profileRecord, job, truthIndex, userId });
  } catch (err) {
    log.warn(`cover letter polish skipped: ${err.message}`);
  }

  const existingApp = database.get('SELECT id FROM applications WHERE user_id = ? AND job_id = ?', userId, job.id);
  let applicationId;
  if (existingApp) {
    applicationId = existingApp.id;
    database.run(
      `UPDATE applications SET status = ?, match_score = ?, cover_letter = ?, intro_text = ?, answers = ?, package_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      APPLICATION_STATUS.PREPARING,
      match.score,
      coverLetter,
      generated.intro,
      JSON.stringify(generated.answers),
      JSON.stringify(generated.tailoredCv ? { target: generated.tailoredCv.target, summary: generated.tailoredCv.summary, coreSkills: generated.tailoredCv.coreSkills } : {}),
      applicationId
    );
  } else {
    const info = database.run(
      `INSERT INTO applications (user_id, job_id, campaign_id, cv_id, status, mode, match_score, cover_letter, intro_text, answers, package_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      userId,
      job.id,
      campaignId,
      cvRow?.id ?? null,
      APPLICATION_STATUS.PREPARING,
      'assisted',
      match.score,
      coverLetter,
      generated.intro,
      JSON.stringify(generated.answers),
      JSON.stringify(generated.tailoredCv ? { target: generated.tailoredCv.target, summary: generated.tailoredCv.summary, coreSkills: generated.tailoredCv.coreSkills } : {})
    );
    applicationId = Number(info.lastInsertRowid);
  }

  addEvent(applicationId, 'generated', `Application package generated (match ${match.score}%).`, {
    engine: generated.engine,
    truthGuardViolations: generated.truthGuard.violations.length,
    needsUserInput: generated.needsUserInput.length,
  });

  // Render documents.
  let documents = {};
  try {
    const cvDoc = await renderTailoredCv({ userId, job, cv: generated.tailoredCv, packageId: applicationId });
    const letterDoc = await renderCoverLetter({
      userId,
      job,
      coverLetter,
      name: profileRecord.fullName,
      contact: { email: profileRecord.email, phone: profileRecord.phone, location: profileRecord.location, portfolio: profileRecord.portfolioUrl, linkedin: profileRecord.linkedinUrl },
      packageId: applicationId,
    });
    const answersDoc = await renderAnswerSheet({ userId, job, answers: generated.answers, name: profileRecord.fullName });
    const [cv, letter, answerSheet] = [cvDoc, letterDoc, answersDoc];
    database.run(
      'UPDATE applications SET tailored_cv_path = ?, cover_letter_path = ? WHERE id = ?',
      cv.path,
      letter.path,
      applicationId
    );
    documents = { cv, letter, answerSheet };
  } catch (err) {
    log.warn(`document rendering failed: ${err.message}`);
    addEvent(applicationId, 'document_error', `Document rendering failed: ${err.message}`);
  }

  // Decide how (or whether) to submit.
  const route = resolveApplyRoute(job);
  const wantsAuto = match.decision === 'auto_apply';
  const blockingInputs = generated.needsUserInput.filter((q) => !/if asked/i.test(q));

  if (!wantsAuto) {
    database.run(
      `UPDATE applications SET status = ?, mode = ?, human_action = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      APPLICATION_STATUS.AWAITING_USER_ACTION,
      'assisted',
      JSON.stringify({ type: 'review', detail: match.decisionReason, questions: blockingInputs }),
      applicationId
    );
    addEvent(applicationId, 'awaiting_review', match.decisionReason);
    await notify({
      userId,
      type: NOTIFICATION_TYPES.HUMAN_ACTION_REQUIRED,
      title: `Review ready: ${job.title}${job.company ? ` — ${job.company}` : ''}`,
      body: `${match.decisionReason} Tailored CV and cover letter are prepared.${blockingInputs.length ? ` ${blockingInputs.length} question(s) need your input.` : ''}`,
      jobId: job.id,
      applicationId,
      campaignId,
    });
    return { outcome: 'awaiting_user_action', applicationId, documents, generated, route };
  }

  if (blockingInputs.length) {
    database.run(
      `UPDATE applications SET status = ?, human_action = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      APPLICATION_STATUS.AWAITING_USER_ACTION,
      JSON.stringify({ type: 'questions', detail: 'The advert asks questions that cannot be answered truthfully from the CV.', questions: blockingInputs }),
      applicationId
    );
    addEvent(applicationId, 'awaiting_answers', `${blockingInputs.length} question(s) need your input before submitting.`, { questions: blockingInputs });
    await notify({
      userId,
      type: NOTIFICATION_TYPES.HUMAN_ACTION_REQUIRED,
      title: `Answers needed: ${job.title}`,
      body: `This match scored ${match.score}% and would auto-apply, but ${blockingInputs.length} question(s) can only be answered by you: ${blockingInputs.join(' | ')}`,
      jobId: job.id,
      applicationId,
      campaignId,
    });
    return { outcome: 'awaiting_answers', applicationId, documents, generated, route };
  }

  const result = await submitApplication({ userId, applicationId, settings, documents, generated, auto: true, job, profileRecord, campaignId, runId });
  return { outcome: result.status === 'submitted' ? 'submitted' : result.status, applicationId, documents, generated, route, result };
}

/**
 * Performs the actual submission for an application record.
 * Only reports `submitted` when the target platform/ATS accepted it.
 */
export async function submitApplication({ userId, applicationId, settings, documents, generated, auto = false, job = null, profileRecord = null, campaignId = null, runId = null }) {
  const database = db();
  const app = database.get('SELECT * FROM applications WHERE id = ? AND user_id = ?', applicationId, userId);
  if (!app) return { status: 'failed', detail: 'Application not found' };
  const jobRow = database.get('SELECT * FROM jobs WHERE id = ?', app.job_id);
  const jobData = job || hydrateJob(jobRow);
  const profile = profileRecord || loadProfile(userId);
  const answers = generated?.answers || safeJson(app.answers, []);
  const coverLetter = generated?.coverLetter || app.cover_letter || '';

  const route = resolveApplyRoute(jobData);
  const documentsForSubmit = documents || await loadDocuments(app, jobData, coverLetter, answers, profile);

  // Defence in depth: safety screening is enforced again at submission time, so a
  // listing that was flagged after scoring can never be applied to.
  if (jobData.risk?.level === 'high') {
    database.run(
      `UPDATE applications SET status = ?, human_action = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      APPLICATION_STATUS.BLOCKED,
      JSON.stringify({ type: 'risk', detail: jobData.risk.summary }),
      applicationId
    );
    addEvent(applicationId, 'blocked_risk', `Blocked at submission: ${(jobData.risk.flags || []).map((f) => f.label).join('; ')}`);
    return { status: 'blocked', detail: `Blocked by safety screening: ${jobData.risk.summary}` };
  }

  // Duplicate protection, re-checked at the moment of submission: a second application
  // for the same company + role must not go out while reapplication is disabled.
  if (!settings.reapplicationAllowed) {
    const clash = findCompanyRoleClash({ userId, job: jobData, excludeApplicationId: applicationId });
    if (clash) {
      database.run(
        `UPDATE applications SET status = ?, human_action = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        APPLICATION_STATUS.SKIPPED,
        JSON.stringify({ type: 'duplicate', detail: `Already applied to ${jobData.company} — ${clash.title} (status: ${clash.status}).` }),
        applicationId
      );
      addEvent(applicationId, 'skipped_duplicate', `Blocked at submission: an application for ${jobData.company} — ${clash.title} already exists.`);
      return { status: 'skipped_duplicate', detail: `An application for ${jobData.company} — ${clash.title} already exists and reapplication is disabled.` };
    }
  }

  // Demo listings are labelled sample data — never submit anything against them.
  if (jobData.isDemo) {
    database.run(
      `UPDATE applications SET status = ?, mode = 'assisted', human_action = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      APPLICATION_STATUS.AWAITING_USER_ACTION,
      JSON.stringify({ type: 'demo', detail: 'Demo listing — no real application was sent.' }),
      applicationId
    );
    return {
      status: 'requires_human',
      mode: 'assisted',
      detail: 'This is a demo listing (clearly labelled in your workspace), so no application was submitted anywhere. Enable a live source and start a live hunt to apply for real.',
    };
  }

  let result;
  if (route.mode === 'email') {
    result = await submitByEmail({
      userId,
      job: { ...jobData, applyEmail: route.email || jobData.applyEmail },
      candidate: { name: profile?.fullName, email: profile?.email, phone: profile?.phone },
      coverLetterText: coverLetter,
      answers,
      attachments: documentsForSubmit?.cv?.path ? [{ path: documentsForSubmit.cv.path, filename: documentsForSubmit.cv.filename }] : [],
    });
  } else if (route.mode === 'api_apply' && route.connector) {
    const connector = buildConnector(route.connector, { userId });
    if (!connector) {
      result = { status: 'requires_human', mode: 'assisted', detail: `${route.connector} connector unavailable.` };
    } else if (!connector.meta.capabilities.autoApply) {
      result = await connector.submitApplication({ job: jobData, answers, coverLetterText: coverLetter, candidate: splitName(profile?.fullName), documents: documentsForSubmit });
    } else {
      const cvBuffer = documentsForSubmit?.cv?.path && fs.existsSync(documentsForSubmit.cv.path) ? fs.readFileSync(documentsForSubmit.cv.path) : null;
      result = await connector.submitApplication({
        job: jobData,
        answers,
        coverLetterText: coverLetter,
        candidate: { ...splitName(profile?.fullName), email: profile?.email, phone: profile?.phone, raw: profile?.fullName },
        documents: { cv: cvBuffer ? { buffer: cvBuffer, filename: documentsForSubmit.cv.filename } : null, cvText: app.cover_letter ? undefined : undefined },
      });
    }
  } else {
    result = {
      status: 'requires_human',
      mode: 'assisted',
      detail: `${jobData.sourceKey} applications are completed on the employer’s or platform’s own form — everything is prepared for you.`,
      handoff: {
        url: jobData.applyUrl || jobData.url,
        steps: [
          'Open the job link (the platform’s own application form).',
          'Use the tailored CV and cover letter from this record.',
          'Use the prepared answers for the questions listed.',
          'Mark the application “Applied” here afterwards.',
        ],
      },
    };
  }

  const humanStep = detectHumanStep(result);
  const timestamp = new Date().toISOString();

  if (result.status === 'submitted') {
    database.run(
      `UPDATE applications SET status = ?, mode = ?, submitted_at = ?, confirmation = ?, human_action = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      APPLICATION_STATUS.SUBMITTED,
      result.mode || route.mode,
      timestamp,
      JSON.stringify(result.confirmation || {}),
      applicationId
    );
    addEvent(applicationId, 'submitted', result.detail || 'Submission accepted by the target platform.', { confirmation: result.confirmation || null, mode: result.mode });
    await notify({
      userId,
      type: NOTIFICATION_TYPES.APPLICATION_SUBMITTED,
      title: `Application submitted: ${jobData.title}${jobData.company ? ` — ${jobData.company}` : ''}`,
      body: `Submitted via ${result.mode || route.mode}${result.confirmation?.source ? ` (${result.confirmation.source})` : ''}. Match score ${app.match_score}%.`,
      jobId: jobData.id,
      applicationId,
      campaignId,
    });
    return { status: 'submitted', detail: result.detail, confirmation: result.confirmation };
  }

  if (humanStep) {
    database.run(
      `UPDATE applications SET status = ?, mode = 'assisted', human_action = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      APPLICATION_STATUS.AWAITING_USER_ACTION,
      JSON.stringify({ type: humanStep.type, detail: humanStep.message, source: result.detail }),
      applicationId
    );
    addEvent(applicationId, `human_step:${humanStep.type}`, `${humanStep.message} ${result.detail || ''}`.trim());
    const type =
      humanStep.type === 'captcha'
        ? NOTIFICATION_TYPES.CAPTCHA_ENCOUNTERED
        : humanStep.type === 'login'
          ? NOTIFICATION_TYPES.LOGIN_EXPIRED
          : humanStep.type === 'blocked'
            ? NOTIFICATION_TYPES.PLATFORM_BLOCKED
            : NOTIFICATION_TYPES.HUMAN_ACTION_REQUIRED;
    await notify({
      userId,
      type,
      title: humanStep.message,
      body: `${jobData.title}${jobData.company ? ` — ${jobData.company}` : ''}: ${result.detail || ''} AI Job Hunter paused this application instead of trying to bypass the check.`,
      jobId: jobData.id,
      applicationId,
      campaignId,
    });
    return { status: 'requires_human', humanStep, detail: result.detail };
  }

  if (result.status === 'requires_human') {
    database.run(
      `UPDATE applications SET status = ?, mode = ?, human_action = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      APPLICATION_STATUS.AWAITING_USER_ACTION,
      result.mode || 'assisted',
      JSON.stringify({ type: 'handoff', detail: result.detail, handoff: result.handoff || null }),
      applicationId
    );
    addEvent(applicationId, 'handoff', result.detail || 'Ready for you to submit.');
    if (!auto) {
      await notify({
        userId,
        type: NOTIFICATION_TYPES.HUMAN_ACTION_REQUIRED,
        title: `Ready to submit: ${jobData.title}`,
        body: result.detail || 'The application is prepared — open the job link and submit it.',
        jobId: jobData.id,
        applicationId,
        campaignId,
      });
    }
    return { status: 'requires_human', detail: result.detail, handoff: result.handoff };
  }

  database.run(
    `UPDATE applications SET status = ?, mode = ?, human_action = ?, confirmation = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    APPLICATION_STATUS.FAILED,
    result.mode || route.mode,
    JSON.stringify({ type: 'failed', detail: result.detail }),
    JSON.stringify(result.confirmation || {}),
    applicationId
  );
  addEvent(applicationId, 'failed', result.detail || 'Submission failed.');
  return { status: 'failed', detail: result.detail };
}

async function loadDocuments(app, job, coverLetter, answers, profile) {
  try {
    const cv = app.tailored_cv_path && fs.existsSync(app.tailored_cv_path) ? { path: app.tailored_cv_path, filename: app.tailored_cv_path.split('/').pop() } : null;
    const letter = app.cover_letter_path && fs.existsSync(app.cover_letter_path) ? { path: app.cover_letter_path, filename: app.cover_letter_path.split('/').pop() } : null;
    return { cv, letter };
  } catch {
    return {};
  }
}

function detectHumanStep(result) {
  const haystack = `${result?.detail || ''} ${JSON.stringify(result?.confirmation || {})}`;
  for (const pattern of HUMAN_STEP_PATTERNS) {
    if (pattern.re.test(haystack)) return { type: pattern.type, message: pattern.message };
  }
  return null;
}

function splitName(fullName = '') {
  const parts = String(fullName || '').trim().split(/\s+/);
  if (!parts.length) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

export function loadProfile(userId) {
  const row = db().get('SELECT * FROM profiles WHERE user_id = ?', userId);
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.full_name,
    headline: row.headline,
    email: row.email,
    phone: row.phone,
    location: row.location,
    country: row.country,
    city: row.city,
    linkedinUrl: row.linkedin_url,
    portfolioUrl: row.portfolio_url,
    githubUrl: row.github_url,
    summary: row.summary,
    yearsExperience: row.years_experience,
    seniority: row.seniority,
    workAuthorization: row.work_authorization,
    salaryExpectation: row.salary_expectation,
    salaryCurrency: row.salary_currency,
    noticePeriod: row.notice_period,
    skills: safeJson(row.skills, []),
    declaredSkills: safeJson(row.tools, []),
    tools: safeJson(row.tools, []),
    jobTitles: safeJson(row.job_titles, []),
    experience: safeJson(row.experience, []),
    education: safeJson(row.education, []),
    certifications: safeJson(row.certifications, []),
    projects: safeJson(row.projects, []),
    languages: safeJson(row.languages, []),
    industries: safeJson(row.industries, []),
    achievements: safeJson(row.achievements, []),
    extraction: safeJson(row.extraction, {}),
  };
}

export function truthIndexFor(userId) {
  const profile = loadProfile(userId);
  if (!profile) return null;
  const extraction = profile.extraction || {};
  return extraction.truthIndex || {
    name: profile.fullName,
    companies: profile.experience.map((e) => e.company).filter(Boolean),
    titles: profile.jobTitles,
    skillIds: profile.skills.map((s) => s.id),
    skillLabels: profile.skills.map((s) => s.label),
    education: profile.education.map((e) => e.qualification),
    certifications: profile.certifications.map((c) => c.name),
    languages: profile.languages.map((l) => l.name),
    industries: profile.industries,
    yearsExperience: profile.yearsExperience,
    seniority: profile.seniority,
    achievements: profile.achievements.map((a) => a.text || a),
    projects: profile.projects.map((p) => p.name),
    declaredSkills: profile.declaredSkills,
    workAuthorization: profile.workAuthorization,
  };
}

export function loadSettings(userId) {
  const row = db().get('SELECT * FROM user_settings WHERE user_id = ?', userId);
  if (!row) return defaultSettings();
  return {
    roles: safeJson(row.roles, []),
    locations: safeJson(row.locations, []),
    countries: safeJson(row.countries, []),
    workModes: safeJson(row.work_modes, ['remote', 'hybrid', 'onsite']),
    employmentTypes: safeJson(row.employment_types, ['full-time']),
    minMatchScore: row.min_match_score,
    autoApplyThreshold: row.auto_apply_threshold,
    reviewThreshold: row.review_threshold,
    autoApplyEnabled: !!row.auto_apply_enabled,
    minSalary: row.min_salary,
    currency: row.currency,
    maxApplicationsPerDay: row.max_applications_per_day,
    maxApplicationsPerWeek: row.max_applications_per_week,
    maxPerCompany: row.max_per_company,
    durationDays: row.duration_days,
    cadence: row.cadence,
    runsPerDay: row.runs_per_day,
    preferRecentDays: row.prefer_recent_days,
    prioritizeLowApplicants: !!row.prioritize_low_applicants,
    reapplicationAllowed: !!row.reapplication_allowed,
    requireConfirmation: !!row.require_confirmation,
    notifyInApp: !!row.notify_in_app,
    notifyEmail: !!row.notify_email,
    notifyWebhookUrl: row.notify_webhook_url,
    enabledConnectors: safeJson(row.enabled_connectors, []),
    updatedAt: row.updated_at,
  };
}

export function defaultSettings() {
  return {
    roles: [],
    locations: [],
    countries: [],
    workModes: ['remote', 'hybrid', 'onsite'],
    employmentTypes: ['full-time'],
    minMatchScore: 70,
    autoApplyThreshold: 80,
    reviewThreshold: 70,
    autoApplyEnabled: false,
    minSalary: null,
    currency: 'ZAR',
    maxApplicationsPerDay: 20,
    maxApplicationsPerWeek: 60,
    maxPerCompany: 2,
    durationDays: 7,
    cadence: 'daily',
    runsPerDay: 3,
    preferRecentDays: 14,
    prioritizeLowApplicants: true,
    reapplicationAllowed: false,
    requireConfirmation: true,
    notifyInApp: true,
    notifyEmail: false,
    notifyWebhookUrl: null,
    enabledConnectors: [],
  };
}

export function addEvent(applicationId, type, message, meta = {}) {
  db().run(
    'INSERT INTO application_events (application_id, type, message, meta) VALUES (?, ?, ?, ?)',
    applicationId,
    type,
    message,
    JSON.stringify(meta)
  );
}

export function recordActivity({ userId, campaignId = null, runId = null, level = 'info', scope = 'agent', message, meta = {} }) {
  try {
    db().run(
      'INSERT INTO activity_log (user_id, campaign_id, run_id, level, scope, message, meta) VALUES (?,?,?,?,?,?,?)',
      userId ?? null,
      campaignId,
      runId,
      level,
      scope,
      message,
      JSON.stringify(meta)
    );
  } catch (err) {
    log.warn(`activity log failed: ${err.message}`);
  }
  if (level === 'error') log.error(`${scope}: ${message}`, meta);
  else if (level === 'warn') log.warn(`${scope}: ${message}`);
  else log.info(`${scope}: ${message}`);
}

export function safeJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export { clamp };
