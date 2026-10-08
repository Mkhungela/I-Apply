/**
 * On-demand analysis used by the UI ("Analyse this job", paste-a-link, dashboards).
 */
import { db } from '../db/index.js';
import { ApiError } from '../lib/errors.js';
import { hydrateJob, loadProfile, loadSettings, truthIndexFor, scoreAndStore, recordActivity } from './jobPipeline.js';

export async function analyzeJob(userId, jobId, { campaignId = null } = {}) {
  const jobRow = db().get('SELECT * FROM jobs WHERE id = ? AND user_id = ?', jobId, userId);
  if (!jobRow) throw ApiError.notFound('Job not found');
  const profile = loadProfile(userId);
  if (!profile) throw ApiError.badRequest('Upload your CV first — matching needs your profile.');
  const truthIndex = truthIndexFor(userId);
  const settings = loadSettings(userId);
  const result = scoreAndStore(userId, jobRow, { profile, truthIndex, settings, campaignId });
  recordActivity({
    userId,
    level: 'info',
    scope: 'match',
    message: `Scored “${result.job.title}” at ${result.score}% (${result.decision}).`,
    meta: { jobId, score: result.score },
  });
  return result;
}

export function analyzeBatch(userId, { limit = 50 } = {}) {
  const rows = db().all(
    `SELECT j.* FROM jobs j WHERE j.user_id = ? AND j.id NOT IN (SELECT job_id FROM matches WHERE user_id = ?) LIMIT ?`,
    userId,
    userId,
    Math.min(Number(limit) || 50, 500)
  );
  const profile = loadProfile(userId);
  if (!profile) throw ApiError.badRequest('Upload your CV first.');
  const truthIndex = truthIndexFor(userId);
  const settings = loadSettings(userId);
  const results = [];
  for (const row of rows) {
    try {
      results.push(scoreAndStore(userId, row, { profile, truthIndex, settings }));
    } catch {
      /* keep going: one bad advert must not stop the batch */
    }
  }
  return { analyzed: results.length, matches: results.map((r) => ({ jobId: r.job.id, score: r.score, decision: r.decision })) };
}

export function getJobWithContext(userId, jobId) {
  const row = db().get('SELECT * FROM jobs WHERE id = ? AND user_id = ?', jobId, userId);
  if (!row) throw ApiError.notFound('Job not found');
  const match = db().get('SELECT * FROM matches WHERE user_id = ? AND job_id = ?', userId, jobId);
  const application = db().get('SELECT * FROM applications WHERE user_id = ? AND job_id = ?', userId, jobId);
  const events = application ? db().all('SELECT * FROM application_events WHERE application_id = ? ORDER BY at ASC', application.id) : [];
  return { job: hydrateJob(row), match: match ? mapMatch(match) : null, application: application ? mapApplication(application) : null, events: events.map((e) => ({ ...e, meta: safe(e.meta) })) };
}

export function mapMatch(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    score: row.score,
    breakdown: safe(row.breakdown),
    strongMatches: safe(row.strong_matches, []),
    gaps: safe(row.gaps, []),
    riskFlags: safe(row.risk_flags, []),
    priority: row.priority,
    decision: row.decision,
    decisionReason: row.decision_reason,
    engine: row.engine,
    updatedAt: row.updated_at,
  };
}

export function mapApplication(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    campaignId: row.campaign_id,
    status: row.status,
    mode: row.mode,
    matchScore: row.match_score,
    coverLetter: row.cover_letter,
    introText: row.intro_text,
    answers: safe(row.answers, []),
    humanAction: safe(row.human_action, null),
    // An empty confirmation object means nothing was ever confirmed; report null so
    // consumers can't mistake it for a real confirmation.
    confirmation: confirmationOf(row.confirmation),
    submittedAt: row.submitted_at,
    confirmedAt: row.confirmed_at,
    notes: row.notes,
    hasTailoredCv: !!row.tailored_cv_path,
    hasCoverLetterFile: !!row.cover_letter_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safe(value, fallback = {}) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function confirmationOf(value) {
  const parsed = safe(value, null);
  return parsed && typeof parsed === 'object' && Object.keys(parsed).length ? parsed : null;
}
