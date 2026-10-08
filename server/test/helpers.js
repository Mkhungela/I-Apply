/**
 * Test helpers.
 *
 * Every test file gets its own throwaway data directory and its own HTTP server on an
 * ephemeral port, so tests never touch the real database in `data/`.
 *
 * The environment must be set *before* `src/config.js` is imported, which is why this
 * module sets it at load time and the application is imported dynamically.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'ai-job-hunter-test-'));

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = tmpDir;
process.env.JWT_SECRET = 'test-secret-do-not-use-in-production';
process.env.SCHEDULER_ENABLED = 'false';
process.env.CONNECTOR_NETWORK_ENABLED = 'false';
process.env.SECURE_COOKIES = 'false';
process.env.ALLOW_REGISTRATION = 'true';
delete process.env.SMTP_HOST; // tests assert the honest "SMTP not configured" behaviour

export const TEST_DATA_DIR = tmpDir;

export async function startTestServer() {
  const { initDatabase, closeDatabase } = await import('../src/db/index.js');
  const { createApp } = await import('../src/app.js');
  await initDatabase();
  const app = createApp();
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const port = server.address().port;

  return {
    base: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await closeDatabase();
      rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

/**
 * Minimal JSON client.
 *
 * `options.cookies = false` emulates a browser that refuses cookies in a third-party
 * frame — the exact situation the bearer-token session exists for.
 */
export function makeClient(base, options = {}) {
  const useCookies = options.cookies !== false;
  let cookie = '';
  let token = options.token || null;

  async function request(method, url, body, options2 = {}) {
    const headers = {};
    if (useCookies && cookie) headers.cookie = cookie;
    if (token) headers.authorization = `Bearer ${token}`;
    let payload = body;
    if (body !== undefined && !(body instanceof FormData)) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${base}${url}`, { method, headers, body: payload, redirect: 'manual' });
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    if (useCookies && setCookies.length) cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
    if (options2.raw) return res;
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, body: data, headers: res.headers };
  }

  return {
    get: (url, options) => request('GET', url, undefined, options),
    post: (url, body, options) => request('POST', url, body, options),
    put: (url, body) => request('PUT', url, body),
    patch: (url, body) => request('PATCH', url, body),
    setCookie: (value) => {
      cookie = value;
    },
    cookie: () => cookie,
    /** Stores the token a response came back with (what the real client does). */
    useTokenFrom(payload) {
      if (payload?.token) token = payload.token;
      return token;
    },
    token: () => token,
  };
}

export const DEMO_PASSWORD = 'password123';

/** Registers a user and returns a signed-in client. */
export async function registerUser(api, email = `user-${Date.now()}@example.com`) {
  const res = await api.post('/api/auth/register', { email, password: DEMO_PASSWORD, name: 'Test User' });
  if (res.status !== 201 && res.status !== 200) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.user;
}

export const SCAM_ADVERT = `URGENT: Work-from-home Data Entry Assistant. Earn R2 500 per day.
No experience needed. To start, pay a registration deposit of R450 via bitcoin to confirm your seat.
Send your ID number, bank details and a photo of your passport to fastcash.recruiters@gmail.com today.`;

export const LEGIT_ADVERT = `Senior Product Designer — Lumen Retail (Hybrid, Cape Town)
Own checkout and payment journeys across web and app. Prototype in Figma, extend the design
system, run usability testing and work with engineers on accessible components.
Requirements: 5+ years product design experience, strong Figma skills, design systems,
WCAG accessibility and user research. To apply, email your CV to talent@lumenretail.co.za.`;
