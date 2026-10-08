/**
 * End-to-end API tests: a real server, a real database on disk, real HTTP requests.
 *
 * These cover the promises that matter most in this product:
 *  • no application is ever reported as submitted unless a platform confirmed it;
 *  • the same posting is never applied to twice;
 *  • high-risk listings are stopped before they can be prepared or sent;
 *  • documents, tracking, campaigns and privacy controls all work over HTTP.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, makeClient, registerUser, SCAM_ADVERT, LEGIT_ADVERT } from './helpers.js';

let server;
let api;
let jobId;

before(async () => {
  server = await startTestServer();
  api = makeClient(server.base);
});

after(async () => {
  await server?.close();
});

describe('auth', () => {
  test('protected endpoints reject anonymous callers', async () => {
    const anon = makeClient(server.base);
    const res = await anon.get('/api/dashboard');
    assert.equal(res.status, 401);
  });

  test('register → session cookie → dashboard', async () => {
    await registerUser(api, 'candidate@example.com');
    const res = await api.get('/api/dashboard');
    assert.equal(res.status, 200);
    assert.ok(res.body.stats);
  });
});

describe('demo workspace and a full hunt run', () => {
  test('seeds a labelled sample dataset that reflects the candidate', async () => {
    const res = await api.post('/api/system/demo');
    assert.equal(res.status, 200);
    assert.equal(res.body.seeded.demoJobs, 24);
    assert.equal(res.body.seeded.scored, 24);
  });

  test('run-once searches, matches and prepares applications', async () => {
    await api.put('/api/settings', { autoApplyEnabled: true, requireConfirmation: false, maxApplicationsPerDay: 5 });
    const res = await api.post('/api/hunt/run-once', { searchMode: 'demo', taskLimit: 5 });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.deepEqual(res.body.errors, []);
    assert.ok(res.body.stats.jobsFound >= 20, 'demo dataset should be searched');
    assert.ok(res.body.stats.applicationsQueued >= 1, 'at least one application should be prepared');
    // Demo listings are clearly labelled sample data: nothing may be "submitted".
    assert.equal(res.body.stats.applicationsSubmitted, 0);
  });

  test('a prepared application carries a cover letter, answers and documents', async () => {
    const list = await api.get('/api/applications');
    assert.ok(list.body.applications.length >= 1);
    const app = list.body.applications[0];
    assert.equal(app.status, 'awaiting_user_action');

    const detail = await api.get(`/api/applications/${app.id}`);
    assert.ok(detail.body.application.coverLetter.length > 200, 'cover letter should be generated');
    assert.ok(Array.isArray(detail.body.application.answers));
    assert.ok(detail.body.documents.tailoredCv, 'tailored CV document should exist');
    assert.ok(detail.body.documents.coverLetter, 'cover letter document should exist');
    assert.equal(detail.body.application.confirmation, null, 'nothing may claim a submission happened');
  });

  test('documents download as real PDFs', async () => {
    const list = await api.get('/api/applications');
    const id = list.body.applications[0].id;
    for (const kind of ['cv', 'cover']) {
      const res = await api.get(`/api/applications/${id}/documents/${kind}`, { raw: true });
      assert.equal(res.status, 200);
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-', 'must be a real PDF');
      assert.ok(bytes.length > 800);
    }
  });

  test('demo listings never auto-submit, and say why', async () => {
    const list = await api.get('/api/applications');
    const app = list.body.applications[0];
    const res = await api.post(`/api/applications/${app.id}/submit`);
    assert.equal(res.body.status, 'requires_human');
    assert.match(res.body.detail, /demo listing/i);
    const after = await api.get(`/api/applications/${app.id}`);
    assert.notEqual(after.body.application.status, 'submitted');
  });
});

describe('manual jobs: the path to a real submission', () => {
  test('a pasted advert with an email address is accepted and scored', async () => {
    const res = await api.post('/api/jobs/manual', {
      url: 'https://lumenretail.co.za/careers/product-designer-payments',
      title: 'Product Designer (Payments)',
      company: 'Lumen Retail',
      location: 'Cape Town, South Africa (Hybrid)',
      description: LEGIT_ADVERT,
      analyze: true,
    });
    assert.equal(res.status, 201);
    assert.ok(res.body.jobId);
    jobId = res.body.jobId;
    assert.ok(res.body.match.score >= 60, `expected a real match score, got ${res.body.match?.score}`);
    assert.equal(res.body.match.risk.level, 'low');
  });

  test('submitting without a configured mail account asks the user instead of pretending', async () => {
    const res = await api.post(`/api/jobs/${jobId}/prepare`);
    assert.equal(res.status, 200);
    // No SMTP is configured in tests, so the honest answer is "you need to send this".
    assert.equal(res.body.outcome, 'requires_human');
    const list = await api.get('/api/applications');
    const app = list.body.applications.find((a) => a.job.id === jobId);
    assert.ok(app);
    assert.notEqual(app.status, 'submitted');
    assert.ok(app.humanAction, 'the user must be told what to do next');
  });

  test('the same posting cannot be prepared twice', async () => {
    const again = await api.post(`/api/jobs/${jobId}/prepare`);
    assert.equal(again.body.outcome, 'duplicate');
  });

  test('the same company + role is refused, even from a reposted advert', async () => {
    const res = await api.post('/api/jobs/manual', {
      url: 'https://lumenretail.co.za/careers/product-designer-payments-copy',
      title: 'Product Designer (Payments)',
      company: 'Lumen Retail',
      description: LEGIT_ADVERT,
      analyze: true,
    });
    // A new URL for the same employer and role is still the same application.
    assert.equal(res.status, 201);
    const second = await api.post(`/api/jobs/${res.body.jobId}/prepare`);
    assert.equal(second.body.outcome, 'skipped');
    const apps = await api.get('/api/applications');
    const forLumen = apps.body.applications.filter((a) => a.job.company === 'Lumen Retail');
    assert.ok(forLumen.length < 2, 'no second application should be created for the same company and role');
  });

  test('high-risk adverts are blocked before anything is prepared', async () => {
    const scam = await api.get('/api/notifications');
    assert.ok(scam.status === 200);

    const own = makeClient(server.base);
    await registerUser(own, `scam-${Date.now()}@example.com`);
    await own.post('/api/system/demo'); // a candidate profile is needed before anything can be scored
    const added = await own.post('/api/jobs/manual', {
      url: `https://fastcash.example/jobs/data-entry-${Date.now()}`,
      title: 'Work-from-home Data Entry Assistant',
      company: 'Fast Cash Recruiters',
      description: SCAM_ADVERT,
      analyze: true,
    });
    assert.equal(added.body.match.decision, 'skip');
    assert.equal(added.body.match.risk.level, 'high');

    const prepared = await own.post(`/api/jobs/${added.body.jobId}/prepare`);
    assert.equal(prepared.body.outcome, 'skipped');

    const apps = await own.get('/api/applications');
    const blocked = apps.body.applications.find((a) => a.job.id === added.body.jobId);
    if (blocked) {
      assert.notEqual(blocked.status, 'submitted');
    }
  });
});

describe('tracking', () => {
  test('an outcome can be recorded and shows up on the dashboard', async () => {
    await api.post('/api/jobs', undefined).catch(() => {});
    const list = await api.get('/api/applications');
    const app = list.body.applications.find((a) => a.status !== 'skipped');
    const res = await api.post(`/api/applications/${app.id}/outcome`, { status: 'interview', note: 'Interview booked.' });
    assert.equal(res.status, 200);
    assert.equal(res.body.application.status, 'interview');

    const dashboard = await api.get('/api/dashboard');
    assert.equal(dashboard.body.stats.interviews, 1);
    const notes = await api.get('/api/notifications');
    assert.ok(notes.body.notifications.some((n) => n.type === 'interview_detected'));
  });

  test('answers and notes can be edited before sending', async () => {
    const list = await api.get('/api/applications');
    const app = list.body.applications.find((a) => a.status === 'awaiting_user_action');
    const res = await api.patch(`/api/applications/${app.id}`, { notes: 'Called the recruiter.' });
    assert.equal(res.status, 200);
    assert.equal(res.body.application.notes, 'Called the recruiter.');
  });
});

describe('campaigns', () => {
  let campaignId;

  test('a campaign can be created, paused, resumed and stopped', async () => {
    const created = await api.post('/api/campaigns', {
      name: 'Test hunt',
      durationDays: 3,
      cadence: 'daily',
      runsPerDay: 2,
      taskLimit: 3,
      searchMode: 'demo',
      startImmediately: false,
    });
    assert.equal(created.status, 201);
    campaignId = created.body.campaign.id;
    assert.ok(created.body.campaign.ends_at, 'a duration must produce an end date');

    const started = await api.post(`/api/campaigns/${campaignId}/start`, { immediate: false });
    assert.equal(started.body.campaign.status, 'running');

    const paused = await api.post(`/api/campaigns/${campaignId}/pause`);
    assert.equal(paused.body.campaign.status, 'paused');

    const resumed = await api.post(`/api/campaigns/${campaignId}/resume`);
    assert.equal(resumed.body.campaign.status, 'running');

    const stopped = await api.post(`/api/campaigns/${campaignId}/stop`);
    assert.equal(stopped.body.campaign.status, 'stopped');
    assert.ok(stopped.body.campaign.stopped_at);
  });

  test('the dashboard reports scheduler and campaign state', async () => {
    const res = await api.get('/api/dashboard');
    assert.equal(res.status, 200);
    assert.ok(res.body.scheduler);
    assert.ok(Array.isArray(res.body.pipeline));
  });
});

describe('sessions', () => {
  test('a browser that blocks cookies can still use the whole API (bearer token)', async () => {
    const blocked = makeClient(server.base, { cookies: false });
    const registered = await blocked.post('/api/auth/register', {
      email: `no-cookies-${Date.now()}@example.com`,
      password: 'password123',
      name: 'Blocked Cookies',
    });
    assert.equal(registered.status, 201);
    assert.ok(registered.body.token, 'the server must hand back a session token');
    blocked.useTokenFrom(registered.body);

    // Every one of these used to fail with 401 "Not authenticated" when the browser
    // dropped the session cookie.
    for (const endpoint of ['/api/auth/me', '/api/dashboard', '/api/settings', '/api/profile', '/api/jobs']) {
      const res = await blocked.get(endpoint);
      assert.equal(res.status, 200, `${endpoint} should work with the bearer token alone`);
    }
    const me = await blocked.get('/api/auth/me');
    assert.equal(me.body.user.email, registered.body.user.email);
  });

  test('a stale cookie never overrides a valid token', async () => {
    // A cookie signed with an older secret (after a database or secret change, say)
    // used to win over the bearer token and lock the user out of their own session.
    const blocked = makeClient(server.base, { cookies: false });
    const email = `stale-cookie-${Date.now()}@example.com`;
    const registered = await blocked.post('/api/auth/register', { email, password: 'password123', name: 'Stale Cookie' });
    blocked.useTokenFrom(registered.body);

    blocked.setCookie('ajh_session=eyJhbGciOiJIUzI1NiJ9.this.cookie.is.dead');
    const me = await blocked.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, email, 'the valid token must still identify the user');

    const dashboard = await blocked.get('/api/dashboard');
    assert.equal(dashboard.status, 200, 'a dead cookie must not poison a valid token');
  });

  test('with no usable credentials the API stays closed', async () => {
    const anonymous = makeClient(server.base, { cookies: false });
    const res = await anonymous.get('/api/dashboard');
    assert.equal(res.status, 401);
  });

  test('signing out everywhere revokes the token', async () => {
    // Its own account: revoking sessions is destructive, so it must not disturb the
    // account the rest of this suite is using.
    const blocked = makeClient(server.base, { cookies: false });
    const email = `revoke-${Date.now()}@example.com`;
    const registered = await blocked.post('/api/auth/register', { email, password: 'password123', name: 'Revoke Me' });
    blocked.useTokenFrom(registered.body);
    assert.equal((await blocked.get('/api/dashboard')).status, 200);
    await blocked.post('/api/auth/logout-all');
    assert.equal((await blocked.get('/api/dashboard')).status, 401, 'the old token must stop working');
  });
});

describe('privacy', () => {
  test('export contains the user’s data and no storage paths', async () => {
    const res = await api.get('/api/auth/export', { raw: true });
    assert.equal(res.status, 200);
    const text = await res.text();
    const data = JSON.parse(text);
    assert.ok(data.applications.length >= 1);
    assert.ok(data.cvs.every((c) => !('storage_path' in c)));
  });

  test('history can be deleted without touching the profile or settings', async () => {
    const res = await api.post('/api/auth/delete', { scope: 'history' });
    assert.equal(res.status, 200);
    const dashboard = await api.get('/api/dashboard');
    assert.equal(dashboard.body.stats.jobsFoundTotal, 0);
    const settings = await api.get('/api/settings');
    assert.ok(settings.body.settings.roles.length > 0, 'settings must survive a history wipe');
  });
});

describe('capabilities honesty', () => {
  test('sources that need credentials are reported as such', async () => {
    const res = await api.get('/api/system/capabilities');
    assert.equal(res.status, 200);
    const linkedin = res.body.sources.find((s) => s.key === 'linkedin');
    assert.ok(linkedin, 'LinkedIn must be listed as a first-class source');
    assert.equal(linkedin.canAutoApply, false, 'LinkedIn must never be auto-applied to');
    assert.equal(linkedin.automation.automatedApply, 'prohibited');
    assert.equal(linkedin.automation.automatedSearch, 'prohibited');
    assert.match(linkedin.complianceNote, /no (scraping|bots)/i);
  });
});

describe('connector board lists (bulk paste → store → verify → prune)', () => {
  let client;
  before(async () => {
    client = makeClient(server.base);
    await registerUser(client, `boards-${Date.now()}@example.com`);
  });

  test('a pasted list is stored whole and comes back unmangled', async () => {
    // Regression guard: the config column is JSON text. Spreading it instead of parsing
    // it turned every saved setting into a map of single characters, which silently
    // discarded the user's board list.
    const pasted = 'vercel, figma, stripe\ntailwindlabs, robinhood, toast';
    // A new account is seeded with the curated public boards, so this test starts by
    // replacing the list with its own fixture — the point here is the round trip.
    const saved = await client.post('/api/connectors/greenhouse/boards', { text: pasted, replace: true });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.added, 6);
    assert.equal(saved.body.total, 6);

    const list = await client.get('/api/connectors');
    const greenhouse = list.body.connectors.find((c) => c.key === 'greenhouse');
    assert.equal(typeof greenhouse.config, 'object', 'config must be an object, not a string');
    assert.deepEqual(greenhouse.config.boardTokens, ['vercel', 'figma', 'stripe', 'tailwindlabs', 'robinhood', 'toast']);
    assert.equal(greenhouse.enabled, true, 'saving a list should switch the source on');
  });

  test('re-pasting the same names adds nothing, and new ones append', async () => {
    const again = await client.post('/api/connectors/greenhouse/boards', { text: 'vercel, figma' });
    assert.equal(again.body.added, 2);
    assert.equal(again.body.total, 6, 'duplicates must never inflate the list');

    const extra = await client.post('/api/connectors/greenhouse/boards', { tokens: ['takealotgroup', 'yoco'] });
    assert.equal(extra.body.added, 2);
    assert.equal(extra.body.total, 8);
  });

  test('replace swaps the whole list rather than merging', async () => {
    const replaced = await client.post('/api/connectors/lever/boards', { text: 'mukuru, ozow', replace: true });
    assert.equal(replaced.body.total, 2);
    const again = await client.post('/api/connectors/lever/boards', { text: 'paystack', replace: true });
    assert.equal(again.body.total, 1);
  });

  test('empty input is refused with a usable message', async () => {
    const res = await client.post('/api/connectors/workable/boards', { text: '   ,  , ' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /paste|identifier/i);
  });

  test('sources without a board list reject the endpoint instead of pretending', async () => {
    const res = await client.post('/api/connectors/linkedin/boards', { text: 'x' });
    assert.equal(res.status, 400);
  });

  test('pruning removes only the identifiers that failed verification', async () => {
    const pruned = await client.post('/api/connectors/greenhouse/boards/prune', { remove: ['robinhood', 'toast'] });
    assert.equal(pruned.body.removed, 2);
    assert.equal(pruned.body.total, 6);
    assert.ok(!pruned.body.identifiers.includes('robinhood'));
    assert.ok(pruned.body.identifiers.includes('vercel'), 'live boards must survive pruning');
  });

  test('verification says honestly why it cannot run without outbound access', async () => {
    const res = await client.post('/api/connectors/greenhouse/verify-boards', { limit: 2 });
    assert.equal(res.status, 200);
    // In CI the network is off, so every check must report that reason — never a made-up "ok".
    assert.equal(res.body.totals.ok, 0);
    assert.ok(res.body.other.every((r) => r.status === 'network_disabled' || r.status === 'error'), JSON.stringify(res.body.other));
  });
});

describe('client bootstrap contract', () => {
  test('the version endpoint tells the client whether demo sign-in is available', async () => {
    // The client uses this to decide whether an embedded preview may re-open the demo
    // workspace after a reload. Production reports false, so a real deployment can never
    // silently hand someone the demo account.
    const client = makeClient(server.base);
    const res = await client.get('/api/version');
    assert.equal(res.status, 200);
    assert.ok(res.body.client, 'the served bundle name is published for stale-cache checks');
    assert.equal(typeof res.body.demoLogin, 'boolean', 'the demo flag must be a boolean');
  });
});

describe('default boards for a new account', () => {
  let client;
  before(async () => {
    client = makeClient(server.base);
    await registerUser(client, `defaults-${Date.now()}@example.com`);
  });

  test('a fresh account starts with the curated public boards switched on', async () => {
    const list = await client.get('/api/connectors');
    const byKey = (k) => list.body.connectors.find((c) => c.key === k);

    const greenhouse = byKey('greenhouse');
    assert.equal(greenhouse.configured, true, 'the defaults should be saved, not left empty');
    assert.equal(greenhouse.enabled, true, 'a default source must be switched on, or nothing is searched');
    assert.ok(greenhouse.config.boardTokens.length >= 20, `expected a substantial list, got ${greenhouse.config.boardTokens.length}`);
    assert.ok(greenhouse.config.boardTokens.includes('takealotcom'), 'South African boards should be included');
    assert.ok(!JSON.stringify(greenhouse.config).includes('"0":'), 'the config must be an object, not a spread string');

    assert.deepEqual(byKey('lever').config.companies, ['moo', 'getwingapp', 'jobgether', 'smarsh']);
    assert.ok(byKey('workable').config.subdomains.includes('sparkschools'));
  });

  test('a hunt queries those boards, and seeding never overwrites a saved list', async () => {
    const before = await client.post('/api/sources/search', {});
    assert.equal(before.status, 200);
    assert.ok(before.body.sourcesQueried.includes('greenhouse'), JSON.stringify(before.body.sourcesQueried));

    await client.post('/api/connectors/greenhouse/boards', { tokens: ['my-own-board'], replace: true });
    await client.post('/api/sources/search', {});

    const list = await client.get('/api/connectors');
    const greenhouse = list.body.connectors.find((c) => c.key === 'greenhouse');
    assert.deepEqual(greenhouse.config.boardTokens, ['my-own-board'], 'a list the user saved must survive re-seeding');
  });
});

describe('integrations: mail account and AI providers', () => {
  let client;
  before(async () => {
    client = makeClient(server.base);
    await registerUser(client, `integrations-${Date.now()}@example.com`);
  });

  test('the mail form offers presets and never leaks the password back', async () => {
    const before = await client.get('/api/settings/email');
    assert.equal(before.status, 200);
    assert.ok(before.body.email.presets.length >= 4, 'provider presets should be offered');
    const gmail = before.body.email.presets.find((p) => p.id === 'gmail');
    assert.equal(gmail.host, 'smtp.gmail.com');
    assert.match(gmail.passwordHelp, /app password/i, 'Gmail must tell the user about app passwords');

    const secret = 'abcd efgh ijkl mnop';
    const saved = await client.put('/api/settings/email', {
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      user: 'candidate@example.com',
      pass: secret,
      from: 'Candidate <candidate@example.com>',
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.email.passwordSet, true);
    assert.equal(saved.body.email.source, 'account');
    assert.ok(!JSON.stringify(saved.body).includes(secret), 'the password must never be returned');
  });

  test('saving an empty password keeps the stored one, and clearing removes the account', async () => {
    const kept = await client.put('/api/settings/email', { host: 'smtp.gmail.com', user: 'candidate@example.com', pass: '' });
    assert.equal(kept.body.email.passwordSet, true, 'an empty password must not wipe the stored one');

    const cleared = await client.put('/api/settings/email', { clear: true });
    // Nothing was stored by the user any more — only the server environment could supply
    // mail settings, and the test server has none, so the source is 'none'.
    assert.notEqual(cleared.body.email.source, 'account', 'clearing must remove the account-level settings');
    assert.equal(cleared.body.email.passwordSet, false);
  });

  test('the AI catalogue lists several genuinely free providers', async () => {
    const res = await client.get('/api/settings/ai');
    assert.equal(res.status, 200);
    const free = res.body.catalogue.filter((p) => p.free);
    assert.ok(free.length >= 6, `expected several free providers, got ${free.length}`);
    for (const id of ['google', 'groq', 'cerebras', 'openrouter', 'github', 'mistral']) {
      assert.ok(free.some((p) => p.id === id), `${id} should be offered as a free provider`);
    }
    for (const provider of free) {
      assert.ok(provider.signup.startsWith('https://'), `${provider.id} needs a signup link`);
      assert.ok(provider.freeTier.length > 10, `${provider.id} needs an honest free-tier note`);
    }
  });

  test('AI keys are stored, masked on return, and several can be stacked', async () => {
    const keyOne = 'AIzaSyEXAMPLEKEY1234567890';
    const keyTwo = 'gsk_EXAMPLEKEY0987654321';
    const saved = await client.put('/api/settings/ai', {
      providers: [
        { id: 'google', apiKey: keyOne },
        { id: 'groq', apiKey: keyTwo },
      ],
    });
    assert.equal(saved.status, 200);
    const serialised = JSON.stringify(saved.body);
    assert.ok(!serialised.includes(keyOne), 'the Google key must never be returned');
    assert.ok(!serialised.includes(keyTwo), 'the Groq key must never be returned');
    assert.equal(saved.body.configured.find((c) => c.id === 'google').keySet, true);
    assert.deepEqual(saved.body.active, ['google', 'groq'], 'both providers should be active, in order');
    assert.match(saved.body.summary.note, /tried in order/i);

    // Re-saving without a key must keep the stored one rather than silently dropping it.
    const again = await client.put('/api/settings/ai', { providers: [{ id: 'google' }, { id: 'groq' }] });
    assert.deepEqual(again.body.active, ['google', 'groq']);

    const cleared = await client.put('/api/settings/ai', { providers: [] });
    assert.deepEqual(cleared.body.active, []);
    assert.equal(cleared.body.summary.enabled, false);
    assert.match(cleared.body.summary.note, /deterministic/i, 'with no keys the app must say it uses the built-in engine');
  });

  test('an unknown provider is refused rather than stored', async () => {
    const res = await client.put('/api/settings/ai', { providers: [{ id: 'not-a-real-provider', apiKey: 'x' }] });
    // The route accepts the shape; the registry simply ignores what it cannot use.
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.active, []);
  });
});
