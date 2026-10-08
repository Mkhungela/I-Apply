/**
 * SQLite driver adapter.
 *
 * Preference order:
 *   1. `node:sqlite`  — built into Node.js >= 22.5 (no native build required)
 *   2. `better-sqlite3` — optional dependency, if the native build is available
 *
 * Both expose a similar synchronous prepared-statement API, so the rest of the
 * application is driver agnostic.
 */
import fs from 'node:fs';
import path from 'node:path';

let driverName = null;
let Database = null;

export async function loadDriver() {
  if (Database) return { name: driverName, Database };

  try {
    const mod = await import('node:sqlite');
    Database = mod.DatabaseSync;
    driverName = 'node:sqlite';
    return { name: driverName, Database };
  } catch {
    /* fall through */
  }

  try {
    const mod = await import('better-sqlite3');
    Database = mod.default;
    driverName = 'better-sqlite3';
    return { name: driverName, Database };
  } catch {
    /* fall through */
  }

  throw new Error(
    'No SQLite driver available. Use Node.js >= 22.5 (built-in node:sqlite) or run: npm i better-sqlite3 --workspace server'
  );
}

/** Thin normalising wrapper so callers never care which driver is in use. */
export class DatabaseAdapter {
  constructor(file) {
    this.file = file;
    this.db = null;
  }

  async open() {
    const { Database: Ctor, name } = await loadDriver();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = new Ctor(this.file);
    this.driver = name;
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    return this;
  }

  exec(sql) {
    return this.db.exec(sql);
  }

  /** Run a statement. Returns { changes, lastInsertRowid } */
  run(sql, ...params) {
    const stmt = this.db.prepare(sql);
    return stmt.run(...normalize(params));
  }

  get(sql, ...params) {
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...normalize(params));
    return row ? { ...row } : undefined;
  }

  all(sql, ...params) {
    const stmt = this.db.prepare(sql);
    return stmt.all(...normalize(params)).map((r) => ({ ...r }));
  }

  transaction(fn) {
    const db = this.db;
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore rollback failure */
      }
      throw err;
    }
  }

  close() {
    try {
      this.db?.close();
    } catch {
      /* ignore */
    }
  }
}

/** node:sqlite rejects `undefined` bind values and booleans; normalise to what SQLite accepts. */
function normalize(params) {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString();
    if (p !== null && typeof p === 'object') return JSON.stringify(p);
    return p;
  });
}
