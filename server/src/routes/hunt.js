/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { ApiError, asyncHandler, parse } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { getDashboard } from '../services/dashboard.js';
import { analyzeJob, getJobWithContext, mapApplication, mapMatch } from '../services/analysis.js';
import {
  loadProfile,
  loadSettings,
  truthIndexFor,
  processJob,
  submitApplication,
  addEvent,
  recordActivity,
  hydrateJob,
} from '../services/jobPipeline.js';
import {
  startCampaign,
  pauseCampaign,
  resumeCampaign,
  stopCampaign,
  getCampaign,
  runCampaign,
  runOnceNow,
  schedulerStatus,
} from '../services/scheduler.js';
import { listNotifications, markRead, unreadCount, notify, NOTIFICATION_TYPES } from '../services/notifications.js';
import { generateApplication } from '../services/applicationGenerator.js';
import { summarizeCapabilities } from '../services/capabilities.js';
import { seedDemoWorkspace } from '../services/demoSeed.js';
import { getConnectorClass } from '../connectors/index.js';

const router = express.Router();

/* ------------------------------------------------------------------ *
 * Dashboard
 * ------------------------------------------------------------------ */

router.get(
  '/dashboard',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ ...getDashboard(req.user.id), unreadNotifications: unreadCount(req.user.id), scheduler: schedulerStatus() });
  })
);

/* ------------------------------------------------------------------ *
 * Jobs
 * ------------------------------------------------------------------ */

router.get(
  '/jobs',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { status = 'all', minScore, q, limit = 50, source } = req.query;
    const clauses = ['j.user_id = ?'];
    const params = [req.user.id];
    if (source) {
      clauses.push('j.source_key = ?');
      params.push(String(source));
    }
    if (q) {
      clauses.push('(lower(j.title) LIKE ? OR lower(COALESCE(j.company, \'\')) LIKE ?)');
      params.push(`%${String(q).toLowerCase()}%`, `%${String(q).toLowerCase()}%`);
    }
    if (minScore) {
      clauses.push('COALESCE(m.score, 0) >= ?');
      params.push(Number(minScore));
    }
    if (status && status !== 'all') {
      if (status === 'unapplied') clauses.push('a.id IS NULL');
      else if (status === 'applied') clauses.push("a.status IN ('submitted','confirmed','interview')");
      else clauses.push('a.status = ?'), params.push(String(status));
    }
    const rows = db().all(
      `SELECT j.*, m.score, m.decision, m.decision_reason, m.strong_matches, m.gaps, m.risk_flags, m.priority,
              a.id AS application_id, a.status AS application_status, a.submitted_at
       FROM jobs j
       LEFT JOIN matches m ON m.job_id = j.id AND m.user_id = j.user_id
       LEFT JOIN applications a ON a.job_id = j.id AND a.user_id = j.user_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY COALESCE(m.priority, 0) DESC, j.discovered_at DESC
       LIMIT ?`,
      ...params,
      Math.min(Number(limit) || 50, 300)
    );
    res.json({
      jobs: rows.map((row) => ({
        id: row.id,
        title: row.title,
        company: row.company,
        location: row.location,
        workMode: row.work_mode,
        employmentType: row.employment_type,
        salary: row.salary_min || row.salary_max ? { min: row.salary_min, max: row.salary_max, currency: row.salary_currency, period: row.salary_period } : null,
        url: row.url,
        source: row.source_key,
        postedAt: row.posted_at,
        discoveredAt: row.discovered_at,
        applicantsCount: row.applicants_count,
        isDemo: !!row.is_demo,
        score: row.score,
        decision: row.decision,
        decisionReason: row.decision_reason,
        strongMatches: safeJson(row.strong_matches, []),
        gaps: safeJson(row.gaps, []),
        riskFlags: safeJson(row.risk_flags, []),
        priority: row.priority,
        applicationId: row.application_id,
        applicationStatus: row.application_status,
        submittedAt: row.submitted_at,
      })),
      total: rows.length,
    });
  })
);

router.get(
  '/jobs/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const context = getJobWithContext(req.user.id, Number(req.params.id));
    res.json(context);
  })
);

router.post(
  '/jobs/:id/analyze',
  requireAuth,
  asyncHandler(async (req, res) => {
    const match = await analyzeJob(req.user.id, Number(req.params.id));
    res.json({ match });
  })
);

router.post(
  '/jobs/:id/skip',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const jobId = Number(req.params.id);
    const job = db().get('SELECT * FROM jobs WHERE id = ? AND user_id = ?', jobId, userId);
    if (!job) throw ApiError.notFound('Job not found');
    const reason = String(req.body?.reason || 'Skipped by you');
    db().run(
      `INSERT INTO matches (user_id, job_id, score, decision, decision_reason, breakdown, strong_matches, gaps, risk_flags)
       VALUES (?,?,COALESCE((SELECT score FROM matches WHERE user_id = ? AND job_id = ?),0),'skip',?, '{}','[]','[]','[]')
       ON CONFLICT(user_id, job_id) DO UPDATE SET decision = 'skip', decision_reason = ?`,
      userId,
      jobId,
      userId,
      jobId,
      reason,
      reason
    );
    recordActivity({ userId, level: 'info', scope: 'policy', message: `Skipped “${job.title}” — ${reason}`, meta: { jobId } });
    res.json({ ok: true });
  })
);

/** Regenerates the application package for a job (after profile edits, for example). */
router.post(
  '/jobs/:id/prepare',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const jobId = Number(req.params.id);
    const context = getJobWithContext(userId, jobId);
    if (!context.match) throw ApiError.badRequest('Analyse the job first so there is a match to work from.');
    const profile = loadProfile(userId);
    const truthIndex = truthIndexFor(userId);
    const settings = loadSettings(userId);
    const jobRow = db().get('SELECT * FROM jobs WHERE id = ?', jobId);
    const outcome = await processJob({
      userId,
      jobRow,
      match: { ...context.match, job: hydrateJob(jobRow) },
      settings,
      profileRecord: profile,
      truthIndex,
      cvRow: db().get('SELECT * FROM cvs WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1', userId),
    });
    res.json({ outcome: outcome.outcome, applicationId: outcome.applicationId, generated: outcome.generated ? publicGenerated(outcome.generated) : null });
  })
);

function publicGenerated(generated) {
  return {
    intro: generated.intro,
    coverLetter: generated.coverLetter,
    subject: generated.coverLetterSubject,
    answers: generated.answers,
    tailoredCv: generated.tailoredCv,
    salaryExpectation: generated.salaryExpectation,
    noticePeriod: generated.noticePeriod,
    needsUserInput: generated.needsUserInput,
    truthGuard: generated.truthGuard,
    engine: generated.engine,
  };
}

/* ------------------------------------------------------------------ *
 * Applications
 * ------------------------------------------------------------------ */

router.get(
  '/applications',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { status, limit = 100 } = req.query;
    const clauses = ['a.user_id = ?'];
    const params = [req.user.id];
    if (status && status !== 'all') {
      clauses.push('a.status = ?');
      params.push(String(status));
    }
    const rows = db().all(
      `SELECT a.*, j.title, j.company, j.location, j.url, j.work_mode, j.source_key, j.is_demo, j.posted_at, j.applicants_count
       FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY COALESCE(a.submitted_at, a.updated_at) DESC LIMIT ?`,
      ...params,
      Math.min(Number(limit) || 100, 500)
    );
    res.json({
      applications: rows.map((row) => ({
        ...mapApplication(row),
        job: { id: row.job_id, title: row.title, company: row.company, location: row.location, url: row.url, workMode: row.work_mode, source: row.source_key, isDemo: !!row.is_demo, postedAt: row.posted_at, applicantsCount: row.applicants_count },
      })),
    });
  })
);

router.get(
  '/applications/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = db().get('SELECT * FROM applications WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
    if (!row) throw ApiError.notFound('Application not found');
    const events = db().all('SELECT * FROM application_events WHERE application_id = ? ORDER BY at ASC', row.id);
    const job = db().get('SELECT * FROM jobs WHERE id = ?', row.job_id);
    const match = db().get('SELECT * FROM matches WHERE user_id = ? AND job_id = ?', req.user.id, row.job_id);
    res.json({
      application: mapApplication(row),
      events: events.map((e) => ({ ...e, meta: safeJson(e.meta) })),
      job: hydrateJob(job),
      match: match ? mapMatch(match) : null,
      documents: {
        tailoredCv: row.tailored_cv_path && fs.existsSync(row.tailored_cv_path) ? path.basename(row.tailored_cv_path) : null,
        coverLetter: row.cover_letter_path && fs.existsSync(row.cover_letter_path) ? path.basename(row.cover_letter_path) : null,
      },
    });
  })
);

/** Manual submit (the assisted path): attempts the route and reports the truth. */
router.post(
  '/applications/:id/submit',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const applicationId = Number(req.params.id);
    const app = db().get('SELECT * FROM applications WHERE id = ? AND user_id = ?', applicationId, userId);
    if (!app) throw ApiError.notFound('Application not found');
    const settings = loadSettings(req.user.id);
    const profile = loadProfile(userId);
    const jobRow = db().get('SELECT * FROM jobs WHERE id = ?', app.job_id);
    const result = await submitApplication({
      userId,
      applicationId,
      settings,
      documents: null,
      generated: { coverLetter: app.cover_letter, answers: safeJson(app.answers, []) },
      job: hydrateJob(jobRow),
      profileRecord: profile,
    });
    res.json(result);
  })
);

/** Records an outcome you observed (interview invite, rejection, withdrawal, or a manual submission). */
const outcomeSchema = z.object({
  status: z.enum(['applied', 'interview', 'rejected', 'withdrawn', 'blocked']),
  note: z.string().max(2000).optional(),
});

router.post(
  '/applications/:id/outcome',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const applicationId = Number(req.params.id);
    const { status, note } = parse(outcomeSchema, req.body);
    const app = db().get('SELECT * FROM applications WHERE id = ? AND user_id = ?', applicationId, userId);
    if (!app) throw ApiError.notFound('Application not found');
    const job = db().get('SELECT title, company FROM jobs WHERE id = ?', app.job_id);
    const database = db();

    if (status === 'applied') {
      const confirmation = { source: 'user_asserted', assertedAt: new Date().toISOString(), note: note || 'You marked this as submitted yourself.' };
      database.run(
        "UPDATE applications SET status = 'submitted', submitted_at = COALESCE(submitted_at, ?), confirmation = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
        new Date().toISOString(),
        JSON.stringify(confirmation),
        applicationId
      );
      addEvent(applicationId, 'submitted_manual', note || 'Marked as applied by you.');
    } else {
      const mapped = status === 'interview' ? 'interview' : status;
      database.run("UPDATE applications SET status = ?, notes = COALESCE(?, notes), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", mapped, note || null, applicationId);
      addEvent(applicationId, `outcome:${mapped}`, note || `Status set to ${mapped}.`);
      if (mapped === 'interview') {
        await notify({
          userId,
          type: NOTIFICATION_TYPES.INTERVIEW_DETECTED,
          title: `Interview stage: ${job.title}${job.company ? ` — ${job.company}` : ''}`,
          body: note || 'You marked this application as being at interview stage. Prepare and go get it.',
          applicationId,
        });
      }
    }
    res.json({ application: mapApplication(db().get('SELECT * FROM applications WHERE id = ?', applicationId)) });
  })
);

/** Edits the prepared answers / notes before submitting. */
router.patch(
  '/applications/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const schema = z.object({
      answers: z
        .array(z.object({ question: z.string().max(500), answer: z.string().max(5000), needsUser: z.boolean().optional(), source: z.string().max(60).optional() }))
        .max(30)
        .optional(),
      coverLetter: z.string().max(20_000).optional(),
      notes: z.string().max(4000).optional(),
    });
    const patch = parse(schema, req.body);
    const app = db().get('SELECT * FROM applications WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
    if (!app) throw ApiError.notFound('Application not found');
    const sets = [];
    const values = [];
    if (patch.answers) {
      const merged = safeJson(app.answers, []).map((existing) => {
        const update = patch.answers.find((a) => a.question === existing.question);
        return update ? { ...existing, ...update, needsUser: update.answer ? false : existing.needsUser } : existing;
      });
      sets.push('answers = ?');
      values.push(JSON.stringify(merged));
      const stillMissing = merged.filter((a) => a.needsUser);
      sets.push('human_action = ?');
      values.push(stillMissing.length ? JSON.stringify({ type: 'questions', questions: stillMissing.map((a) => a.question) }) : null);
    }
    if (patch.coverLetter !== undefined) {
      sets.push('cover_letter = ?');
      values.push(patch.coverLetter);
    }
    if (patch.notes !== undefined) {
      sets.push('notes = ?');
      values.push(patch.notes);
    }
    if (!sets.length) return res.json({ application: mapApplication(app) });
    db().run(`UPDATE applications SET ${sets.join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, ...values, app.id);
    addEvent(app.id, 'edited', 'Application details edited by you.');
    res.json({ application: mapApplication(db().get('SELECT * FROM applications WHERE id = ?', app.id)) });
  })
);

router.get(
  '/applications/:id/documents/:kind',
  requireAuth,
  asyncHandler(async (req, res) => {
    const app = db().get('SELECT * FROM applications WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
    if (!app) throw ApiError.notFound('Application not found');
    const map = { cv: app.tailored_cv_path, cover: app.cover_letter_path };
    const filePath = map[req.params.kind];
    if (!filePath || !fs.existsSync(filePath)) throw ApiError.notFound('That document is not available.');
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${path.basename(filePath)}"`);
    fs.createReadStream(filePath).pipe(res);
  })
);

/* ------------------------------------------------------------------ *
 * Campaigns (the autonomous agent)
 * ------------------------------------------------------------------ */

const campaignSchema = z.object({
  name: z.string().max(120).optional(),
  durationDays: z.number().int().min(0).max(365).optional(),
  cadence: z.enum(['once', 'hourly', 'daily', 'custom']).optional(),
  runsPerDay: z.number().int().min(1).max(24).optional(),
  taskLimit: z.number().int().min(1).max(100).optional(),
  searchMode: z.enum(['live', 'demo']).optional(),
  startImmediately: z.boolean().optional(),
});

router.get(
  '/campaigns',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = db().all('SELECT * FROM campaigns WHERE user_id = ? ORDER BY id DESC LIMIT 50', req.user.id);
    res.json({
      campaigns: rows.map((row) => ({
        ...row,
        config: safeJson(row.config),
        progress: req.query.includeProgress ? schedulerStatus().progress[row.id] || null : undefined,
      })),
    });
  })
);

router.post(
  '/campaigns',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const input = parse(campaignSchema, req.body);
    const settings = loadSettings(userId);
    const profile = loadProfile(userId);
    if (!profile) throw ApiError.badRequest('Upload your CV first — the agent needs your profile before it can hunt.');

    const cfg = {
      durationDays: input.durationDays ?? settings.durationDays ?? 7,
      cadence: input.cadence ?? settings.cadence ?? 'daily',
      runsPerDay: input.runsPerDay ?? settings.runsPerDay ?? 3,
      taskLimit: input.taskLimit ?? 12,
      searchMode: input.searchMode ?? (settings.enabledConnectors?.length ? 'live' : 'demo'),
    };
    const now = new Date();
    const endsAt = cfg.durationDays > 0 ? new Date(now.getTime() + cfg.durationDays * 86_400_000).toISOString() : null;
    const name =
      input.name ||
      `${(settings.roles || ['Job hunt']).slice(0, 2).join(' + ')} — ${cfg.durationDays > 0 ? `${cfg.durationDays} day hunt` : 'open-ended'}`;

    const info = db().run(
      `INSERT INTO campaigns (user_id, name, status, config, ends_at, next_run_at)
       VALUES (?, ?, 'draft', ?, ?, NULL)`,
      userId,
      name,
      JSON.stringify(cfg),
      endsAt
    );
    const campaignId = Number(info.lastInsertRowid);
    recordActivity({ userId, level: 'info', scope: 'campaign', message: `Campaign created: ${name}`, meta: { campaignId, cfg } });

    if (input.startImmediately === false) {
      return res.status(201).json({ campaign: getCampaign(userId, campaignId) });
    }
    const campaign = await startCampaign(userId, campaignId, { immediate: true });
    res.status(201).json({ campaign });
  })
);

router.get(
  '/campaigns/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const campaign = getCampaign(req.user.id, Number(req.params.id));
    if (!campaign) throw ApiError.notFound('Campaign not found');
    res.json({ campaign });
  })
);

router.post(
  '/campaigns/:id/start',
  requireAuth,
  asyncHandler(async (req, res) => {
    const campaign = await startCampaign(req.user.id, Number(req.params.id), { immediate: req.body?.immediate !== false });
    res.json({ campaign });
  })
);

router.post(
  '/campaigns/:id/pause',
  requireAuth,
  asyncHandler(async (req, res) => {
    const campaign = pauseCampaign(req.user.id, Number(req.params.id));
    recordActivity({ userId: req.user.id, level: 'info', scope: 'campaign', message: `Campaign paused: ${campaign?.name}`, meta: { campaignId: campaign?.id } });
    res.json({ campaign });
  })
);

router.post(
  '/campaigns/:id/resume',
  requireAuth,
  asyncHandler(async (req, res) => {
    const campaign = await resumeCampaign(req.user.id, Number(req.params.id), { immediate: true });
    res.json({ campaign });
  })
);

router.post(
  '/campaigns/:id/stop',
  requireAuth,
  asyncHandler(async (req, res) => {
    const campaign = stopCampaign(req.user.id, Number(req.params.id), { reason: String(req.body?.reason || 'Stopped by user') });
    await notify({
      userId: req.user.id,
      type: NOTIFICATION_TYPES.CAMPAIGN_STOPPED,
      title: `Job hunt stopped: ${campaign?.name}`,
      body: 'No further searches or applications will run for this campaign. Your tracker and documents are kept.',
      campaignId: campaign?.id,
    });
    res.json({ campaign });
  })
);

router.post(
  '/campaigns/:id/run',
  requireAuth,
  asyncHandler(async (req, res) => {
    const campaignId = Number(req.params.id);
    const campaign = db().get('SELECT * FROM campaigns WHERE id = ? AND user_id = ?', campaignId, req.user.id);
    if (!campaign) throw ApiError.notFound('Campaign not found');
    void runCampaign(campaignId, { trigger: 'manual' });
    res.json({ ok: true, message: 'Run started — watch the progress panel and activity log.' });
  })
);

/** One-off run with no schedule attached: START → search → match → prepare → next. */
router.post(
  '/hunt/run-once',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parse(
      z.object({ searchMode: z.enum(['live', 'demo']).optional(), taskLimit: z.number().int().min(1).max(50).optional() }),
      req.body || {}
    );
    const settings = loadSettings(req.user.id);
    const result = await runOnceNow(req.user.id, {
      searchMode: input.searchMode ?? (settings.enabledConnectors?.length ? 'live' : 'demo'),
      taskLimit: input.taskLimit ?? 6,
    });
    res.json(result);
  })
);

/* ------------------------------------------------------------------ *
 * Notifications + system
 * ------------------------------------------------------------------ */

router.get(
  '/notifications',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ notifications: listNotifications(req.user.id, { unreadOnly: req.query.unread === '1', limit: Number(req.query.limit) || 50 }), unread: unreadCount(req.user.id) });
  })
);

router.post(
  '/notifications/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { ids } = parse(z.object({ ids: z.array(z.number()).max(500).optional() }), req.body || {});
    res.json(markRead(req.user.id, ids || []));
  })
);

router.get(
  '/system/capabilities',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await summarizeCapabilities(req.user.id));
  })
);

router.get(
  '/activity',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = db().all('SELECT * FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', req.user.id, Math.min(Number(req.query.limit) || 100, 400));
    res.json({ activity: rows.map((r) => ({ ...r, meta: safeJson(r.meta) })) });
  })
);

router.post(
  '/system/demo',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (config.env === 'production' && process.env.ALLOW_DEMO_SEED === 'false') {
      throw ApiError.forbidden('Demo seeding is disabled on this instance.');
    }
    const result = await seedDemoWorkspace(req.user.id);
    res.json(result);
  })
);

/* ------------------------------------------------------------------ *
 * Connector policy reference (what is permitted where)
 * ------------------------------------------------------------------ */

router.get(
  '/policy',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const { CONNECTOR_CLASSES } = await import('../connectors/index.js');
    res.json({
      policy: CONNECTOR_CLASSES.map((C) => ({
        key: C.meta.key,
        name: C.meta.name,
        category: C.meta.category,
        description: C.meta.description,
        automation: C.meta.automationPolicy,
        credentials: C.meta.credentials,
        configuration: C.meta.configuration || [],
        capabilities: C.meta.capabilities,
        complianceNote: C.meta.complianceNote,
        canAutoApply: !!C.meta.capabilities.autoApply && getConnectorClass(C.meta.key)?.meta.capabilities.autoApply,
      })),
    });
  })
);

export default router;

function safeJson(value, fallback = {}) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
