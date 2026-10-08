/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
/**
 * Durable campaign scheduler.
 *
 * State lives in SQLite, so a restart resumes exactly where it left off: campaigns
 * with status "running" continue on their next scheduled slot. Pause, resume and
 * stop take effect immediately (a job in flight finishes, then the run stops).
 *
 * The web process and the worker can be the same process (default) or the worker can
 * be run separately with `npm run worker`, which is what you deploy if you want the
 * agent to keep hunting while your browser — or your phone — is off.
 */
import { db } from '../db/index.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { searchAllSources } from '../connectors/index.js';
import {
  ingestJobs,
  scoreAndStore,
  processJob,
  hydrateJob,
  loadProfile,
  loadSettings,
  truthIndexFor,
  recordActivity,
  checkEligibility,
  applicationsToday,
  safeJson,
  APPLICATION_STATUS,
} from './jobPipeline.js';
import { notify, NOTIFICATION_TYPES } from './notifications.js';
import { resolveRole } from './skillTaxonomy.js';
import { decidePolicy } from './matcher.js';

const log = logger('scheduler');

const progress = new Map(); // campaignId -> live progress for the API
let intervalHandle = null;
let ticking = false;
const runningCampaigns = new Set();
const cancelRequests = new Set();
let lastTickAt = null;

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

export function startScheduler() {
  if (intervalHandle) return;
  recover();
  intervalHandle = setInterval(() => {
    void tick();
  }, config.schedulerTickMs);
  intervalHandle.unref?.();
  log.info(`scheduler started (tick ${config.schedulerTickMs}ms)`);
}

export function stopScheduler() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
  log.info('scheduler stopped');
}

/** On boot: keep running campaigns running, and make sure every one has a next slot. */
export function recover() {
  const database = db();
  const rows = database.all("SELECT * FROM campaigns WHERE status = 'running'");
  for (const campaign of rows) {
    if (!campaign.next_run_at) {
      database.run('UPDATE campaigns SET next_run_at = ? WHERE id = ?', new Date().toISOString(), campaign.id);
    }
  }
  const stale = database.all("SELECT id FROM campaign_runs WHERE status = 'running' AND started_at < ?", new Date(Date.now() - 6 * 3600_000).toISOString());
  for (const run of stale) {
    database.run("UPDATE campaign_runs SET status = 'error', finished_at = ?, errors = ? WHERE id = ?", new Date().toISOString(), JSON.stringify(['Interrupted by a restart']), run.id);
  }
  if (rows.length) log.info(`recovered ${rows.length} running campaign(s) from the database`);
  return rows.length;
}

export function schedulerStatus() {
  const database = db();
  const campaigns = database.all("SELECT id, name, status, next_run_at, last_run_at FROM campaigns WHERE status IN ('running','paused')");
  return {
    running: !!intervalHandle,
    tickMs: config.schedulerTickMs,
    lastTickAt,
    activeCampaigns: [...runningCampaigns],
    campaigns,
    progress: Object.fromEntries(progress),
  };
}

/* ------------------------------------------------------------------ *
 * Tick
 * ------------------------------------------------------------------ */

export async function tick() {
  if (ticking) return;
  ticking = true;
  lastTickAt = new Date().toISOString();
  try {
    const database = db();
    const now = new Date().toISOString();
    const due = database.all(
      "SELECT id, user_id, name FROM campaigns WHERE status = 'running' AND (next_run_at IS NULL OR next_run_at <= ?)",
      now
    );
    for (const campaign of due) {
      if (runningCampaigns.has(campaign.id)) continue;
      database.run('UPDATE campaigns SET next_run_at = NULL WHERE id = ?', campaign.id);
      await runCampaign(campaign.id, { trigger: 'schedule' });
    }
  } catch (err) {
    log.error(`scheduler tick failed: ${err.message}`);
  } finally {
    ticking = false;
  }
}

/* ------------------------------------------------------------------ *
 * Campaign control
 * ------------------------------------------------------------------ */

export function computeNextRun({ cadence, runsPerDay = 3, intervalHours = null, from = new Date() }) {
  const at = new Date(from.getTime());
  switch (cadence) {
    case 'once':
      return null;
    case 'hourly':
      at.setHours(at.getHours() + 1);
      break;
    case 'custom':
      at.setHours(at.getHours() + (Number(intervalHours) || 6));
      break;
    case 'daily':
    default: {
      const perDay = Math.max(1, Math.min(24, Number(runsPerDay) || 3));
      const everyHours = Math.max(1, Math.round(24 / perDay));
      at.setHours(at.getHours() + everyHours);
    }
  }
  return at.toISOString();
}

export async function startCampaign(userId, campaignId, { immediate = true } = {}) {
  const database = db();
  const campaign = database.get('SELECT * FROM campaigns WHERE id = ? AND user_id = ?', campaignId, userId);
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  const cfg = safeJson(campaign.config, {});
  const now = new Date();
  const endsAt = cfg.durationDays ? new Date(now.getTime() + Number(cfg.durationDays) * 86_400_000).toISOString() : campaign.ends_at;
  database.run(
    "UPDATE campaigns SET status = 'running', started_at = COALESCE(started_at, ?), stopped_at = NULL, paused_at = NULL, ends_at = ?, next_run_at = ? WHERE id = ?",
    now.toISOString(),
    endsAt,
    immediate ? now.toISOString() : computeNextRun({ ...cfg }),
    campaignId
  );
  await notify({
    userId,
    type: NOTIFICATION_TYPES.CAMPAIGN_STARTED,
    title: `Job hunt started: ${campaign.name}`,
    body: `The agent will search and process jobs ${
      cfg.cadence === 'once' ? 'once' : `every ${Math.max(1, Math.round(24 / (Number(cfg.runsPerDay) || 3)))} hour(s)`
    } until ${endsAt ? new Date(endsAt).toLocaleString('en-GB') : 'you stop it'}.`,
    campaignId,
  });
  if (immediate) void runCampaign(campaignId, { trigger: 'manual' });
  return getCampaign(userId, campaignId);
}

export function pauseCampaign(userId, campaignId) {
  const database = db();
  database.run("UPDATE campaigns SET status = 'paused', paused_at = ? WHERE id = ? AND user_id = ?", new Date().toISOString(), campaignId, userId);
  return getCampaign(userId, campaignId);
}

export async function resumeCampaign(userId, campaignId, { immediate = true } = {}) {
  const database = db();
  const campaign = database.get('SELECT * FROM campaigns WHERE id = ? AND user_id = ?', campaignId, userId);
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  const cfg = safeJson(campaign.config, {});
  database.run(
    "UPDATE campaigns SET status = 'running', paused_at = NULL, next_run_at = ? WHERE id = ?",
    immediate ? new Date().toISOString() : computeNextRun(cfg),
    campaignId
  );
  if (immediate) void runCampaign(campaignId, { trigger: 'manual' });
  return getCampaign(userId, campaignId);
}

export function stopCampaign(userId, campaignId, { reason = 'Stopped by user' } = {}) {
  const database = db();
  cancelRequests.add(campaignId);
  database.run(
    "UPDATE campaigns SET status = 'stopped', stopped_at = ?, next_run_at = NULL, last_error = ? WHERE id = ? AND user_id = ?",
    new Date().toISOString(),
    reason,
    campaignId,
    userId
  );
  return getCampaign(userId, campaignId);
}

export function getCampaign(userId, campaignId) {
  const campaign = db().get('SELECT * FROM campaigns WHERE id = ? AND user_id = ?', campaignId, userId);
  if (!campaign) return null;
  const runs = db().all('SELECT * FROM campaign_runs WHERE campaign_id = ? ORDER BY started_at DESC LIMIT 20', campaignId);
  return {
    ...campaign,
    config: safeJson(campaign.config, {}),
    progress: progress.get(campaignId) || null,
    runs: runs.map((r) => ({ ...r, errors: safeJson(r.errors, []), summary: safeJson(r.summary, {}) })),
  };
}

/* ------------------------------------------------------------------ *
 * The run itself
 * ------------------------------------------------------------------ */

export async function runCampaign(campaignId, { trigger = 'schedule' } = {}) {
  if (runningCampaigns.has(campaignId)) return { skipped: true };
  const database = db();
  const campaign = database.get('SELECT * FROM campaigns WHERE id = ?', campaignId);
  if (!campaign) return { error: 'not_found' };

  runningCampaigns.add(campaignId);
  cancelRequests.delete(campaignId);
  const userId = campaign.user_id;
  const cfg = { runsPerDay: 3, cadence: 'daily', taskLimit: 12, searchMode: 'live', ...safeJson(campaign.config, {}) };

  const runInfo = database.run(
    'INSERT INTO campaign_runs (campaign_id, user_id, status, trigger) VALUES (?, ?, ?, ?)',
    campaignId,
    userId,
    'running',
    trigger
  );
  const runId = Number(runInfo.lastInsertRowid);

  const stats = {
    jobsFound: 0,
    jobsNew: 0,
    jobsMatched: 0,
    jobsSkipped: 0,
    applicationsQueued: 0,
    applicationsSubmitted: 0,
    humanActions: 0,
    highQuality: 0,
  };
  const errors = [];
  const warnings = [];

  const setProgress = (step, message, current = 0, total = 0) => {
    progress.set(campaignId, { step, message, current, total, startedAt: progress.get(campaignId)?.startedAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
  };
  const fail = (message) => {
    errors.push(message);
    recordActivity({ userId, campaignId, runId, level: 'error', scope: 'campaign', message, meta: {} });
  };

  try {
    setProgress('prepare', 'Loading your CV profile and settings');
    const profile = loadProfile(userId);
    const truthIndex = truthIndexFor(userId);
    const settings = loadSettings(userId);
    if (!profile || !truthIndex) {
      throw Object.assign(new Error('No CV profile found — upload your CV before starting a job hunt.'), { code: 'no_profile' });
    }

    /* -------------------- 1. discover -------------------- */
    let rawJobs = [];
    if (cfg.searchMode === 'demo') {
      setProgress('search', 'Loading demo dataset (clearly labelled sample jobs)');
      const demoRows = database.all('SELECT * FROM jobs WHERE user_id = ? AND is_demo = 1 ORDER BY id ASC', userId);
      rawJobs = demoRows.map((r) => {
        const job = hydrateJob(r);
        return { ...job, dedupeKey: undefined, isDemo: true };
      });
    } else {
      setProgress('search', 'Searching your enabled job sources');
      const search = await searchAllSources(userId, {
        roleTitles: settings.roles,
        keywords: settings.roles,
        locations: settings.locations,
        limit: config.connectorPageLimit,
      });
      rawJobs = search.jobs;
      warnings.push(...search.warnings);
      warnings.forEach((w) => recordActivity({ userId, campaignId, runId, level: 'warn', scope: 'connector', message: w }));
      if (!search.sourcesQueried.length) {
        warnings.push('No job sources are enabled and configured yet. Enable a source in the Connectors tab, or paste job links manually.');
      }
    }
    stats.jobsFound = rawJobs.length;

    if (cancelRequests.has(campaignId)) throw Object.assign(new Error('Stopped by user'), { code: 'cancelled' });

    /* -------------------- 2. ingest (dedupe) -------------------- */
    setProgress('ingest', 'Removing duplicates you have already seen', 0, rawJobs.length);
    const { inserted, duplicates } = ingestJobs(userId, rawJobs, { campaignId, isDemo: cfg.searchMode === 'demo' });
    stats.jobsNew = inserted.length;
    recordActivity({
      userId,
      campaignId,
      runId,
      level: 'info',
      scope: 'discovery',
      message: `${rawJobs.length} job(s) found, ${inserted.length} new, ${duplicates} already known (skipped as duplicates).`,
      meta: { duplicates },
    });

    /* -------------------- 3. score -------------------- */
    const toScore = database.all(
      `SELECT * FROM jobs WHERE user_id = ? AND id NOT IN (SELECT job_id FROM matches WHERE user_id = ?)
       ORDER BY CASE WHEN posted_at IS NULL THEN 1 ELSE 0 END, posted_at DESC LIMIT 400`,
      userId,
      userId
    );
    setProgress('match', 'Comparing each job against your CV', 0, toScore.length);
    const scored = [];
    const runStartedAt = new Date().toISOString();
    let index = 0;
    for (const jobRow of toScore) {
      index += 1;
      if (index % 5 === 0) setProgress('match', `Comparing job ${index} of ${toScore.length} against your CV`, index, toScore.length);
      try {
        const match = scoreAndStore(userId, jobRow, { profile, truthIndex, settings, campaignId });
        scored.push(match);
        if (match.score >= Number(settings.minMatchScore ?? 70)) stats.jobsMatched += 1;
        else stats.jobsSkipped += 1;
      } catch (err) {
        fail(`Match failed for job ${jobRow.id}: ${err.message}`);
      }
    }

    /* -------------------- 4. prioritise -------------------- */
    // Matches are stored with the decision that applied when they were scored. Settings
    // may have changed since, so every candidate is re-evaluated against the *current*
    // policy before anything is prepared or submitted.
    const candidates = database.all(
      `SELECT m.*, j.* FROM matches m JOIN jobs j ON j.id = m.job_id
       WHERE m.user_id = ? AND m.score >= ?
       AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.job_id = m.job_id AND a.user_id = m.user_id
                       AND a.status NOT IN ('skipped','failed'))
       ORDER BY m.priority DESC, m.score DESC LIMIT ?`,
      userId,
      Math.max(0, Number(settings.minMatchScore ?? 70) - 5),
      Math.max(1, Number(cfg.taskLimit) || 12) * 4
    );

    const queue = [];
    for (const row of candidates) {
      const risk = safeJson(database.get('SELECT risk FROM jobs WHERE id = ?', row.job_id)?.risk, {});
      const policy = decidePolicy({ score: row.score, risk, settings });
      if (policy.decision !== row.decision || policy.decisionReason !== row.decision_reason) {
        database.run(`UPDATE matches SET decision = ?, decision_reason = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, policy.decision, policy.decisionReason, row.id);
      }
      if (policy.decision === 'skip') {
        stats.jobsSkipped += 1;
        continue;
      }
      queue.push({ ...row, decision: policy.decision, decision_reason: policy.decisionReason });
      if (queue.length >= Math.max(1, Number(cfg.taskLimit) || 12)) break;
    }

    // Report matches against the current policy (stored decisions may have been re-evaluated above).
    const refreshed = database.get(
      `SELECT COUNT(*) AS c FROM matches WHERE user_id = ? AND score >= ? AND updated_at >= ?`,
      userId,
      Number(settings.minMatchScore ?? 70),
      runStartedAt
    );
    const eligibleNow = database.get(
      `SELECT COUNT(*) AS c FROM matches m JOIN jobs j ON j.id = m.job_id
       WHERE m.user_id = ? AND m.score >= ? AND m.decision IN ('auto_apply','review')`,
      userId,
      Number(settings.minMatchScore ?? 70)
    );
    stats.jobsMatched = Math.max(stats.jobsMatched, refreshed?.c ?? 0, eligibleNow?.c ?? 0);

    setProgress('apply', 'Preparing and processing the best matches', 0, queue.length);
    let processed = 0;
    for (const row of queue) {
      if (cancelRequests.has(campaignId)) break;
      const dailyCap = Number(settings.maxApplicationsPerDay ?? 20);
      const submittedToday = applicationsToday(userId);
      if (dailyCap > 0 && submittedToday >= dailyCap) {
        recordActivity({ userId, campaignId, runId, level: 'info', scope: 'limits', message: `Daily limit of ${dailyCap} applications reached — remaining jobs are queued for the next run.` });
        break;
      }
      processed += 1;
      setProgress('apply', `Processing “${row.title}”`, processed, queue.length);
      const jobRow = database.get('SELECT * FROM jobs WHERE id = ?', row.job_id);
      const match = {
        score: row.score,
        breakdown: safeJson(row.breakdown, {}),
        strongMatches: safeJson(row.strong_matches, []),
        gaps: safeJson(row.gaps, []),
        riskFlags: safeJson(row.risk_flags, []),
        priority: row.priority,
        decision: row.decision,
        decisionReason: row.decision_reason,
      };

      try {
        const outcome = await processJob({
          userId,
          jobRow,
          match: { ...match, job: hydrateJob(jobRow) },
          settings,
          profileRecord: profile,
          truthIndex,
          cvRow: database.get('SELECT * FROM cvs WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1', userId),
          campaignId,
          runId,
        });
        stats.applicationsQueued += 1;
        if (outcome.outcome === 'submitted') stats.applicationsSubmitted += 1;
        if (outcome.outcome === 'awaiting_user_action' || outcome.outcome === 'awaiting_answers' || outcome.outcome === 'requires_human') stats.humanActions += 1;
        if (outcome.outcome === 'skipped') stats.jobsSkipped += 1;

        if (match.score >= Math.max(85, Number(settings.autoApplyThreshold ?? 80)) && stats.highQuality < 5) {
          stats.highQuality += 1;
          await notify({
            userId,
            type: NOTIFICATION_TYPES.HIGH_MATCH_JOB,
            title: `Strong match (${match.score}%): ${row.title}${row.company ? ` — ${row.company}` : ''}`,
            body: `Strong: ${safeJson(row.strong_matches, []).slice(0, 5).join(', ') || '—'}. Gaps: ${safeJson(row.gaps, []).slice(0, 3).join(', ') || 'none detected'}.`,
            jobId: row.job_id,
            campaignId,
          });
        }
      } catch (err) {
        fail(`Could not process “${row.title}”: ${err.message}`);
      }
    }

    /* -------------------- 5. finish -------------------- */
    const cancelled = cancelRequests.has(campaignId);
    const status = cancelled ? 'skipped' : errors.length && !processed ? 'error' : 'ok';
    setProgress(cancelled ? 'stopped' : 'done', cancelled ? 'Run stopped by you' : 'Run complete', processed, queue.length);

    database.run(
      `UPDATE campaign_runs SET status = ?, finished_at = ?, jobs_found = ?, jobs_new = ?, jobs_matched = ?, jobs_skipped = ?,
       applications_queued = ?, applications_submitted = ?, human_actions = ?, errors = ?, summary = ? WHERE id = ?`,
      status,
      new Date().toISOString(),
      stats.jobsFound,
      stats.jobsNew,
      stats.jobsMatched,
      stats.jobsSkipped,
      stats.applicationsQueued,
      stats.applicationsSubmitted,
      stats.humanActions,
      JSON.stringify(errors),
      JSON.stringify({ ...stats, duplicates, warnings: warnings.slice(0, 20), sources: cfg.searchMode === 'demo' ? ['demo'] : undefined }),
      runId
    );

    const endsAt = campaign.ends_at ? new Date(campaign.ends_at) : null;
    const finished = endsAt && Date.now() >= endsAt.getTime();
    const nextRunAt = cancelled || finished ? null : computeNextRun(cfg);

    database.run(
      `UPDATE campaigns SET total_runs = total_runs + 1, jobs_found = jobs_found + ?, jobs_matched = jobs_matched + ?,
       applications_submitted = applications_submitted + ?, last_run_at = ?, next_run_at = ?, status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
       last_error = ? WHERE id = ?`,
      stats.jobsNew,
      stats.jobsMatched,
      stats.applicationsSubmitted,
      new Date().toISOString(),
      nextRunAt,
      cancelled ? 'stopped' : finished ? 'completed' : 'running',
      errors[0] || null,
      campaignId
    );

    if (!cancelled) {
      await notify({
        userId,
        type: NOTIFICATION_TYPES.RUN_FINISHED,
        title: `Run finished: ${stats.jobsNew} new job(s), ${stats.applicationsSubmitted} submitted`,
        body:
          `${stats.jobsFound} found · ${stats.jobsNew} new · ${stats.jobsMatched} matched your profile · ` +
          `${stats.applicationsSubmitted} application(s) submitted · ${stats.humanActions} awaiting your action.` +
          (finished ? ' The scheduled hunt has ended.' : nextRunAt ? ` Next run ${new Date(nextRunAt).toLocaleString('en-GB')}.` : ''),
        campaignId,
      });
    }

    return { runId, status, stats, errors, warnings };
  } catch (err) {
    const cancelled = err.code === 'cancelled';
    fail(err.message);
    database.run(
      `UPDATE campaign_runs SET status = ?, finished_at = ?, errors = ?, summary = ? WHERE id = ?`,
      cancelled ? 'skipped' : 'error',
      new Date().toISOString(),
      JSON.stringify(errors),
      JSON.stringify({ ...stats, warnings }),
      runId
    );
    const cfgNext = cancelled ? null : computeNextRun(cfg);
    database.run(
      `UPDATE campaigns SET status = ?, last_run_at = ?, next_run_at = ?, last_error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      cancelled ? 'stopped' : 'running',
      new Date().toISOString(),
      cfgNext,
      err.message,
      campaignId
    );
    setProgress(cancelled ? 'stopped' : 'failed', err.message);
    if (!cancelled) {
      await notify({
        userId,
        type: NOTIFICATION_TYPES.SYSTEM,
        title: `Job hunt run needs attention: ${err.message}`,
        body: 'Open the Activity log for details. The campaign will retry on its next scheduled slot.',
        campaignId,
      });
    }
    return { runId, status: 'error', error: err.message, stats };
  } finally {
    runningCampaigns.delete(campaignId);
    cancelRequests.delete(campaignId);
    setTimeout(() => progress.delete(campaignId), 60_000).unref?.();
  }
}

/* ------------------------------------------------------------------ *
 * Convenience: run a one-off search now (no campaign record)
 * ------------------------------------------------------------------ */

export async function runOnceNow(userId, { searchMode = 'live', taskLimit = 6 } = {}) {
  const database = db();
  const settings = loadSettings(userId);
  const profile = loadProfile(userId);
  if (!profile) throw Object.assign(new Error('Upload a CV first — the agent cannot match jobs without a profile.'), { status: 400 });
  const name = `One-off run ${new Date().toLocaleString('en-GB')}`;
  const info = database.run(
    `INSERT INTO campaigns (user_id, name, status, config, started_at, ends_at, next_run_at)
     VALUES (?, ?, 'running', ?, ?, ?, ?)`,
    userId,
    name,
    JSON.stringify({ cadence: 'once', durationDays: 0, runsPerDay: 1, taskLimit, searchMode }),
    new Date().toISOString(),
    new Date(Date.now() + 3600_000).toISOString(),
    new Date().toISOString()
  );
  const campaignId = Number(info.lastInsertRowid);
  const result = await runCampaign(campaignId, { trigger: 'manual' });
  database.run("UPDATE campaigns SET status = 'completed', next_run_at = NULL WHERE id = ?", campaignId);
  void settings;
  return { campaignId, ...result };
}

export { progress, APPLICATION_STATUS, checkEligibility, resolveRole, recordActivity };
