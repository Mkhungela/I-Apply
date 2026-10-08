/**
 * Email applications.
 *
 * When an advert invites applications by email ("send your CV to careers@…"), sending
 * that email is the employer's own requested mechanism — not an attempt to bypass
 * anything. This module performs that send through the SMTP account you configure.
 *
 * If SMTP is not configured it returns `requires_human` with exactly what is needed;
 * it never pretends an application was sent.
 */
import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { resolveSmtp } from '../services/integrationStore.js';
import { logger } from '../lib/logger.js';

const log = logger('email-apply');

/**
 * Builds a transport for this user's mail account.
 *
 * The user's own settings win; the server environment is the fallback, so a
 * single-tenant deployment can keep everything in `.env`.
 */
export function smtpTransport(userId = null) {
  const smtp = resolveSmtp(userId, config.smtp);
  if (!smtp.configured) return null;
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: !!smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
  });
}

/** @returns {{available:boolean, from?:string, detail:string, source?:string, requiredEnv?:string[]}} */
export function emailCapability(userId = null) {
  const smtp = resolveSmtp(userId, config.smtp);
  if (smtp.configured) {
    return {
      available: true,
      from: smtp.from || smtp.user,
      source: smtp.source,
      detail:
        smtp.source === 'account'
          ? `Sending as ${smtp.from || smtp.user} from the mail account saved in the app.`
          : `Sending as ${smtp.from || smtp.user} from the server's SMTP configuration.`,
    };
  }
  return {
    available: false,
    source: 'none',
    detail:
      'No mail account is connected, so applications to adverts that ask for an email can be prepared but not sent. Add your email address and an app password under Settings → Email, or submit the prepared email yourself.',
    requiredEnv: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'],
  };
}

/**
 * Sends a test message so the user can confirm their settings before relying on them.
 * Returns a plain success/failure answer — never a claim that something was delivered.
 */
export async function sendTestEmail(userId, to) {
  const transport = smtpTransport(userId);
  if (!transport) {
    return { ok: false, detail: 'No mail account configured yet. Enter your email address and app password first.' };
  }
  const smtp = resolveSmtp(userId, config.smtp);
  const from = smtp.from || smtp.user;
  try {
    const info = await transport.sendMail({
      from,
      to: to || smtp.user,
      subject: 'AI Job Hunter — test email',
      text: [
        'Your mail account is connected.',
        '',
        'AI Job Hunter can now send applications for adverts that ask you to email your CV,',
        'and will record the mail server\u2019s acceptance as the confirmation on those applications.',
        '',
        'Developed by Lulamile Mkhungela.',
      ].join('\n'),
    });
    return { ok: true, messageId: info.messageId, accepted: info.accepted || [], to: to || smtp.user, from };
  } catch (err) {
    // The common Gmail failure is using the account password instead of an app password.
    const hint = /invalid login|535|username and password not accepted/i.test(err.message)
      ? ' Google rejects normal account passwords: create a 16-character app password at myaccount.google.com/apppasswords (2-Step Verification must be on).'
      : '';
    return { ok: false, detail: `${err.message}.${hint}`, code: err.code || null };
  }
}

/**
 * @param {{ job: object, candidate: {name:string,email:string,phone?:string}, coverLetterText: string, answers: Array<{question:string,answer:string}>, attachments: Array<{path:string,filename:string}> }} pkg
 * @returns {Promise<{status:string, mode:string, confirmation?:object, detail:string}>}
 */
export async function submitByEmail(pkg) {
  const to = pkg.job.applyEmail || pkg.job.apply?.email;
  if (!to) return { status: 'failed', mode: 'email', detail: 'No application email address found on the advert.' };

  const transport = smtpTransport(pkg.userId);
  if (!transport) {
    return {
      status: 'requires_human',
      mode: 'assisted',
      detail: emailCapability(pkg.userId).detail,
      handoff: {
        url: `mailto:${to}?subject=${encodeURIComponent(`Application: ${pkg.job.title}`)}`,
        steps: [
          `Open the pre-filled email to ${to}.`,
          'The cover letter text and answers are on this application record — paste them in.',
          'Attach the tailored CV PDF (download it from this record).',
          'Mark the application as “Applied” afterwards.',
        ],
      },
    };
  }

  const answerBlock = (pkg.answers || [])
    .filter((a) => a.answer)
    .map((a) => `${a.question}\n${a.answer}`)
    .join('\n\n');

  const body = [
    pkg.coverLetterText || '',
    answerBlock ? `\n\n---\nAdditional information\n\n${answerBlock}` : '',
    `\n\n---\n${pkg.candidate.name || ''}\n${pkg.candidate.email || ''}${pkg.candidate.phone ? ` • ${pkg.candidate.phone}` : ''}`,
  ].join('');

  const sender = resolveSmtp(pkg.userId, config.smtp);
  try {
    const info = await transport.sendMail({
      from: sender.from || sender.user,
      to,
      replyTo: pkg.candidate.email,
      subject: `Application: ${pkg.job.title}${pkg.candidate.name ? ` — ${pkg.candidate.name}` : ''}`,
      text: body,
      attachments: pkg.attachments || [],
    });
    log.info('application email sent', { to, messageId: info.messageId });
    return {
      status: 'submitted',
      mode: 'email',
      confirmation: { source: 'smtp', messageId: info.messageId, to, accepted: info.accepted, receivedAt: new Date().toISOString() },
      detail: `Email sent to ${to} from ${sender.from || sender.user} — the advert asked for applications by email, and the mail server accepted the message.`,
    };
  } catch (err) {
    log.warn(`application email failed: ${err.message}`);
    return { status: 'failed', mode: 'email', detail: `SMTP rejected the message: ${err.message}` };
  }
}

/** Notification email (used by the notification service when email notifications are on). */
export async function sendNotificationEmail({ to, subject, text, userId = null }) {
  const transport = smtpTransport(userId);
  if (!transport || !to) return { sent: false, detail: emailCapability(userId).detail };
  const smtp = resolveSmtp(userId, config.smtp);
  try {
    const info = await transport.sendMail({ from: smtp.from || smtp.user, to, subject, text });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    return { sent: false, detail: err.message };
  }
}
