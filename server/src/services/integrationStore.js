/**
 * Per-user integration secrets (SMTP account, AI provider keys).
 *
 * These are the credentials the user enters in the app rather than in the server
 * environment. They are encrypted at rest with AES-256-GCM (the same envelope used for
 * connector credentials) and are never returned to the browser — the API only ever
 * reports whether a secret is set, plus a masked hint.
 *
 * Environment variables still work, and act as the fallback when a user has not stored
 * their own. That means a single-tenant deployment can keep using `.env` alone.
 *
 * Developed by Lulamile Mkhungela.
 */
import { db } from '../db/index.js';
import { encryptJson, decryptJson } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';

const log = logger('integrations');

function ensureRow(userId) {
  const database = db();
  const row = database.get('SELECT * FROM user_integrations WHERE user_id = ?', userId);
  if (row) return row;
  database.run('INSERT INTO user_integrations (user_id) VALUES (?)', userId);
  return database.get('SELECT * FROM user_integrations WHERE user_id = ?', userId);
}

/* ------------------------------------------------------------------ *
 * SMTP (Google / Workspace / Microsoft / any provider)
 * ------------------------------------------------------------------ */

/**
 * Common providers, so the user picks one and only supplies an address and a password.
 * Passwords for the big providers must be *app passwords* — normal account passwords are
 * rejected once 2-Step Verification is on, which is why each entry says so explicitly.
 */
export const SMTP_PRESETS = [
  {
    id: 'gmail',
    name: 'Gmail / Google account',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    userHint: 'your full Gmail address, e.g. you@gmail.com',
    passwordLabel: 'Google app password (16 characters)',
    passwordHelp:
      'Create it at myaccount.google.com/apppasswords. Turn on 2-Step Verification first, or the page will not offer app passwords. Your normal Gmail password will not work here.',
    fromHint: 'Usually the same as your address, optionally as “Your Name <you@gmail.com>”.',
  },
  {
    id: 'workspace',
    name: 'Google Workspace (your own domain)',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    userHint: 'your full Workspace address, e.g. name@yourcompany.com',
    passwordLabel: 'Google app password (16 characters)',
    passwordHelp:
      'Same steps as Gmail — myaccount.google.com/apppasswords. If your administrator has disabled app passwords, use "Other SMTP" with your provider’s details instead.',
    fromHint: 'Usually your Workspace address, optionally as “Your Name <name@yourcompany.com>”.',
  },
  {
    id: 'outlook',
    name: 'Outlook / Microsoft 365',
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    userHint: 'your full Microsoft address',
    passwordLabel: 'Password or app password',
    passwordHelp:
      'Microsoft frequently blocks basic SMTP authentication. If it fails, ask your administrator to enable SMTP AUTH, or use an app password if your account has MFA.',
    fromHint: 'Usually the same as your address.',
  },
  {
    id: 'zoho',
    name: 'Zoho Mail',
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    userHint: 'your full Zoho address',
    passwordLabel: 'App-specific password',
    passwordHelp: 'Create one in Zoho → Security → App Passwords.',
    fromHint: 'Usually the same as your address.',
  },
  {
    id: 'custom',
    name: 'Other SMTP server',
    host: '',
    port: 587,
    secure: false,
    userHint: 'the username your mail server expects',
    passwordLabel: 'Password',
    passwordHelp: 'Whatever your mail provider gives you.',
    fromHint: 'The address recipients will see.',
  },
];

/** Resolves the SMTP settings to use: the user's own if saved, otherwise the environment. */
export function resolveSmtp(userId, envSmtp) {
  const stored = userId ? decryptJson(ensureRow(userId)?.smtp) : {};
  const merged = {
    host: stored.host || envSmtp.host,
    port: stored.port || envSmtp.port,
    secure: stored.secure ?? envSmtp.secure,
    user: stored.user || envSmtp.user,
    pass: stored.pass || envSmtp.pass,
    from: stored.from || envSmtp.from || stored.user || envSmtp.user,
  };
  const configured = !!(merged.host && (merged.user || merged.pass));
  return {
    ...merged,
    configured,
    // Which layer supplied it matters for the UI: "saved in the app" vs "from .env".
    source: stored.host ? 'account' : envSmtp.host ? 'environment' : 'none',
  };
}

/** What the browser may see: everything except the password. */
export function smtpForClient(userId, envSmtp) {
  const resolved = resolveSmtp(userId, envSmtp);
  const stored = userId ? decryptJson(ensureRow(userId)?.smtp) : {};
  return {
    host: resolved.host || '',
    port: resolved.port || 587,
    secure: !!resolved.secure,
    user: resolved.user || '',
    from: resolved.from || '',
    configured: resolved.configured,
    source: resolved.source,
    passwordSet: !!stored.pass || !!envSmtp.pass,
    presets: SMTP_PRESETS,
  };
}

/** Saves or clears the user's SMTP settings. Passing an empty password keeps the stored one. */
export function saveSmtp(userId, patch) {
  const row = ensureRow(userId);
  const current = decryptJson(row.smtp);
  const next = { ...current };
  for (const key of ['host', 'user', 'from']) {
    if (patch[key] !== undefined) next[key] = String(patch[key] || '').trim();
  }
  if (patch.port !== undefined) next.port = Number(patch.port) || 587;
  if (patch.secure !== undefined) next.secure = !!patch.secure;
  // A blank password means "keep the one already stored" — the settings form shows an
  // empty box for a saved credential and says so. Removing it requires clearPass.
  if (patch.pass) next.pass = String(patch.pass);
  if (patch.clearPass) delete next.pass;
  if (patch.clear) {
    db().run('UPDATE user_integrations SET smtp = NULL, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE user_id = ?', userId);
    return;
  }
  db().run(
    "UPDATE user_integrations SET smtp = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ?",
    encryptJson(next),
    userId
  );
  log.info(`SMTP settings saved for user ${userId}`, { host: next.host || null });
}

/* ------------------------------------------------------------------ *
 * AI providers (a prioritised list, tried in order)
 * ------------------------------------------------------------------ */

/**
 * Reads the user's provider list, decrypted. Each entry is
 * `{ id, apiKey, model, baseUrl?, accountId?, enabled }`.
 */
export function loadLlmChain(userId) {
  if (!userId) return [];
  const raw = decryptJson(ensureRow(userId)?.llm);
  const list = Array.isArray(raw?.providers) ? raw.providers : [];
  return list
    .filter((p) => p && p.id)
    .map((p) => ({
      id: String(p.id),
      apiKey: p.apiKey ? String(p.apiKey) : '',
      model: p.model ? String(p.model) : '',
      baseUrl: p.baseUrl ? String(p.baseUrl) : '',
      accountId: p.accountId ? String(p.accountId) : '',
      enabled: p.enabled !== false,
    }));
}

/** Replaces the stored list. An entry without a key keeps whatever was stored before. */
export function saveLlmChain(userId, providers) {
  ensureRow(userId);
  const previous = new Map(loadLlmChain(userId).map((p) => [p.id, p]));
  const next = (Array.isArray(providers) ? providers : [])
    .filter((p) => p && p.id)
    .map((p) => {
      const before = previous.get(String(p.id)) || {};
      const incomingKey = p.apiKey === undefined ? before.apiKey : String(p.apiKey || '');
      return {
        id: String(p.id),
        apiKey: incomingKey || '',
        model: String(p.model ?? before.model ?? ''),
        baseUrl: String(p.baseUrl ?? before.baseUrl ?? ''),
        accountId: String(p.accountId ?? before.accountId ?? ''),
        enabled: p.enabled === undefined ? before.enabled !== false : p.enabled !== false,
      };
    })
    .filter((p) => p.apiKey || previous.has(p.id));
  db().run(
    "UPDATE user_integrations SET llm = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ?",
    encryptJson({ providers: next }),
    userId
  );
  log.info(`AI provider list saved for user ${userId}`, { count: next.filter((p) => p.apiKey).length });
}

/** What the browser may see: the list with keys masked, never the keys themselves. */
export function llmForClient(userId, envSummary) {
  const chain = loadLlmChain(userId);
  return {
    providers: chain.map((p) => ({
      ...p,
      apiKey: undefined,
      keySet: !!p.apiKey,
      keyMasked: p.apiKey ? `${p.apiKey.slice(0, 4)}…${p.apiKey.slice(-4)}` : '',
    })),
    active: chain.filter((p) => p.enabled && p.apiKey).map((p) => p.id),
    environment: envSummary,
  };
}
