/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
/**
 * Notification service — in-app, email and webhook.
 *
 * Events: high-quality job found, application submitted, human action required,
 * CAPTCHA/MFA or login expiry encountered, platform blocked automation, interview
 * detected, scheduled run finished.
 */
import { db } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { sendNotificationEmail } from '../connectors/emailApply.js';

const log = logger('notifications');

export const NOTIFICATION_TYPES = {
  HIGH_MATCH_JOB: 'high_match_job',
  APPLICATION_SUBMITTED: 'application_submitted',
  HUMAN_ACTION_REQUIRED: 'human_action_required',
  CAPTCHA_ENCOUNTERED: 'captcha_encountered',
  LOGIN_EXPIRED: 'login_expired',
  PLATFORM_BLOCKED: 'platform_blocked',
  INTERVIEW_DETECTED: 'interview_detected',
  RUN_FINISHED: 'run_finished',
  CAMPAIGN_STARTED: 'campaign_started',
  CAMPAIGN_STOPPED: 'campaign_stopped',
  POLICY_SKIPPED: 'policy_skipped',
  SYSTEM: 'system',
};

const LEVELS = { [NOTIFICATION_TYPES.HUMAN_ACTION_REQUIRED]: 'action', [NOTIFICATION_TYPES.CAPTCHA_ENCOUNTERED]: 'action', [NOTIFICATION_TYPES.LOGIN_EXPIRED]: 'warning', [NOTIFICATION_TYPES.PLATFORM_BLOCKED]: 'warning', [NOTIFICATION_TYPES.APPLICATION_SUBMITTED]: 'success', [NOTIFICATION_TYPES.INTERVIEW_DETECTED]: 'success', [NOTIFICATION_TYPES.HIGH_MATCH_JOB]: 'info', [NOTIFICATION_TYPES.RUN_FINISHED]: 'info', [NOTIFICATION_TYPES.POLICY_SKIPPED]: 'info', [NOTIFICATION_TYPES.SYSTEM]: 'info' };

/**
 * @param {object} params
 * @param {number} params.userId
 * @param {string} params.type
 * @param {string} params.title
 * @param {string} [params.body]
 * @param {number} [params.jobId]
 * @param {number} [params.applicationId]
 * @param {number} [params.campaignId]
 * @param {boolean} [params.email] force email even if the user disabled it
 */
export async function notify({ userId, type, title, body = null, jobId = null, applicationId = null, campaignId = null, email = false }) {
  const database = db();
  const level = LEVELS[type] || 'info';
  const info = database.run(
    `INSERT INTO notifications (user_id, type, level, title, body, job_id, application_id, campaign_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    userId,
    type,
    level,
    title,
    body,
    jobId,
    applicationId,
    campaignId
  );

  const settings = database.get('SELECT notify_email, notify_webhook_url, notify_in_app FROM user_settings WHERE user_id = ?', userId);
  const wantsEmail = email || !!settings?.notify_email;
  if (wantsEmail) {
    const user = database.get('SELECT email FROM users WHERE id = ?', userId);
    if (user?.email) {
      const result = await sendNotificationEmail({ to: user.email, subject: `[AI Job Hunter] ${title}`, text: `${body || title}\n\n— AI Job Hunter` });
      if (!result.sent) log.debug(`email notification not sent: ${result.detail}`);
    }
  }

  if (settings?.notify_webhook_url) {
    void postWebhook(settings.notify_webhook_url, { type, level, title, body, jobId, applicationId, campaignId, at: new Date().toISOString() });
  }
  return info;
}

async function postWebhook(url, payload) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
    clearTimeout(timer);
  } catch (err) {
    log.debug(`webhook failed: ${err.message}`);
  }
}

export function listNotifications(userId, { unreadOnly = false, limit = 50 } = {}) {
  const where = unreadOnly ? 'AND read_at IS NULL' : '';
  return db().all(
    `SELECT * FROM notifications WHERE user_id = ? ${where} ORDER BY created_at DESC LIMIT ?`,
    userId,
    Math.min(Number(limit) || 50, 200)
  );
}

export function unreadCount(userId) {
  const row = db().get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL', userId);
  return row?.c ?? 0;
}

export function markRead(userId, ids = []) {
  const database = db();
  if (!ids.length) {
    database.run('UPDATE notifications SET read_at = datetime(\'now\') WHERE user_id = ? AND read_at IS NULL', userId);
    return { updated: 'all' };
  }
  for (const id of ids) {
    database.run("UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ?", id, userId);
  }
  return { updated: ids.length };
}
