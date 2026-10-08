/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
/**
 * API client.
 *
 * The session travels two ways. A normal deployment relies on the httpOnly cookie the
 * server sets on sign-in. When the app is embedded in a third-party frame (a preview
 * pane, for example) browsers block that cookie, so the same signed token is also
 * returned by the server, kept in localStorage and sent as `Authorization: Bearer`.
 * Whichever the server sees first, the user stays signed in.
 */
const TOKEN_KEY = 'ajh.session.token';

/**
 * Storage fallback.
 *
 * Sandboxed frames, strict private modes and some corporate browsers block
 * `localStorage` entirely (access throws). Keeping the token in memory as well means
 * the session still survives navigation within the app — it is only lost on a full
 * reload, which is exactly what a sign-in screen is for.
 */
let memoryToken = null;

export function getSessionToken() {
  if (memoryToken) return memoryToken;
  try {
    return window.localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function setSessionToken(token) {
  memoryToken = token || null;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — the in-memory copy above carries the session */
  }
}

/** Keeps the token in step with whatever the server just issued. */
function applySession(payload) {
  if (payload && typeof payload === 'object' && 'token' in payload) {
    setSessionToken(payload.token || null);
  }
  return payload;
}

const DEMO_FLAG = 'ajh.demo.session';
let demoSession = false;
let recoveryInFlight = null;
// Set from /api/version at boot: the server tells us whether demo sign-in is enabled.
let demoLoginAvailable = false;
let coldRecoveryAttempted = false;

function setDemoSession(on) {
  demoSession = !!on;
  try {
    if (on) window.localStorage.setItem(DEMO_FLAG, '1');
    else window.localStorage.removeItem(DEMO_FLAG);
  } catch {
    /* storage unavailable — the in-memory flag still covers this page */
  }
}

/** True when this browser last signed in through the demo button. */
export function isDemoSession() {
  if (demoSession) return true;
  try {
    return window.localStorage.getItem(DEMO_FLAG) === '1';
  } catch {
    return false;
  }
}

/**
 * Re-establishes a demo session.
 *
 * The demo workspace is throwaway sample data, so recovering it silently is safe — and
 * it makes the demo work even in browsers that refuse to keep either the session cookie
 * or the stored token (common inside embedded frames and strict private modes), where a
 * page reload would otherwise drop the session and show "Not authenticated".
 */
async function recoverDemoSession({ allowCold = false } = {}) {
  // `allowCold` is what makes the demo usable inside an embedded preview pane. After a
  // reload there, the session cookie is blocked and local storage may be unavailable, so
  // nothing on the page remembers it was a demo session — every request would 401 and the
  // user would be shown "Not authenticated" while staring at a working server. The server
  // advertises whether demo sign-in is enabled, and only then, and only inside a frame, is
  // the demo workspace re-opened once. Production never enables it, so a real deployment
  // cannot take this path.
  if (!isDemoSession()) {
    if (!allowCold || coldRecoveryAttempted) return false;
    coldRecoveryAttempted = true;
  }
  if (!recoveryInFlight) {
    recoveryInFlight = request('POST', '/api/auth/demo-login')
      .then((payload) => {
        const ok = Boolean(applySession(payload)?.token);
        if (ok) setDemoSession(true);
        return ok;
      })
      .catch(() => false)
      .finally(() => {
        recoveryInFlight = null;
      });
  }
  return recoveryInFlight;
}

/** True inside someone else's frame (a preview pane). Cross-origin access throws. */
function isEmbedded() {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

async function request(method, path, body, options = {}) {
  const token = getSessionToken();
  const headers = {};
  if (body && !(body instanceof FormData)) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers,
    body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const error = new Error(data?.error || `Request failed (${res.status})`);
    error.status = res.status;
    error.details = data?.issues || data?.details;
    if (res.status === 401) {
      // A demo session can quietly restore itself; anything else means the user has to
      // sign in again.
      if (!options.retried && method === 'GET' && (await recoverDemoSession({ allowCold: isEmbedded() && demoLoginAvailable }))) {
        return request(method, path, body, { ...options, retried: true });
      }
      const hadToken = Boolean(getSessionToken());
      setSessionToken(null);
      // The console line is deliberately explicit: it is the fastest way to tell a
      // stale cached bundle from a genuinely expired session when the app is embedded
      // in a preview frame and devtools are awkward.
      console.warn(
        `AI Job Hunter: ${method} ${path} → 401. build=${currentBuild()} token=${hadToken ? 'present' : 'absent'} demo=${isDemoSession() ? 'yes' : 'no'}`
      );
      window.dispatchEvent(new CustomEvent('ajh:unauthorized', { detail: error.message }));
    }
    throw error;
  }
  return data;
}

/**
 * Stale-bundle guard.
 *
 * Browsers sometimes keep serving a cached copy of the app after a deploy, which leaves
 * the user running old code against a new API (and produces confusing errors). The
 * server reports which bundle it is currently serving; if that is not the file this code
 * came from, the page is reloaded once with a cache-busting query so the fresh build
 * takes over.
 */
export async function checkClientVersion() {
  try {
    const myFile = new URL(import.meta.url).pathname.split('/').pop();
    const res = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return false;
    const payload = await res.json();
    const { client } = payload;
    demoLoginAvailable = Boolean(payload?.demoLogin);
    const serverFile = String(client || '').split('/').pop();
    if (!serverFile || !myFile || serverFile === myFile) return false;

    // Reload at most once per build. The marker lives in the URL rather than in
    // storage, because storage is often unavailable in embedded frames — and a guard
    // that fails open would put the page in a reload loop.
    const url = new URL(window.location.href);
    const marker = serverFile.replace(/\.js$/, '');
    if (url.searchParams.get('_build') === marker) return false;

    console.info(`AI Job Hunter: the server is serving ${serverFile} but this page is running ${myFile} — reloading once.`);
    url.searchParams.set('_build', marker);
    window.location.replace(url.toString());
    return true;
  } catch {
    return false;
  }
}

/** The bundle this page is running — shown in the UI so a stale cache is obvious. */
export function currentBuild() {
  try {
    return new URL(import.meta.url).pathname.split('/').pop() || 'dev';
  } catch {
    return 'dev';
  }
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path, body) => request('DELETE', path, body),

  version: () => request('GET', '/api/version').catch(() => null),
  me: () => request('GET', '/api/auth/me'),
  login: (email, password) =>
    request('POST', '/api/auth/login', { email, password }).then((payload) => {
      setDemoSession(false);
      return applySession(payload);
    }),
  register: (email, password, name) =>
    request('POST', '/api/auth/register', { email, password, name }).then((payload) => {
      setDemoSession(false);
      return applySession(payload);
    }),
  demoLogin: () =>
    request('POST', '/api/auth/demo-login').then((payload) => {
      const applied = applySession(payload);
      if (applied?.token) setDemoSession(true);
      return applied;
    }),
  logout: async () => {
    try {
      return await request('POST', '/api/auth/logout');
    } finally {
      setSessionToken(null);
      setDemoSession(false);
    }
  },

  uploadCv: (file, text) => {
    const form = new FormData();
    if (file) form.append('file', file);
    if (text) form.append('text', text);
    return request('POST', '/api/cv', form);
  },
  profile: () => request('GET', '/api/profile'),
  patchProfile: (patch) => request('PATCH', '/api/profile', patch),
  reparse: () => request('POST', '/api/profile/reparse'),

  settings: () => request('GET', '/api/settings'),
  // Integrations: the user's own mail account and AI provider keys (stored encrypted).
  emailSettings: () => request('GET', '/api/settings/email'),
  saveEmailSettings: (patch) => request('PUT', '/api/settings/email', patch),
  testEmailSettings: (to) => request('POST', '/api/settings/email/test', { to }),
  aiSettings: () => request('GET', '/api/settings/ai'),
  saveAiSettings: (providers) => request('PUT', '/api/settings/ai', { providers }),
  testAiSettings: () => request('POST', '/api/settings/ai/test'),
  saveSettings: (patch) => request('PUT', '/api/settings', patch),

  connectors: () => request('GET', '/api/connectors'),
  saveConnector: (key, patch) => request('PUT', `/api/connectors/${key}`, patch),
  testConnector: (key) => request('POST', `/api/connectors/${key}/test`),
  // Bulk board lists: paste any format, then verify each identifier against the
  // platform's own public read API before a hunt run wastes time on dead boards.
  saveBoards: (key, payload) => request('POST', `/api/connectors/${key}/boards`, payload),
  verifyBoards: (key, payload = {}) => request('POST', `/api/connectors/${key}/verify-boards`, payload),
  pruneBoards: (key, remove) => request('POST', `/api/connectors/${key}/boards/prune`, { remove }),

  dashboard: () => request('GET', '/api/dashboard'),
  jobs: (query = '') => request('GET', `/api/jobs${query}`),
  job: (id) => request('GET', `/api/jobs/${id}`),
  analyzeJob: (id) => request('POST', `/api/jobs/${id}/analyze`),
  prepareJob: (id) => request('POST', `/api/jobs/${id}/prepare`),
  skipJob: (id, reason) => request('POST', `/api/jobs/${id}/skip`, { reason }),
  addJobLink: (payload) => request('POST', '/api/jobs/manual', payload),
  importJobs: (payload) => request('POST', '/api/jobs/import', { payload }),
  searchSources: () => request('POST', '/api/sources/search'),

  applications: (query = '') => request('GET', `/api/applications${query}`),
  application: (id) => request('GET', `/api/applications/${id}`),
  submitApplication: (id) => request('POST', `/api/applications/${id}/submit`),
  applicationOutcome: (id, status, note) => request('POST', `/api/applications/${id}/outcome`, { status, note }),
  patchApplication: (id, patch) => request('PATCH', `/api/applications/${id}`, patch),

  campaigns: () => request('GET', '/api/campaigns'),
  campaign: (id) => request('GET', `/api/campaigns/${id}`),
  startCampaign: (body) => request('POST', '/api/campaigns', body),
  campaignAction: (id, action) => request('POST', `/api/campaigns/${id}/${action}`, {}),
  runOnce: (body) => request('POST', '/api/hunt/run-once', body),

  notifications: () => request('GET', '/api/notifications'),
  markNotificationsRead: (ids) => request('POST', '/api/notifications/read', { ids }),

  capabilities: () => request('GET', '/api/system/capabilities'),
  policy: () => request('GET', '/api/policy'),
  activity: (limit = 120) => request('GET', `/api/activity?limit=${limit}`),
  seedDemo: () => request('POST', '/api/system/demo'),
  deleteData: (scope) => request('POST', '/api/auth/delete', { scope }),
  exportData: () => request('GET', '/api/auth/export'),
  connectorDefinitions: () => request('GET', '/api/connectors'),
};

export function documentUrl(applicationId, kind) {
  return `/api/applications/${applicationId}/documents/${kind}`;
}

/**
 * Downloads a generated document.
 *
 * A plain link would work when the session is a cookie, but not when it is carried in
 * the Authorization header — so the file is fetched the same way as every other
 * request and handed to the browser as a blob.
 */
export async function downloadDocument(applicationId, kind) {
  const token = getSessionToken();
  const res = await fetch(documentUrl(applicationId, kind), {
    credentials: 'same-origin',
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) {
    if (res.status === 401) {
      setSessionToken(null);
      window.dispatchEvent(new CustomEvent('ajh:unauthorized', { detail: 'Your session ended — please sign in again.' }));
    }
    let message = `Could not download that document (${res.status}).`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  const disposition = res.headers.get('content-disposition') || '';
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const fallback = kind === 'cv' ? 'tailored-cv.pdf' : 'cover-letter.pdf';
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = match?.[1] || fallback;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { filename: link.download, bytes: blob.size };
}
