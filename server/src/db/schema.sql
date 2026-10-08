-- AI Job Hunter — schema
-- All timestamps are ISO-8601 UTC strings. JSON payloads are stored as TEXT.

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,
  name           TEXT,
  token_version  INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Structured candidate profile derived from the uploaded CV (+ user edits).
CREATE TABLE IF NOT EXISTS profiles (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  full_name           TEXT,
  headline            TEXT,
  email               TEXT,
  phone               TEXT,
  location            TEXT,
  country             TEXT,
  city                TEXT,
  linkedin_url        TEXT,
  portfolio_url       TEXT,
  github_url          TEXT,
  summary             TEXT,
  years_experience    REAL,
  seniority           TEXT,
  work_authorization  TEXT,
  salary_expectation  TEXT,
  salary_currency     TEXT,
  notice_period       TEXT,
  skills              TEXT NOT NULL DEFAULT '[]',
  tools               TEXT NOT NULL DEFAULT '[]',
  job_titles          TEXT NOT NULL DEFAULT '[]',
  experience          TEXT NOT NULL DEFAULT '[]',
  education           TEXT NOT NULL DEFAULT '[]',
  certifications      TEXT NOT NULL DEFAULT '[]',
  projects            TEXT NOT NULL DEFAULT '[]',
  languages           TEXT NOT NULL DEFAULT '[]',
  industries          TEXT NOT NULL DEFAULT '[]',
  achievements        TEXT NOT NULL DEFAULT '[]',
  extraction          TEXT NOT NULL DEFAULT '{}',
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS cvs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  mime          TEXT,
  size          INTEGER,
  storage_path  TEXT NOT NULL,
  sha256        TEXT,
  text_content  TEXT,
  parsed        TEXT NOT NULL DEFAULT '{}',
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_cvs_user ON cvs(user_id, is_active);

CREATE TABLE IF NOT EXISTS user_integrations (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  smtp       TEXT,
  llm        TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id                   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  roles                     TEXT NOT NULL DEFAULT '[]',
  locations                 TEXT NOT NULL DEFAULT '[]',
  countries                 TEXT NOT NULL DEFAULT '[]',
  work_modes                TEXT NOT NULL DEFAULT '["remote","hybrid","onsite"]',
  employment_types          TEXT NOT NULL DEFAULT '["full-time"]',
  min_match_score           INTEGER NOT NULL DEFAULT 70,
  auto_apply_threshold      INTEGER NOT NULL DEFAULT 80,
  review_threshold          INTEGER NOT NULL DEFAULT 70,
  auto_apply_enabled        INTEGER NOT NULL DEFAULT 0,
  min_salary                INTEGER,
  currency                  TEXT DEFAULT 'ZAR',
  max_applications_per_day INTEGER NOT NULL DEFAULT 20,
  max_applications_per_week INTEGER NOT NULL DEFAULT 60,
  max_per_company           INTEGER NOT NULL DEFAULT 2,
  duration_days             INTEGER NOT NULL DEFAULT 7,
  cadence                   TEXT NOT NULL DEFAULT 'daily',
  runs_per_day              INTEGER NOT NULL DEFAULT 3,
  prefer_recent_days        INTEGER NOT NULL DEFAULT 14,
  prioritize_low_applicants INTEGER NOT NULL DEFAULT 1,
  reapplication_allowed     INTEGER NOT NULL DEFAULT 0,
  require_confirmation      INTEGER NOT NULL DEFAULT 1,
  notify_in_app             INTEGER NOT NULL DEFAULT 1,
  notify_email              INTEGER NOT NULL DEFAULT 0,
  notify_webhook_url        TEXT,
  enabled_connectors        TEXT NOT NULL DEFAULT '[]',
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS connectors (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key            TEXT NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1,
  credentials    TEXT,                      -- AES-256-GCM encrypted JSON
  config         TEXT NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'unknown',
  last_sync_at   TEXT,
  last_error     TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(user_id, key)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'draft',  -- draft|running|paused|stopped|completed
  config                  TEXT NOT NULL DEFAULT '{}',
  started_at              TEXT,
  paused_at               TEXT,
  stopped_at              TEXT,
  ends_at                 TEXT,
  next_run_at             TEXT,
  last_run_at             TEXT,
  total_runs              INTEGER NOT NULL DEFAULT 0,
  jobs_found              INTEGER NOT NULL DEFAULT 0,
  jobs_matched            INTEGER NOT NULL DEFAULT 0,
  applications_submitted  INTEGER NOT NULL DEFAULT 0,
  last_error              TEXT,
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id, status);
CREATE INDEX IF NOT EXISTS idx_campaigns_next ON campaigns(status, next_run_at);

CREATE TABLE IF NOT EXISTS campaign_runs (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id          INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'running', -- running|ok|error|skipped
  trigger              TEXT NOT NULL DEFAULT 'schedule',-- schedule|manual
  started_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at          TEXT,
  jobs_found           INTEGER NOT NULL DEFAULT 0,
  jobs_new             INTEGER NOT NULL DEFAULT 0,
  jobs_matched         INTEGER NOT NULL DEFAULT 0,
  jobs_skipped         INTEGER NOT NULL DEFAULT 0,
  applications_queued  INTEGER NOT NULL DEFAULT 0,
  applications_submitted INTEGER NOT NULL DEFAULT 0,
  human_actions        INTEGER NOT NULL DEFAULT 0,
  errors               TEXT NOT NULL DEFAULT '[]',
  summary              TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_runs_campaign ON campaign_runs(campaign_id, started_at);

CREATE TABLE IF NOT EXISTS jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_key      TEXT NOT NULL,
  external_id     TEXT,
  title           TEXT NOT NULL,
  company         TEXT,
  company_domain  TEXT,
  location        TEXT,
  work_mode       TEXT,                       -- remote|hybrid|onsite|unknown
  employment_type TEXT,
  salary_min      INTEGER,
  salary_max      INTEGER,
  salary_currency TEXT,
  salary_period   TEXT,
  description     TEXT,
  url             TEXT,
  apply_url       TEXT,
  apply_email     TEXT,
  posted_at       TEXT,
  discovered_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  applicants_count INTEGER,
  requirements    TEXT NOT NULL DEFAULT '{}',
  tags            TEXT NOT NULL DEFAULT '[]',
  is_demo         INTEGER NOT NULL DEFAULT 0,
  content_hash    TEXT,
  dedupe_key      TEXT NOT NULL,
  risk            TEXT NOT NULL DEFAULT '{}',
  UNIQUE(user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(user_id, source_key);

CREATE TABLE IF NOT EXISTS matches (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id         INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  campaign_id    INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  score          INTEGER NOT NULL,
  breakdown      TEXT NOT NULL DEFAULT '{}',
  strong_matches TEXT NOT NULL DEFAULT '[]',
  gaps           TEXT NOT NULL DEFAULT '[]',
  risk_flags     TEXT NOT NULL DEFAULT '[]',
  priority       REAL NOT NULL DEFAULT 0,
  decision       TEXT NOT NULL DEFAULT 'review', -- auto_apply|review|skip
  decision_reason TEXT,
  engine         TEXT NOT NULL DEFAULT 'heuristic',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(user_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_matches_user ON matches(user_id, score DESC);

CREATE TABLE IF NOT EXISTS applications (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id              INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  campaign_id         INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  cv_id               INTEGER REFERENCES cvs(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'preparing',
  -- new|preparing|awaiting_user_action|submitted|confirmed|failed|blocked|interview|rejected|withdrawn|skipped
  mode                TEXT NOT NULL DEFAULT 'assisted', -- auto_api|auto_email|assisted
  match_score         INTEGER,
  tailored_cv_path    TEXT,
  cover_letter_path   TEXT,
  cover_letter        TEXT,
  intro_text          TEXT,
  answers             TEXT NOT NULL DEFAULT '[]',
  package_json        TEXT NOT NULL DEFAULT '{}',
  human_action        TEXT,
  confirmation        TEXT NOT NULL DEFAULT '{}',
  submitted_at        TEXT,
  confirmed_at        TEXT,
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(user_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id);

CREATE TABLE IF NOT EXISTS application_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  type           TEXT NOT NULL,
  message        TEXT,
  meta           TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_events_app ON application_events(application_id, at);

CREATE TABLE IF NOT EXISTS notifications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,
  level          TEXT NOT NULL DEFAULT 'info', -- info|success|warning|error|action
  title          TEXT NOT NULL,
  body           TEXT,
  job_id         INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
  campaign_id    INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  read_at        TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  run_id      INTEGER REFERENCES campaign_runs(id) ON DELETE SET NULL,
  level       TEXT NOT NULL DEFAULT 'info',
  scope       TEXT NOT NULL,
  message     TEXT NOT NULL,
  meta        TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
