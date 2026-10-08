/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseAdapter } from './driver.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let adapter = null;

export async function initDatabase() {
  if (adapter) return adapter;
  const file = process.env.DATABASE_FILE || path.join(config.dataDir, 'jobhunter.db');
  adapter = new DatabaseAdapter(file);
  await adapter.open();
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  adapter.exec(schema);
  runLightMigrations(adapter);
  log.info(`database ready (${adapter.driver})`, { file });
  return adapter;
}

/**
 * Additive migrations for databases created by an earlier build.
 * Only adds columns that are safe to add; never drops data.
 */
function runLightMigrations(db) {
  applyColumns(db, 'campaigns', [
    ['total_runs', 'INTEGER NOT NULL DEFAULT 0'],
    ['jobs_found', 'INTEGER NOT NULL DEFAULT 0'],
    ['jobs_matched', 'INTEGER NOT NULL DEFAULT 0'],
    ['applications_submitted', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_error', 'TEXT'],
  ]);
  applyColumns(db, 'profiles', [
    ['industries', "TEXT NOT NULL DEFAULT '[]'"],
    ['achievements', "TEXT NOT NULL DEFAULT '[]'"],
  ]);
  applyColumns(db, 'user_settings', [
    ['runs_per_day', 'INTEGER NOT NULL DEFAULT 3'],
    ['require_confirmation', 'INTEGER NOT NULL DEFAULT 1'],
    ['enabled_connectors', "TEXT NOT NULL DEFAULT '[]'"],
  ]);
  normaliseLegacyTimestamps(db);
  applyColumns(db, 'applications', [
    ['human_action', 'TEXT'],
    ['package_json', "TEXT NOT NULL DEFAULT '{}'"],
  ]);
}

function applyColumns(db, table, columns) {
  let existing;
  try {
    existing = new Set(db.all(`PRAGMA table_info(${table})`).map((r) => r.name));
  } catch {
    return;
  }
  for (const [name, type] of columns) {
    if (existing.has(name)) continue;
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    } catch (err) {
      log.warn(`migration skipped for ${table}.${name}`, { error: err.message });
    }
  }
}

/** Lazily-opened singleton accessor used by services. */
export function db() {
  if (!adapter) throw new Error('Database not initialised — call initDatabase() first.');
  return adapter;
}

export async function closeDatabase() {
  adapter?.close();
  adapter = null;
}

export function nowIso() {
  return new Date().toISOString();
}
/**
 * Earlier builds wrote some timestamps with SQLite's `datetime('now')` format
 * ("YYYY-MM-DD HH:MM:SS") and others as ISO-8601. Mixed formats break TEXT
 * comparisons (which is how the daily/weekly application caps are enforced), so
 * any legacy values are converted to ISO-8601 once.
 */
function normaliseLegacyTimestamps(db) {
  const tables = {
    users: ['created_at', 'updated_at'],
    profiles: ['updated_at'],
    cvs: ['created_at'],
    user_settings: ['updated_at'],
    connectors: ['created_at', 'last_sync_at'],
    campaigns: ['created_at', 'updated_at', 'started_at', 'paused_at', 'stopped_at', 'ends_at', 'next_run_at', 'last_run_at'],
    campaign_runs: ['started_at', 'finished_at'],
    jobs: ['discovered_at', 'posted_at'],
    matches: ['created_at', 'updated_at'],
    applications: ['created_at', 'updated_at', 'submitted_at', 'confirmed_at'],
    application_events: ['at'],
    notifications: ['created_at', 'read_at'],
    activity_log: ['created_at'],
    audit_log: ['created_at'],
  };
  let converted = 0;
  for (const [table, columns] of Object.entries(tables)) {
    for (const column of columns) {
      try {
        const result = db.run(
          `UPDATE ${table} SET ${column} = replace(${column}, ' ', 'T') || '.000Z'
           WHERE ${column} IS NOT NULL AND length(${column}) = 19 AND ${column} LIKE '____-__-__ __:__:__'`
        );
        converted += result?.changes ?? 0;
      } catch {
        /* column may not exist yet on this build */
      }
    }
  }
  if (converted) log.info(`normalised ${converted} legacy timestamp value(s) to ISO-8601`);
}
