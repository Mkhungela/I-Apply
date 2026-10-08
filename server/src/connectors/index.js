/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
/**
 * Connector registry.
 *
 * Single place that knows about every job source: which can search, which can
 * submit automatically, and which are assisted-only for policy reasons.
 */
import { GreenhouseConnector, LeverConnector, WorkableConnector, SmartRecruitersConnector } from './ats.js';
import { RemotiveConnector, ArbeitnowConnector, RemoteOkConnector, RssConnector, ImportConnector } from './aggregators.js';
import { ManualConnector } from './manual.js';
import { GuideConnector, GUIDES, guideMeta } from './guides.js';
import { DEFAULT_BOARD_LISTS, defaultConfigFor } from './defaultBoards.js';
import { db } from '../db/index.js';
import { decryptJson, encryptJson, maskSecret } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';

const seedLog = logger('connectors');

export const CONNECTOR_CLASSES = [
  GreenhouseConnector,
  LeverConnector,
  WorkableConnector,
  SmartRecruitersConnector,
  RemotiveConnector,
  ArbeitnowConnector,
  RemoteOkConnector,
  RssConnector,
  ImportConnector,
  ManualConnector,
  ...GUIDES.map((g) => GuideConnector.for(g)),
];

const BY_KEY = new Map(CONNECTOR_CLASSES.map((C) => [C.meta.key, C]));

/** Which connectors can be scheduled to search automatically. */
export const SEARCHABLE_KEYS = CONNECTOR_CLASSES.filter((C) => C.meta.capabilities.search).map((C) => C.meta.key);

export function getConnectorClass(key) {
  return BY_KEY.get(key) || null;
}

export function listDefinitions() {
  return CONNECTOR_CLASSES.map((C) => ({
    ...C.meta,
    searchable: !!C.meta.capabilities.search,
    autoApply: !!C.meta.capabilities.autoApply,
    assistedOnly: !C.meta.capabilities.search,
  }));
}

/** Builds a live connector instance for a user, decrypting stored credentials. */
export function buildConnector(key, { userId, row = null } = {}) {
  const C = getConnectorClass(key);
  if (!C) return null;
  const dbRow = row || db().get('SELECT * FROM connectors WHERE user_id = ? AND key = ?', userId, key);
  const credentials = decryptJson(dbRow?.credentials);
  // parseConfig, not a spread: the column is JSON text, and spreading a string would
  // give the connector a map of single characters instead of its real configuration.
  const config = parseConfig(dbRow?.config);
  return new C({ userId, credentials, config });
}

/** State of every connector for a user: definition + their configuration + readiness. */
export function listForUser(userId) {
  const rows = db().all('SELECT * FROM connectors WHERE user_id = ?', userId);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return listDefinitions().map((def) => {
    const row = byKey.get(def.key) || null;
    const connector = buildConnector(def.key, { userId, row });
    const readiness = connector.readiness();
    return {
      ...def,
      enabled: row ? !!row.enabled : !!def.defaultEnabled && def.searchable === false ? true : false,
      configured: !!row,
      config: publicConfig(def, row?.config || {}),
      credentials: (def.credentials || []).map((c) => ({
        ...c,
        supplied: !!decryptJson(row?.credentials)?.[c.name],
        masked: maskSecret(decryptJson(row?.credentials)?.[c.name] || ''),
      })),
      status: row?.status || 'not_configured',
      lastSyncAt: row?.last_sync_at || null,
      lastError: row?.last_error || null,
      readiness,
    };
  });
}

/** Config that is safe to return to the browser (payloads can be large/secret-ish). */
/** Parses a config column that may be a JSON string, an object, or null. */
export function parseConfig(value) {
  if (!value) return {};
  if (typeof value === 'object') return { ...value };
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function publicConfig(def, config) {
  const out = parseConfig(config);
  if (def.key === 'import' && out.payload) out.payload = `${String(out.payload).slice(0, 200)}… (${String(out.payload).length} characters stored)`;
  return out;
}

export function upsertConnector(userId, key, { enabled, config, credentials } = {}) {
  const C = getConnectorClass(key);
  if (!C) return null;
  const database = db();
  const existing = database.get('SELECT * FROM connectors WHERE user_id = ? AND key = ?', userId, key);
  // SQLite hands back the JSON column as text. Spreading a string would turn it into
  // a map of single characters ("0","1","2"…), silently corrupting every saved config,
  // so it is parsed here first.
  const currentConfig = parseConfig(existing?.config);
  const nextConfig = config === undefined ? currentConfig : { ...currentConfig, ...config };
  let nextCredentials = existing?.credentials || null;
  if (credentials) {
    const current = decryptJson(existing?.credentials);
    const merged = { ...current, ...credentials };
    for (const [k, v] of Object.entries(merged)) if (v === null || v === '' || v === undefined) delete merged[k];
    nextCredentials = Object.keys(merged).length ? encryptJson(merged) : null;
  }

  if (existing) {
    database.run(
      'UPDATE connectors SET enabled = ?, config = ?, credentials = ?, status = ? WHERE id = ?',
      enabled === undefined ? existing.enabled : enabled ? 1 : 0,
      JSON.stringify(nextConfig),
      nextCredentials,
      existing.status === 'unknown' ? 'configured' : existing.status,
      existing.id
    );
  } else {
    database.run(
      'INSERT INTO connectors (user_id, key, enabled, config, credentials, status) VALUES (?, ?, ?, ?, ?, ?)',
      userId,
      key,
      enabled ? 1 : 0,
      JSON.stringify(nextConfig),
      nextCredentials,
      'configured'
    );
  }
  return buildConnector(key, { userId });
}

export function recordConnectorRun(userId, key, { status, error = null }) {
  const database = db();
  const row = database.get('SELECT id FROM connectors WHERE user_id = ? AND key = ?', userId, key);
  if (row) {
    database.run('UPDATE connectors SET status = ?, last_sync_at = ?, last_error = ? WHERE id = ?', status, new Date().toISOString(), error, row.id);
  }
}

/**
 * Gives an account the curated default boards for any source it has not configured yet.
 *
 * Called when an account is created, and again before a search — so an account that
 * predates this list, or one whose owner has never opened the Job sources panel, still
 * reaches real boards on its first hunt instead of searching nothing.
 *
 * It never touches a source the user has a row for. An empty list saved on purpose stays
 * empty; deleting the row is what restores the default.
 */
export function seedDefaultConnectors(userId) {
  const database = db();
  const seeded = [];
  for (const key of Object.keys(DEFAULT_BOARD_LISTS)) {
    const config = defaultConfigFor(key);
    if (!config) continue;
    const existing = database.get('SELECT id FROM connectors WHERE user_id = ? AND key = ?', userId, key);
    if (existing) continue;
    database.run(
      'INSERT INTO connectors (user_id, key, enabled, config, credentials, status) VALUES (?, ?, 1, ?, NULL, ?)',
      userId,
      key,
      JSON.stringify(config),
      'configured'
    );
    seeded.push(key);
  }
  if (seeded.length) seedLog.info(`Added the default boards for ${seeded.join(', ')}`);
  return seeded;
}

/**
 * Runs a search across the enabled, searchable connectors for a user.
 * Never throws for a single failing source — failures are collected as warnings.
 */
export async function searchAllSources(userId, query) {
  try {
    seedDefaultConnectors(userId);
  } catch (err) {
    // Searching matters more than seeding; a failure here must not stop the hunt.
    seedLog.warn(`Could not add the default boards: ${err.message}`);
  }
  const rows = db().all('SELECT * FROM connectors WHERE user_id = ? AND enabled = 1', userId);
  const enabledKeys = new Set(rows.map((r) => r.key));
  const targets = CONNECTOR_CLASSES.filter((C) => C.meta.capabilities.search && enabledKeys.has(C.meta.key));

  // Sources that need no configuration at all are always worth trying.
  for (const C of CONNECTOR_CLASSES) {
    if (C.meta.capabilities.search && C.meta.credentials.length === 0 && (C.meta.configuration || []).length === 0) {
      enabledKeys.add(C.meta.key);
    }
  }
  const finalTargets = CONNECTOR_CLASSES.filter((C) => C.meta.capabilities.search && enabledKeys.has(C.meta.key));

  const results = [];
  const warnings = [];
  for (const C of finalTargets.length ? finalTargets : targets) {
    const connector = buildConnector(C.meta.key, { userId });
    const readiness = connector.readiness();
    if (!readiness.ready) {
      warnings.push(`${C.meta.name}: needs configuration (${readiness.missing.join(', ')}) — see the Connectors tab for what is required.`);
      continue;
    }
    try {
      const result = await connector.search(query);
      results.push(...(result.jobs || []));
      (result.warnings || []).forEach((w) => warnings.push(`${C.meta.name}: ${w}`));
      recordConnectorRun(userId, C.meta.key, { status: 'ok' });
    } catch (err) {
      warnings.push(`${C.meta.name}: ${err.message}`);
      recordConnectorRun(userId, C.meta.key, { status: err.code || 'error', error: err.message });
    }
  }
  return { jobs: results, warnings: collapseWarnings(warnings), sourcesQueried: finalTargets.map((C) => C.meta.key) };
}

/** Picks the right connector/route for submitting an application to a specific job. */
export function resolveApplyRoute(job) {
  if (job.applyEmail || job.apply?.mode === 'email') return { mode: 'email', connector: null, email: job.applyEmail || job.apply?.email };
  const sourceClass = getConnectorClass(job.sourceKey);
  if (sourceClass?.meta.capabilities.autoApply && job.apply?.mode === 'api_apply') {
    return { mode: 'api_apply', connector: job.sourceKey, endpoint: job.apply?.endpoint };
  }
  if (job.apply?.mode === 'api_apply') return { mode: 'api_apply', connector: job.sourceKey, endpoint: job.apply?.endpoint };
  return { mode: 'assisted', connector: job.sourceKey };
}

export { GUIDES, guideMeta, ManualConnector, GuideConnector };

/**
 * Collapses the same complaint repeated once per board into a single line.
 *
 * A 44-board list against a disabled-network host would otherwise produce 44 identical
 * warnings naming the same reason — one line saying so, with the boards listed, tells the
 * user exactly the same thing and stays readable.
 */
export function collapseWarnings(warnings) {
  const groups = new Map();
  const out = [];
  for (const warning of warnings) {
    const match = warning.match(/^(.*?)\s*[“"]([^”"]+)[”"]\s*:\s*(.+)$/);
    if (!match) {
      out.push(warning);
      continue;
    }
    const [, prefix, subject, reason] = match;
    const key = `${prefix}::${reason}`;
    if (!groups.has(key)) {
      groups.set(key, { prefix, reason, subjects: [], index: out.length });
      out.push(null);
    }
    groups.get(key).subjects.push(subject);
  }
  for (const group of groups.values()) {
    const list = group.subjects.length <= 6
      ? group.subjects.join(', ')
      : `${group.subjects.slice(0, 4).join(', ')} and ${group.subjects.length - 4} more`;
    out[group.index] = `${group.prefix} ${group.subjects.length} item(s) — ${list}: ${group.reason}`;
  }
  return out.filter(Boolean);
}
