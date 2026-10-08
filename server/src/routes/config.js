import express from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { ApiError, asyncHandler, parse } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { loadSettings, defaultSettings, recordActivity } from '../services/jobPipeline.js';
import { listForUser, upsertConnector, buildConnector, GUIDES, searchAllSources } from '../connectors/index.js';
import { parseTokenList } from '../connectors/base.js';
import { ManualConnector } from '../connectors/manual.js';
import { ImportConnector, parseImport } from '../connectors/aggregators.js';
import { ROLES_BY_LABEL, ROLE_CATALOGUE } from '../services/skillTaxonomy.js';
import { emailCapability, sendTestEmail } from '../connectors/emailApply.js';
import { describe as describeLlm, catalogue, testProviders } from '../services/llm.js';
import { smtpForClient, saveSmtp, saveLlmChain } from '../services/integrationStore.js';

const router = express.Router();

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

const settingsSchema = z.object({
  roles: z.array(z.string().max(120)).max(30).optional(),
  locations: z.array(z.string().max(120)).max(30).optional(),
  countries: z.array(z.string().max(80)).max(30).optional(),
  workModes: z.array(z.enum(['remote', 'hybrid', 'onsite'])).max(3).optional(),
  employmentTypes: z.array(z.enum(['full-time', 'part-time', 'contract', 'freelance', 'internship', 'temporary'])).max(6).optional(),
  minMatchScore: z.number().int().min(0).max(100).optional(),
  autoApplyThreshold: z.number().int().min(1).max(100).optional(),
  reviewThreshold: z.number().int().min(0).max(100).optional(),
  autoApplyEnabled: z.boolean().optional(),
  minSalary: z.number().int().min(0).nullable().optional(),
  currency: z.string().max(12).optional(),
  maxApplicationsPerDay: z.number().int().min(0).max(200).optional(),
  maxApplicationsPerWeek: z.number().int().min(0).max(1000).optional(),
  maxPerCompany: z.number().int().min(0).max(50).optional(),
  durationDays: z.number().int().min(0).max(365).optional(),
  cadence: z.enum(['once', 'hourly', 'daily', 'custom']).optional(),
  runsPerDay: z.number().int().min(1).max(24).optional(),
  preferRecentDays: z.number().int().min(0).max(365).optional(),
  prioritizeLowApplicants: z.boolean().optional(),
  reapplicationAllowed: z.boolean().optional(),
  requireConfirmation: z.boolean().optional(),
  notifyInApp: z.boolean().optional(),
  notifyEmail: z.boolean().optional(),
  notifyWebhookUrl: z.string().url().max(400).nullable().optional(),
  enabledConnectors: z.array(z.string().max(60)).max(40).optional(),
});

router.get(
  '/settings',
  requireAuth,
  asyncHandler(async (req, res) => {
    const settings = loadSettings(req.user.id);
    res.json({
      settings,
      roles: ROLE_CATALOGUE.map((r) => ({ id: r.id, label: r.label, group: r.group })),
    });
  })
);

router.put(
  '/settings',
  requireAuth,
  asyncHandler(async (req, res) => {
    const patch = parse(settingsSchema, req.body);
    if (patch.autoApplyThreshold !== undefined && patch.reviewThreshold !== undefined && patch.reviewThreshold > patch.autoApplyThreshold) {
      throw ApiError.badRequest('The review threshold cannot be higher than the auto-apply threshold.');
    }
    const userId = req.user.id;
    const database = db();
    const existing = database.get('SELECT * FROM user_settings WHERE user_id = ?', userId);
    const base = loadSettings(userId) || defaultSettings();
    const next = { ...base, ...patch };

    const columns = {
      roles: JSON.stringify(normaliseRoles(next.roles)),
      locations: JSON.stringify(next.locations),
      countries: JSON.stringify(next.countries),
      work_modes: JSON.stringify(next.workModes),
      employment_types: JSON.stringify(next.employmentTypes),
      min_match_score: next.minMatchScore,
      auto_apply_threshold: next.autoApplyThreshold,
      review_threshold: next.reviewThreshold,
      auto_apply_enabled: next.autoApplyEnabled ? 1 : 0,
      min_salary: next.minSalary,
      currency: next.currency,
      max_applications_per_day: next.maxApplicationsPerDay,
      max_applications_per_week: next.maxApplicationsPerWeek,
      max_per_company: next.maxPerCompany,
      duration_days: next.durationDays,
      cadence: next.cadence,
      runs_per_day: next.runsPerDay,
      prefer_recent_days: next.preferRecentDays,
      prioritize_low_applicants: next.prioritizeLowApplicants ? 1 : 0,
      reapplication_allowed: next.reapplicationAllowed ? 1 : 0,
      require_confirmation: next.requireConfirmation ? 1 : 0,
      notify_in_app: next.notifyInApp ? 1 : 0,
      notify_email: next.notifyEmail ? 1 : 0,
      notify_webhook_url: next.notifyWebhookUrl || null,
      enabled_connectors: JSON.stringify(next.enabledConnectors),
    };

    if (existing) {
      database.run(
        `UPDATE user_settings SET ${Object.keys(columns).map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE user_id = ?`,
        ...Object.values(columns),
        userId
      );
    } else {
      database.run(
        `INSERT INTO user_settings (user_id, ${Object.keys(columns).join(', ')}) VALUES (?, ${Object.keys(columns).map(() => '?').join(', ')})`,
        userId,
        ...Object.values(columns)
      );
    }

    // Keep connector enabled flags in step with settings.enabledConnectors where provided.
    if (patch.enabledConnectors) {
      for (const key of patch.enabledConnectors) {
        upsertConnector(userId, key, { enabled: true });
      }
    }

    recordActivity({ userId, level: 'info', scope: 'settings', message: 'Settings updated.', meta: { keys: Object.keys(patch) } });
    res.json({ settings: loadSettings(userId) });
  })
);

/** Maps free-text roles to catalogue entries where possible, keeping unknown ones as-is. */
function normaliseRoles(roles = []) {
  return roles.map((role) => {
    const known = ROLES_BY_LABEL.get(String(role).toLowerCase().trim());
    return known ? known.label : String(role).trim();
  }).filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * Connectors
 * ------------------------------------------------------------------ */

router.get(
  '/connectors',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      connectors: listForUser(req.user.id),
      capabilities: capabilitiesSnapshot(req.user.id),
    });
  })
);

function capabilitiesSnapshot(userId = null) {
  return {
    llm: describeLlm(userId),
    email: emailCapability(userId),
    scheduler: { durable: true, note: 'Campaign state is stored in the database, so runs continue after a restart.' },
  };
}

const connectorSchema = z.object({
  enabled: z.boolean().optional(),
  config: z.record(z.any()).optional(),
  credentials: z.record(z.string().max(2000)).optional(),
});

router.put(
  '/connectors/:key',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { key } = req.params;
    const patch = parse(connectorSchema, req.body);
    const connector = upsertConnector(req.user.id, key, patch);
    if (!connector) throw ApiError.notFound(`Unknown connector “${key}”.`);
    recordActivity({ userId: req.user.id, level: 'info', scope: 'connectors', message: `Connector ${key} updated.`, meta: { enabled: patch.enabled } });
    res.json({ connectors: listForUser(req.user.id).filter((c) => c.key === key)[0] });
  })
);

/** Tests a source without storing any jobs — proves the credentials/config work. */
router.post(
  '/connectors/:key/test',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { key } = req.params;
    const connector = buildConnector(key, { userId: req.user.id });
    if (!connector) throw ApiError.notFound(`Unknown connector “${key}”.`);
    const readiness = connector.readiness();
    if (!connector.meta.capabilities.search) {
      return res.json({
        ok: false,
        assistedOnly: true,
        readiness,
        message: `${connector.meta.name} is assisted-only by design. ${connector.meta.automationPolicy?.basis || ''}`.trim(),
      });
    }
    if (!readiness.ready) {
      return res.json({ ok: false, readiness, message: `Needs configuration: ${readiness.missing.join(', ')}.` });
    }
    try {
      const result = await connector.search({ limit: 5, roleTitles: loadSettings(req.user.id).roles });
      res.json({ ok: true, jobs: (result.jobs || []).slice(0, 5), count: result.jobs?.length ?? 0, warnings: result.warnings || [] });
    } catch (err) {
      res.json({ ok: false, message: err.message, code: err.code || 'error', required: err.required || [] });
    }
  })
);

/* ------------------------------------------------------------------ *
 * Bulk board lists: paste many tokens at once, then verify them
 * ------------------------------------------------------------------ */

const boardFields = {
  greenhouse: 'boardTokens',
  lever: 'companies',
  workable: 'subdomains',
  smartrecruiters: 'companies',
};

const bulkSchema = z.object({
  // Any of the shapes people paste: comma-separated, one per line, or a JSON array.
  text: z.string().max(200_000).optional(),
  tokens: z.array(z.string().max(120)).max(500).optional(),
  replace: z.boolean().optional(),
});

router.post(
  '/connectors/:key/boards',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { key } = req.params;
    const field = boardFields[key];
    if (!field) throw ApiError.badRequest(`${key} does not take a board list.`);
    const input = parse(bulkSchema, req.body);
    const incoming = parseTokenList(input.tokens?.length ? input.tokens : input.text || '');
    if (!incoming.length) throw ApiError.badRequest('No identifiers found in that text. Paste them comma-separated, one per line, or as a JSON array.');

    const existing = listForUser(req.user.id).find((c) => c.key === key);
    const current = parseTokenList(existing?.config?.[field] || '');
    const merged = input.replace ? incoming : [...new Set([...current, ...incoming])];

    upsertConnector(req.user.id, key, { enabled: true, config: { [field]: merged, boardOffset: 0 } });
    recordActivity({
      userId: req.user.id,
      level: 'info',
      scope: 'connectors',
      message: `${key}: board list saved (${merged.length} identifier(s), ${incoming.length} from this paste, ${merged.length - incoming.length} kept).`,
      meta: { connector: key, added: incoming.length, total: merged.length },
    });
    res.json({ ok: true, connector: key, field, added: incoming.length, total: merged.length, identifiers: merged });
  })
);

/**
 * Checks every identifier against the platform's public read API, so you know which of
 * a pasted list are real boards before a hunt wastes runs on the dead ones.
 *
 * It is deliberately gentle: a small pool of workers, a delay between requests, and an
 * outright cap, because these are third-party APIs.
 */
const verifySchema = z.object({
  limit: z.number().int().min(1).max(120).optional(),
  identifiers: z.array(z.string().max(120)).max(500).optional(),
});

const VERIFY_ENDPOINTS = {
  greenhouse: {
    field: 'boardTokens',
    url: (token) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`,
    count: (data) => (Array.isArray(data?.jobs) ? data.jobs.length : 0),
    name: (data, token) => data?.name || token,
  },
  lever: {
    field: 'companies',
    url: (slug) => `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
    count: (data) => (Array.isArray(data) ? data.length : 0),
    name: (_data, slug) => slug,
  },
  workable: {
    field: 'subdomains',
    url: (sub) => `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(sub)}?details=true`,
    count: (data) => (Array.isArray(data?.jobs) ? data.jobs.length : 0),
    name: (data, sub) => data?.name || sub,
  },
  smartrecruiters: {
    field: 'companies',
    url: (company) => `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=1`,
    count: (data) => Number(data?.totalFound ?? 0),
    name: (data, company) => data?.company?.name || company,
  },
};

router.post(
  '/connectors/:key/verify-boards',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { key } = req.params;
    const spec = VERIFY_ENDPOINTS[key];
    if (!spec) throw ApiError.badRequest(`${key} does not support board verification.`);

    const input = parse(verifySchema, req.body);
    const connector = listForUser(req.user.id).find((c) => c.key === key);
    const all = parseTokenList(input.identifiers?.length ? input.identifiers : connector?.config?.[spec.field] || '');
    if (!all.length) throw ApiError.badRequest('No identifiers to verify — save a board list for this source first.');

    const targets = all.slice(0, input.limit ?? 60);
    const results = [];
    const pool = 4;

    const { httpJson } = await import('../connectors/base.js');
    let cursor = 0;
    async function worker() {
      while (cursor < targets.length) {
        const index = cursor;
        cursor += 1;
        const token = targets[index];
        try {
          const data = await httpJson(spec.url(token), { timeoutMs: 12_000 });
          results[index] = { identifier: token, status: 'ok', jobs: spec.count(data), company: spec.name(data, token) };
        } catch (err) {
          const notFound = /404|not found/i.test(err.message || '');
          results[index] = {
            identifier: token,
            status: notFound ? 'not_found' : /network access is disabled/i.test(err.message || '') ? 'network_disabled' : 'error',
            message: err.message,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    await Promise.all(Array.from({ length: Math.min(pool, targets.length) }, worker));

    const verified = results.filter((r) => r?.status === 'ok');
    const dead = results.filter((r) => r?.status === 'not_found');
    res.json({
      ok: true,
      connector: key,
      checked: results.length,
      working: verified,
      notFound: dead.map((r) => r.identifier),
      other: results.filter((r) => r && !['ok', 'not_found'].includes(r.status)),
      remaining: Math.max(0, all.length - targets.length),
      totals: { ok: verified.length, notFound: dead.length, jobsFound: verified.reduce((sum, r) => sum + (r.jobs || 0), 0) },
    });
  })
);

/** Removes identifiers that failed verification (and optionally stops using the rest). */
const pruneSchema = z.object({ remove: z.array(z.string().max(120)).min(1).max(500) });

router.post(
  '/connectors/:key/boards/prune',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { key } = req.params;
    const field = boardFields[key];
    if (!field) throw ApiError.badRequest(`${key} does not take a board list.`);
    const { remove } = parse(pruneSchema, req.body);
    const connector = listForUser(req.user.id).find((c) => c.key === key);
    const current = parseTokenList(connector?.config?.[field] || '');
    const drop = new Set(parseTokenList(remove));
    const kept = current.filter((token) => !drop.has(token));
    upsertConnector(req.user.id, key, { config: { [field]: kept, boardOffset: 0 } });
    res.json({ ok: true, removed: current.length - kept.length, total: kept.length, identifiers: kept });
  })
);

/* ------------------------------------------------------------------ *
 * Manual: paste a job link (the compliant path for LinkedIn, Indeed, PNet …)
 * ------------------------------------------------------------------ */

const manualSchema = z.object({
  url: z.string().url().max(2000),
  title: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
  location: z.string().max(200).optional(),
  description: z.string().max(60_000).optional(),
  fetchPage: z.boolean().optional(),
  analyze: z.boolean().optional(),
});

router.post(
  '/jobs/manual',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parse(manualSchema, req.body);
    const userId = req.user.id;
    const connector = new ManualConnector({ userId, credentials: {}, config: {} });
    const { jobs, warnings, detected } = await connector.addFromUrl(input);
    if (!jobs.length) throw ApiError.badRequest('Could not build a job record from that link.');

    const { ingestJobs } = await import('../services/jobPipeline.js');
    const { inserted, duplicates } = ingestJobs(userId, jobs.map((j) => ({ ...j, sourceKey: 'manual' })));
    const jobId = inserted[0]?.id || db().get('SELECT id FROM jobs WHERE user_id = ? AND dedupe_key = ?', userId, jobs[0].dedupeKey)?.id || null;

    let match = null;
    if (input.analyze !== false && jobId) {
      const { analyzeJob } = await import('../services/analysis.js');
      match = await analyzeJob(userId, jobId);
    }

    recordActivity({
      userId,
      level: 'info',
      scope: 'manual',
      message: `Added job from link: ${jobs[0].title}${jobs[0].company ? ` — ${jobs[0].company}` : ''}`,
      meta: { detected: detected?.ats || null, duplicates },
    });

    res.status(201).json({ jobId, duplicate: duplicates > 0 && !inserted.length, warnings, detected, match });
  })
);

const importSchema = z.object({ payload: z.string().min(2).max(2_000_000) });

router.post(
  '/jobs/import',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { payload } = parse(importSchema, req.body);
    let rows;
    try {
      rows = parseImport(payload);
    } catch (err) {
      throw ApiError.badRequest(err.message);
    }
    if (!rows.length) throw ApiError.badRequest('No rows detected — make sure the file has a header row with a “title” column.');
    const connector = new ImportConnector({ userId: req.user.id, credentials: {}, config: { payload } });
    const { jobs, warnings } = await connector.search();
    const { ingestJobs } = await import('../services/jobPipeline.js');
    const { inserted, duplicates } = ingestJobs(req.user.id, jobs);
    recordActivity({ userId: req.user.id, level: 'info', scope: 'import', message: `Imported ${inserted.length} new job(s) from file (${duplicates} duplicate).` });
    res.status(201).json({ imported: inserted.length, duplicates, rows: rows.length, warnings, jobIds: inserted.map((i) => i.id) });
  })
);

/** Runs an ad-hoc search across live sources (no campaign) so you can preview results. */
router.post(
  '/sources/search',
  requireAuth,
  asyncHandler(async (req, res) => {
    const settings = loadSettings(req.user.id);
    const result = await searchAllSources(req.user.id, {
      roleTitles: settings.roles,
      keywords: settings.roles,
      locations: settings.locations,
      limit: 25,
    });
    res.json({ count: result.jobs.length, sourcesQueried: result.sourcesQueried, warnings: result.warnings, preview: result.jobs.slice(0, 10).map((j) => ({ title: j.title, company: j.company, location: j.location, source: j.sourceKey, url: j.url })) });
  })
);

/** Which client bundle the server is currently serving (stale-cache detection). */
router.get(
  '/version',
  asyncHandler(async (_req, res) => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    let client = null;
    try {
      const html = readFileSync(join(config.clientDist, 'index.html'), 'utf8');
      const match = /src="[^"]*?\/(assets\/[^"]+?\.js)"/.exec(html);
      client = match ? match[1] : null;
    } catch {
      client = null;
    }
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.json({ client, demoLogin: config.allowDemoLogin, uptimeSeconds: Math.round(process.uptime()) });
  })
);

/* ------------------------------------------------------------------ *
 * Integrations: the user's own mail account and AI provider keys
 * ------------------------------------------------------------------ */

const smtpSchema = z.object({
  host: z.string().max(200).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  user: z.string().max(320).optional(),
  pass: z.string().max(400).optional(),
  clearPass: z.boolean().optional(),
  from: z.string().max(320).optional(),
  clear: z.boolean().optional(),
});

router.get(
  '/settings/email',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ email: smtpForClient(req.user.id, config.smtp), capability: emailCapability(req.user.id) });
  })
);

router.put(
  '/settings/email',
  requireAuth,
  asyncHandler(async (req, res) => {
    const patch = parse(smtpSchema, req.body);
    saveSmtp(req.user.id, patch);
    const capability = emailCapability(req.user.id);
    recordActivity({
      userId: req.user.id,
      level: 'info',
      scope: 'settings',
      message: patch.clear ? 'Mail account disconnected.' : 'Mail account settings saved.',
      meta: { host: capability.available ? 'configured' : 'incomplete' },
    });
    res.json({ email: smtpForClient(req.user.id, config.smtp), capability });
  })
);

/** Sends one real message so the user can confirm it works before relying on it. */
router.post(
  '/settings/email/test',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { to } = req.body || {};
    const result = await sendTestEmail(req.user.id, typeof to === 'string' ? to.slice(0, 320) : undefined);
    recordActivity({
      userId: req.user.id,
      level: result.ok ? 'info' : 'warn',
      scope: 'settings',
      message: result.ok ? `Test email accepted for delivery to ${result.to}.` : `Test email failed: ${result.detail}`,
    });
    res.json(result);
  })
);

const llmSchema = z.object({
  providers: z
    .array(
      z.object({
        id: z.string().max(40),
        apiKey: z.string().max(500).optional(),
        model: z.string().max(120).optional(),
        baseUrl: z.string().max(300).optional(),
        accountId: z.string().max(120).optional(),
        enabled: z.boolean().optional(),
      })
    )
    .max(20),
});

router.get(
  '/settings/ai',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ ...catalogue(req.user.id), summary: describeLlm(req.user.id) });
  })
);

router.put(
  '/settings/ai',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { providers } = parse(llmSchema, req.body);
    saveLlmChain(req.user.id, providers);
    const summary = describeLlm(req.user.id);
    recordActivity({
      userId: req.user.id,
      level: 'info',
      scope: 'settings',
      message: summary.enabled
        ? `AI providers saved: ${summary.providers.map((p) => p.id).join(' → ')}.`
        : 'AI providers cleared — using the built-in deterministic engine.',
    });
    res.json({ ...catalogue(req.user.id), summary });
  })
);

/** Asks every configured provider to answer a one-word prompt, so bad keys are obvious. */
router.post(
  '/settings/ai/test',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await testProviders(req.user.id));
  })
);

export default router;
export { capabilitiesSnapshot, GUIDES };
