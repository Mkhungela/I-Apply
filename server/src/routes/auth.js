/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
import express from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { ApiError, asyncHandler, parse } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { signSession, setSessionCookie, clearSessionCookie } from '../lib/session.js';
import { seedDefaultConnectors } from '../connectors/index.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { config } from '../config.js';
import { notify, NOTIFICATION_TYPES } from '../services/notifications.js';
import { recordActivity } from '../services/jobPipeline.js';
import { log } from '../lib/logger.js';
import fs from 'node:fs';

const router = express.Router();

/**
 * The session is issued twice, on purpose:
 *
 *  • an httpOnly cookie — the safer default, and what a normal deployment uses; and
 *  • a signed token in the response body — because browsers block or drop cookies
 *    when the app is embedded in a third-party frame (preview panes, some corporate
 *    portals). Without it the app would authenticate and then immediately look
 *    signed out. The client stores the token and sends it as `Authorization: Bearer`.
 *
 * Both are the same signed JWT and both are verified by the same middleware, so
 * revoking a session (token_version) invalidates the two of them at once.
 */
function sessionPayload(user) {
  return { token: signSession(user), expiresInDays: config.sessionTtlDays };
}

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name };
}

const credentialsSchema = z.object({
  email: z.string().email().max(180),
  password: z.string().min(8).max(200),
  name: z.string().max(120).optional(),
});

router.post(
  '/register',
  rateLimit({ key: 'register', windowMs: 60_000, max: 8 }),
  asyncHandler(async (req, res) => {
    if (!config.allowRegistration) throw ApiError.forbidden('Registration is disabled on this instance.');
    const { email, password, name } = parse(credentialsSchema, req.body);
    const existing = db().get('SELECT id FROM users WHERE email = ?', email);
    if (existing) throw ApiError.conflict('An account with that email already exists.');
    const info = db().run('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)', email, await hashPassword(password), name || null);
    const userId = Number(info.lastInsertRowid);
    db().run('INSERT INTO user_settings (user_id) VALUES (?)', userId);
    // A new account starts with the curated public boards, so the first hunt reaches real
    // employers rather than searching nothing. The Job sources panel can change or prune them.
    seedDefaultConnectors(userId);
    const user = db().get('SELECT id, email, name, token_version FROM users WHERE id = ?', userId);
    setSessionCookie(res, signSession(user));
    res.status(201).json({ user: publicUser(user), ...sessionPayload(user) });
  })
);

router.post(
  '/login',
  rateLimit({ key: 'login', windowMs: 60_000, max: 12, message: 'Too many sign-in attempts — please wait a minute.' }),
  asyncHandler(async (req, res) => {
    const { email, password } = parse(credentialsSchema.omit({ name: true }), req.body);
    const user = db().get('SELECT * FROM users WHERE email = ?', email);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw ApiError.unauthorized('Incorrect email or password.');
    }
    setSessionCookie(res, signSession(user));
    res.json({ user: publicUser(user), ...sessionPayload(user) });
  })
);

/**
 * One-click demo session (development convenience).
 * Enabled unless NODE_ENV=production or ALLOW_DEMO_LOGIN=false. The account only ever
 * holds clearly-labelled sample data, and demo listings are never submitted anywhere.
 */
router.post(
  '/demo-login',
  rateLimit({ key: 'demo-login', windowMs: 60_000, max: 30, message: 'Too many demo sessions in a row — wait a moment and try again.' }),
  asyncHandler(async (_req, res) => {
    const allowed = config.allowDemoLogin;
    if (!allowed) throw ApiError.forbidden('Demo login is disabled on this instance. Create an account instead.');
    const { ensureDemoUser } = await import('../services/demoSeed.js');
    const { userId } = await ensureDemoUser();
    const user = db().get('SELECT id, email, name, token_version FROM users WHERE id = ?', userId);
    setSessionCookie(res, signSession(user));
    res.json({ user: publicUser(user), demo: true, ...sessionPayload(user) });
  })
);

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const { resolveSession, clearSessionCookie } = await import('../lib/session.js');
    const session = resolveSession(req);
    if (!session) {
      if (req.cookies?.ajh_session) clearSessionCookie(res); // drop a dead cookie
      return res.json({ user: null });
    }
    const payload = session.payload;
    const user = db().get('SELECT id, email, name, token_version, created_at FROM users WHERE id = ?', payload.sub);
    if (!user) return res.json({ user: null });
    if ((user.token_version ?? 1) !== (payload.tv ?? 1)) return res.json({ user: null });
    res.json({ user: publicUser(user) });
  })
);

/** Revokes all sessions (bumps token_version). */
router.post(
  '/logout-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    db().run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', req.user.id);
    clearSessionCookie(res);
    res.json({ ok: true });
  })
);

/* ------------------------------------------------------------------ *
 * Privacy: export and deletion
 * ------------------------------------------------------------------ */

router.get(
  '/export',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const database = db();
    const payload = {
      exportedAt: new Date().toISOString(),
      user: database.get('SELECT id, email, name, created_at FROM users WHERE id = ?', userId),
      profile: database.get('SELECT * FROM profiles WHERE user_id = ?', userId) || null,
      settings: database.get('SELECT * FROM user_settings WHERE user_id = ?', userId) || null,
      cvs: database.all('SELECT id, filename, created_at, parsed FROM cvs WHERE user_id = ?', userId).map((c) => ({ ...c, parsed: safe(c.parsed) })),
      applications: database.all('SELECT * FROM applications WHERE user_id = ?', userId),
      jobs: database.all('SELECT id, title, company, url, posted_at, discovered_at FROM jobs WHERE user_id = ?', userId),
      notifications: database.all('SELECT * FROM notifications WHERE user_id = ?', userId),
      activity: database.all('SELECT * FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 1000', userId),
    };
    res.setHeader('content-disposition', `attachment; filename="ai-job-hunter-export-${userId}.json"`);
    res.setHeader('content-type', 'application/json');
    res.send(JSON.stringify(payload, null, 2));
  })
);

/** Deletes selected data, or the whole account, including CV files on disk. */
router.post(
  '/delete',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { scope } = parse(z.object({ scope: z.enum(['cv', 'profile', 'history', 'account']) }), req.body);
    const userId = req.user.id;
    const database = db();
    const files = database.all('SELECT storage_path FROM cvs WHERE user_id = ?', userId);

    if (scope === 'cv' || scope === 'profile' || scope === 'account') {
      for (const file of files) {
        try {
          if (file.storage_path && fs.existsSync(file.storage_path)) fs.unlinkSync(file.storage_path);
        } catch (err) {
          log.warn(`could not delete CV file ${file.storage_path}: ${err.message}`);
        }
      }
      database.run('DELETE FROM cvs WHERE user_id = ?', userId);
    }
    if (scope === 'profile' || scope === 'account') {
      database.run('DELETE FROM profiles WHERE user_id = ?', userId);
      database.run('DELETE FROM matches WHERE user_id = ?', userId);
    }
    if (scope === 'history' || scope === 'account') {
      database.run('DELETE FROM application_events WHERE application_id IN (SELECT id FROM applications WHERE user_id = ?)', userId);
      database.run('DELETE FROM applications WHERE user_id = ?', userId);
      database.run('DELETE FROM jobs WHERE user_id = ?', userId);
      database.run('DELETE FROM campaign_runs WHERE user_id = ?', userId);
      database.run('DELETE FROM campaigns WHERE user_id = ?', userId);
      database.run('DELETE FROM notifications WHERE user_id = ?', userId);
      database.run('DELETE FROM activity_log WHERE user_id = ?', userId);
      database.run('UPDATE connectors SET credentials = NULL, status = \'configured\' WHERE user_id = ?', userId);
    }
    if (scope === 'account') {
      database.run('DELETE FROM users WHERE id = ?', userId);
      clearSessionCookie(res);
    } else {
      await notify({
        userId,
        type: NOTIFICATION_TYPES.SYSTEM,
        title: `Deleted: ${scope}`,
        body: 'Your data was removed as requested. Nothing else was kept.',
      });
      recordActivity({ userId, level: 'info', scope: 'privacy', message: `User deleted ${scope} data.` });
    }
    res.json({ ok: true, scope });
  })
);

function safe(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export default router;
