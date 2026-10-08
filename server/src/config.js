/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (…/i-Apply) — server/src/config.js -> ../../ */
export const ROOT_DIR = path.resolve(__dirname, '..', '..');

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function boolEnv(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function intEnv(name, fallback) {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? v : fallback;
}

function resolveDataDir() {
  const dir = env('DATA_DIR', path.join(ROOT_DIR, 'data'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const DATA_DIR = resolveDataDir();
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const EXPORT_DIR = path.join(DATA_DIR, 'exports');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(EXPORT_DIR, { recursive: true });

/** Persisted secret so sessions survive a restart when JWT_SECRET is not provided. */
function persistedSecret() {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv) return fromEnv;
  const file = path.join(DATA_DIR, '.app-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

export const config = {
  env: env('NODE_ENV', 'development'),
  port: intEnv('PORT', 8787),
  host: env('HOST', '0.0.0.0'),
  dataDir: DATA_DIR,
  uploadDir: UPLOAD_DIR,
  exportDir: EXPORT_DIR,
  clientDist: path.join(ROOT_DIR, 'client', 'dist'),
  secret: persistedSecret(),
  sessionTtlDays: intEnv('SESSION_TTL_DAYS', 30),
  secureCookies: boolEnv('SECURE_COOKIES', false),

  /**
   * Demo sign-in without credentials. Development convenience only — never on in
   * production, and explicitly switchable. Published to the client on /api/version so an
   * embedded preview can re-open the demo workspace after a reload, when neither the
   * session cookie nor local storage survives.
   */
  allowDemoLogin: env('ALLOW_DEMO_LOGIN', 'true') !== 'false' && env('NODE_ENV', 'development') !== 'production',

  /** Scheduler tick interval (ms). The scheduler is durable: state lives in SQLite. */
  schedulerTickMs: intEnv('SCHEDULER_TICK_MS', 15_000),

  /** Outbound network access for job connectors (disabled in restricted sandboxes). */
  networkEnabled: boolEnv('CONNECTOR_NETWORK_ENABLED', true),
  fetchTimeoutMs: intEnv('CONNECTOR_TIMEOUT_MS', 12_000),

  /** Max jobs pulled from one connector in a single campaign run. */
  connectorPageLimit: intEnv('CONNECTOR_PAGE_LIMIT', 40),

  /** Optional LLM provider for richer CV parsing / match narratives / generated text. */
  llm: {
    provider: env('LLM_PROVIDER', 'none'), // none | google | groq | cerebras | openrouter | github | mistral | nvidia | huggingface | cloudflare | ollama | openai | anthropic
    apiKey: env('LLM_API_KEY', ''),
    baseUrl: env('LLM_BASE_URL', ''),
    model: env('LLM_MODEL', ''),
    timeoutMs: intEnv('LLM_TIMEOUT_MS', 30_000),
    /**
     * Extra providers from the environment, e.g. LLM_PROVIDER_2 + LLM_API_KEY_2.
     * Several free tiers tried in order means a rate limit on one never stops a run.
     */
    extra: [2, 3, 4, 5]
      .map((n) => ({
        provider: env(`LLM_PROVIDER_${n}`, ''),
        apiKey: env(`LLM_API_KEY_${n}`, ''),
        baseUrl: env(`LLM_BASE_URL_${n}`, ''),
        model: env(`LLM_MODEL_${n}`, ''),
      }))
      .filter((p) => p.provider && p.provider !== 'none'),
  },

  /** Optional SMTP for email-based applications + notification emails. */
  smtp: {
    host: env('SMTP_HOST', ''),
    port: intEnv('SMTP_PORT', 587),
    secure: boolEnv('SMTP_SECURE', false),
    user: env('SMTP_USER', ''),
    pass: env('SMTP_PASS', ''),
    from: env('SMTP_FROM', ''),
  },

  /**
   * Embedding policy. The app is normally same-origin only, but preview panes and some
   * corporate portals embed it in a frame. `EMBED_ORIGINS` lists the origins allowed to
   * frame it ("*" allows any); in development, framing is allowed by default so the app
   * can be reviewed inside a preview iframe.
   */
  embed: (() => {
    const raw = env('EMBED_ORIGINS', '');
    const origins = raw
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter((value) => value && value !== '*');
    const allowAll = raw.includes('*') || (boolEnv('ALLOW_EMBEDDING', env('NODE_ENV', 'development') !== 'production') && !origins.length);
    return { origins, allowAll };
  })(),

  allowRegistration: boolEnv('ALLOW_REGISTRATION', true),
};

export const hasRealLlm = () => config.llm.provider !== 'none' && !!config.llm.apiKey;
export const hasSmtp = () => !!config.smtp.host;
