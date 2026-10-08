/**
 * Connector framework.
 *
 * A connector is a job source adapter. Each one declares, up-front and honestly:
 *   • its automation policy (what the platform's rules permit)
 *   • the credentials / API access / approved integration it needs
 *   • whether it can submit an application automatically, or only hand off to the user
 *
 * Rule of the codebase: if a platform prohibits automated activity, the connector
 * must NOT attempt it. It either serves a permitted API, or it returns
 * `requiresHuman` with a clear explanation and a handoff link/steps.
 */
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { normalizeJob } from '../services/jobNormalizer.js';
import { db } from '../db/index.js';

export class ConnectorError extends Error {
  constructor(message, code = 'connector_error') {
    super(message);
    this.code = code;
    this.status = 502;
  }
}

/** Raised when a connector cannot run without credentials/approval the user must supply. */
export class ConnectorNeedsSetup extends Error {
  constructor(message, { required = [] } = {}) {
    super(message);
    this.code = 'connector_needs_setup';
    this.required = required;
    this.status = 412;
  }
}

/** Raised when the platform's rules do not permit the requested automated action. */
export class ConnectorPolicyBlocked extends Error {
  constructor(message, { policy, handoff } = {}) {
    super(message);
    this.code = 'connector_policy_blocked';
    this.policy = policy;
    this.handoff = handoff;
    this.status = 451;
  }
}

const USER_AGENT = 'AIJobHunter/1.0 (+self-hosted job search assistant; contact: app owner)';

/** Fetches JSON with a timeout, size limit and honest error reporting. */
export async function httpJson(url, options = {}) {
  const text = await httpText(url, options);
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new ConnectorError(`Expected JSON from ${hostOf(url)} but received something else`, 'bad_response');
  }
}

export async function httpText(url, options = {}) {
  if (!config.networkEnabled) {
    throw new ConnectorError(
      'Outbound network access is disabled in this environment (CONNECTOR_NETWORK_ENABLED=false). The connector code path is intact — enable network access or run this app on your own server to fetch live jobs.',
      'network_disabled'
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? config.fetchTimeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        accept: options.accept || 'application/json, text/plain, */*',
        'user-agent': USER_AGENT,
        ...(options.headers || {}),
      },
      method: options.method || 'GET',
      body: options.body,
    });
    if (!res.ok) {
      throw new ConnectorError(`${hostOf(url)} responded ${res.status} ${res.statusText || ''}`.trim(), `http_${res.status}`);
    }
    const text = await res.text();
    if (text.length > 8_000_000) throw new ConnectorError('Response too large to process safely', 'too_large');
    return text;
  } catch (err) {
    if (err instanceof ConnectorError) throw err;
    if (err.name === 'AbortError') throw new ConnectorError(`${hostOf(url)} timed out`, 'timeout');
    throw new ConnectorError(`Could not reach ${hostOf(url)}: ${err.message}`, 'network_error');
  } finally {
    clearTimeout(timeout);
  }
}

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Minimal RSS/Atom reader (feeds are a permitted, published interface). */
export function parseFeed(xml = '') {
  const items = [];
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) || [];
  for (const block of blocks) {
    const pick = (tag) => {
      const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
      const m = re.exec(block);
      if (!m) return null;
      return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    };
    const linkAttr = /<link[^>]*href=["']([^"']+)["']/i.exec(block);
    items.push({
      title: pick('title'),
      description: pick('description') || pick('summary') || pick('content'),
      url: linkAttr ? linkAttr[1] : pick('link'),
      postedAt: pick('pubDate') || pick('published') || pick('updated') || pick('dc:date'),
      company: pick('company') || pick('author') || null,
      location: pick('location') || null,
      guid: pick('guid') || pick('id'),
    });
  }
  return items;
}

function decodeEntities(s = '') {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

/**
 * Base class. Subclasses implement `search()` and optionally `submitApplication()`.
 *
 * Contract:
 *   search(query) -> { jobs: NormalizedJob[], warnings: string[], needsSetup?: string[] }
 *   submitApplication(pkg) -> { status, confirmation, mode, detail }
 */
export class JobConnector {
  /** @type {{key:string,name:string,category:string,description:string,automationPolicy:object,credentials:Array,capabilities:object,complianceNote:string}} */
  static meta = {
    key: 'base',
    name: 'Base connector',
    category: 'other',
    description: '',
    automationPolicy: {
      automatedSearch: 'unknown',
      automatedApply: 'unknown',
      basis: 'Not specified',
    },
    credentials: [],
    capabilities: { search: false, autoApply: false, assistantHandoff: true },
    complianceNote: '',
  };

  constructor(ctx = {}) {
    this.ctx = ctx;
    this.userId = ctx.userId;
    this.credentials = ctx.credentials || {};
    this.config = ctx.config || {};
    this.log = logger(`connector:${this.constructor.meta.key}`);
  }

  get meta() {
    return this.constructor.meta;
  }

  /** Reads a credential supplied by the user (never logged, never returned to clients). */
  credential(name) {
    const value = this.credentials?.[name];
    return typeof value === 'string' ? value.trim() || null : value || null;
  }

  /**
   * Moves the board-rotation offset forward after a search.
   *
   * A list of 70 boards is not fetched in one run — that would be impolite to the ATS
   * and slow for the user. Each run visits a window of the list and the offset advances,
   * so every board is covered within a few runs.
   */
  rotateBoardOffset(nextOffset) {
    try {
      const database = db();
      const row = this.ctx.connectorRow
        || database.get('SELECT id, config FROM connectors WHERE user_id = ? AND key = ?', this.userId, this.constructor.meta.key);
      if (!row) return;
      const config = typeof row.config === 'string' ? JSON.parse(row.config) : row.config || {};
      database.run('UPDATE connectors SET config = ? WHERE id = ?', JSON.stringify({ ...config, boardOffset: nextOffset }), row.id);
    } catch (err) {
      this.log.warn(`could not persist board rotation offset: ${err.message}`);
    }
  }

  /** Whether the connector has everything it needs to run. */
  readiness() {
    const missing = (this.meta.credentials || [])
      .filter((c) => c.required && !this.credentials[c.name])
      .map((c) => c.name);
    return {
      ready: missing.length === 0 && this.meta.capabilities.search,
      missing,
      requiresSetup: missing.length > 0,
      canAutoApply: !!this.meta.capabilities.autoApply,
    };
  }

  async search() {
    throw new ConnectorNeedsSetup('This connector has no search implementation.', { required: [] });
  }

  async submitApplication() {
    return {
      status: 'requires_human',
      mode: 'assisted',
      detail: this.meta.complianceNote || 'This platform does not permit automated application submission.',
      handoff: null,
    };
  }

  /** Shared post-processing: normalise, dedupe within the batch, tag the source. */
  normalizeAll(rawJobs = [], extra = {}) {
    const seen = new Set();
    const jobs = [];
    for (const raw of rawJobs) {
      if (!raw || !raw.title) continue;
      const job = normalizeJob({ ...raw, sourceKey: raw.sourceKey || this.meta.key }, this.meta);
      const key = `${job.externalId || ''}|${job.url || ''}|${job.title}|${job.company}`;
      if (seen.has(key)) continue;
      seen.add(key);
      jobs.push({ ...job, ...extra });
    }
    return jobs;
  }
}

/** Shared helper: connectors that only support handoff return this shape. */
export function handoffResult(meta, job, reason) {
  return {
    status: 'requires_human',
    mode: 'assisted',
    detail: reason || meta.complianceNote,
    handoff: {
      url: job?.applyUrl || job?.url || null,
      steps: [
        'Open the job link (it opens the platform’s own application form).',
        'Your generated documents are attached to this application record — download them from the dashboard.',
        `Paste the prepared answers where the form asks the questions listed below.`,
        'Mark the application as “Applied” in AI Job Hunter once you have submitted it.',
      ],
      policy: meta.automationPolicy,
    },
  };
}

/**
 * Parses a list of identifiers typed by a human.
 *
 * Accepts all the formats people actually paste: comma-separated, whitespace-separated,
 * one per line, or a JSON array (including a copied JSON snippet with brackets and
 * quotes). Duplicates are removed and order is preserved.
 */
export function parseTokenList(raw) {
  if (Array.isArray(raw)) return uniqueTokens(raw);
  const text = String(raw ?? '').trim();
  if (!text) return [];

  // A JSON array, possibly with trailing commas or newlines inside.
  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const parsed = JSON.parse(text.replace(/,\s*]/g, ']'));
      if (Array.isArray(parsed)) return uniqueTokens(parsed);
    } catch {
      // fall through to the loose parse below
    }
  }
  return uniqueTokens(text.split(/[,\n\r\t;]+|\s{2,}/));
}

function uniqueTokens(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const token = String(value ?? '')
      .replace(/^["'\s\[]+|["'\s\]]+$/g, '')
      .trim()
      .toLowerCase();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * Chooses which identifiers this run should visit, and where to resume next time.
 *
 * @param {string[]} tokens the full list
 * @param {object} config connector config (uses `maxBoardsPerRun` and `boardOffset`)
 * @param {string} key connector key, used for the per-source default window
 * @returns {{ selected: string[], nextOffset: number, total: number }}
 */
export function selectBoards(tokens, config = {}, key = 'default') {
  const defaults = { greenhouse: 25, lever: 25, workable: 25, smartrecruiters: 15 };
  const requested = Number(config.maxBoardsPerRun) || defaults[key] || 20;
  const window = Math.max(1, Math.min(requested, tokens.length || 1));
  if (!tokens.length) return { selected: [], nextOffset: 0, total: 0 };

  const offset = Math.abs(Number(config.boardOffset) || 0) % tokens.length;
  const selected = [];
  for (let i = 0; i < Math.min(window, tokens.length); i += 1) {
    selected.push(tokens[(offset + i) % tokens.length]);
  }
  return { selected, nextOffset: (offset + selected.length) % tokens.length, total: tokens.length };
}
