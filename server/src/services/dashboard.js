/**
 * Dashboard aggregation.
 *
 * Honest by construction: "Applied" counts only applications the target platform or
 * ATS actually accepted. Applications that are prepared but not yet confirmed are
 * reported separately as "awaiting action".
 */
import { db } from '../db/index.js';
import { loadSettings } from './jobPipeline.js';

export function getDashboard(userId) {
  const database = db();
  const settings = loadSettings(userId);
  const minMatch = Number(settings.minMatchScore ?? 70);

  const count = (sql, ...params) => database.get(sql, ...params)?.c ?? 0;
  const todayStart = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();

  const jobsFoundToday = count('SELECT COUNT(*) AS c FROM jobs WHERE user_id = ? AND discovered_at >= ?', userId, todayStart);
  const jobsFoundTotal = count('SELECT COUNT(*) AS c FROM jobs WHERE user_id = ?', userId);
  const jobsMatched = count('SELECT COUNT(*) AS c FROM matches WHERE user_id = ? AND score >= ?', userId, minMatch);
  const scoredTotal = count('SELECT COUNT(*) AS c FROM matches WHERE user_id = ?', userId);
  const avgMatchRow = database.get('SELECT AVG(score) AS avg FROM matches WHERE user_id = ?', userId);
  const skipped = count('SELECT COUNT(*) AS c FROM matches WHERE user_id = ? AND decision = \'skip\'', userId);
  const highMatches = count('SELECT COUNT(*) AS c FROM matches WHERE user_id = ? AND score >= ?', userId, Number(settings.autoApplyThreshold ?? 80));

  const applied = count("SELECT COUNT(*) AS c FROM applications WHERE user_id = ? AND status IN ('submitted','confirmed','interview')", userId);
  const pending = count("SELECT COUNT(*) AS c FROM applications WHERE user_id = ? AND status IN ('awaiting_user_action','preparing','new')", userId);
  const interviews = count("SELECT COUNT(*) AS c FROM applications WHERE user_id = ? AND status = 'interview'", userId);
  const rejected = count("SELECT COUNT(*) AS c FROM applications WHERE user_id = ? AND status = 'rejected'", userId);
  const withdrawn = count("SELECT COUNT(*) AS c FROM applications WHERE user_id = ? AND status = 'withdrawn'", userId);
  const failed = count("SELECT COUNT(*) AS c FROM applications WHERE user_id = ? AND status = 'failed'", userId);
  const blocked = count("SELECT COUNT(*) AS c FROM applications WHERE user_id = ? AND status = 'blocked'", userId);

  const recentApplications = database
    .all(
      `SELECT a.id, a.status, a.match_score, a.submitted_at, a.created_at, a.human_action, j.title, j.company, j.location, j.url, j.work_mode, j.source_key, j.is_demo
       FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE a.user_id = ? ORDER BY COALESCE(a.submitted_at, a.updated_at) DESC LIMIT 25`,
      userId
    )
    .map((row) => ({
      id: row.id,
      status: row.status,
      matchScore: row.match_score,
      submittedAt: row.submitted_at,
      createdAt: row.created_at,
      title: row.title,
      company: row.company,
      location: row.location,
      url: row.url,
      workMode: row.work_mode,
      source: row.source_key,
      isDemo: !!row.is_demo,
      humanAction: safe(row.human_action),
    }));

  const topMatches = database
    .all(
      `SELECT m.score, m.decision, m.strong_matches, m.gaps, m.risk_flags, m.priority, j.id AS job_id, j.title, j.company, j.location, j.url, j.work_mode,
              j.source_key, j.posted_at, j.salary_min, j.salary_max, j.salary_currency, j.is_demo, j.applicants_count,
              (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS has_application
       FROM matches m JOIN jobs j ON j.id = m.job_id
       WHERE m.user_id = ? AND m.decision IN ('auto_apply','review')
       ORDER BY m.priority DESC, m.score DESC LIMIT 12`,
      userId
    )
    .map((row) => ({
      jobId: row.job_id,
      title: row.title,
      company: row.company,
      location: row.location,
      url: row.url,
      workMode: row.work_mode,
      source: row.source_key,
      postedAt: row.posted_at,
      applicantsCount: row.applicants_count,
      salary: row.salary_min || row.salary_max ? { min: row.salary_min, max: row.salary_max, currency: row.salary_currency } : null,
      score: row.score,
      decision: row.decision,
      priority: row.priority,
      strongMatches: safe(row.strong_matches, []),
      gaps: safe(row.gaps, []),
      riskFlags: safe(row.risk_flags, []),
      isDemo: !!row.is_demo,
      hasApplication: !!row.has_application,
    }));

  const activity = database
    .all('SELECT * FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 40', userId)
    .map((row) => ({ ...row, meta: safe(row.meta) }));

  const runningCampaign = database.get("SELECT * FROM campaigns WHERE user_id = ? AND status IN ('running','paused') ORDER BY id DESC LIMIT 1", userId);
  const lastRun = runningCampaign
    ? database.get('SELECT * FROM campaign_runs WHERE campaign_id = ? ORDER BY started_at DESC LIMIT 1', runningCampaign.id)
    : database.get('SELECT * FROM campaign_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT 1', userId);

  const responseBase = applied || 0;
  return {
    stats: {
      jobsFoundToday,
      jobsFoundTotal,
      jobsMatched,
      scoredTotal,
      highMatches,
      skipped,
      applied,
      pending,
      interviews,
      rejected,
      withdrawn,
      failed,
      blocked,
      averageMatchScore: avgMatchRow?.avg ? Math.round(avgMatchRow.avg) : null,
      responseRate: responseBase > 0 ? Math.round((interviews / responseBase) * 100) : null,
    },
    thresholds: {
      minMatchScore: minMatch,
      autoApplyThreshold: Number(settings.autoApplyThreshold ?? 80),
      autoApplyEnabled: !!settings.autoApplyEnabled,
      requireConfirmation: !!settings.requireConfirmation,
    },
    pipeline: [
      { key: 'found', label: 'Found', value: jobsFoundTotal },
      { key: 'matched', label: 'Matched', value: jobsMatched },
      { key: 'applied', label: 'Applied', value: applied },
      { key: 'pending', label: 'Awaiting action', value: pending },
      { key: 'interview', label: 'Interview', value: interviews },
      { key: 'rejected', label: 'Rejected', value: rejected },
      { key: 'skipped', label: 'Skipped', value: skipped },
    ],
    campaign: runningCampaign
      ? {
          id: runningCampaign.id,
          name: runningCampaign.name,
          status: runningCampaign.status,
          startedAt: runningCampaign.started_at,
          endsAt: runningCampaign.ends_at,
          nextRunAt: runningCampaign.next_run_at,
          lastRunAt: runningCampaign.last_run_at,
          totalRuns: runningCampaign.total_runs,
          config: safe(runningCampaign.config),
        }
      : null,
    lastRun: lastRun
      ? {
          id: lastRun.id,
          status: lastRun.status,
          startedAt: lastRun.started_at,
          finishedAt: lastRun.finished_at,
          jobsFound: lastRun.jobs_found,
          jobsNew: lastRun.jobs_new,
          jobsMatched: lastRun.jobs_matched,
          applicationsSubmitted: lastRun.applications_submitted,
          humanActions: lastRun.human_actions,
          summary: safe(lastRun.summary),
          errors: safe(lastRun.errors, []),
        }
      : null,
    recentApplications,
    topMatches,
    activity,
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
