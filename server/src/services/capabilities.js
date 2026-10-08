/**
 * Capability reporting.
 *
 * The UI shows this so nobody is misled about what the system can and cannot do:
 * which sources are live, which are assisted-only, what credentials are missing and
 * where an integration genuinely cannot be built without approved access.
 */
import { db } from '../db/index.js';
import { config } from '../config.js';
import { describe as describeLlm } from './llm.js';
import { emailCapability } from '../connectors/emailApply.js';
import { listForUser } from '../connectors/index.js';

export async function summarizeCapabilities(userId) {
  const connectors = listForUser(userId);
  const settings = db().get('SELECT * FROM user_settings WHERE user_id = ?', userId);
  const profile = db().get('SELECT user_id FROM profiles WHERE user_id = ?', userId);
  const activeCv = db().get('SELECT id, filename, created_at FROM cvs WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1', userId);

  const live = connectors.filter((c) => c.searchable && c.readiness?.ready);
  const configured = connectors.filter((c) => c.searchable && c.configured);
  const assisted = connectors.filter((c) => !c.searchable);

  const blockers = [];
  if (!profile) blockers.push('Upload your CV — matching, tailoring and generation all depend on it.');
  if (!configured.length && !live.length) {
    blockers.push(
      'No live job source is configured. Enable Greenhouse/Lever/Workable/SmartRecruiters boards you care about, Remotive, Arbeitnow, Remote OK or an RSS feed — or use “Paste a job link”.'
    );
  }
  if (!settings?.auto_apply_enabled) {
    blockers.push('Automatic application mode is off, so matches are prepared and wait for your confirmation (the safe default).');
  }
  const email = emailCapability(userId);
  if (!email.available) blockers.push(email.detail);

  return {
    llm: describeLlm(userId),
    email,
    network: {
      enabled: config.networkEnabled,
      note: config.networkEnabled
        ? 'Outbound job-source requests are enabled.'
        : 'Outbound network access is disabled in this environment, so live searches cannot reach job sources. Everything else (matching, tailoring, tracking, scheduling) still works, and demo data is available.',
    },
    storage: { engine: 'SQLite (WAL)', dataDir: config.dataDir },
    scheduler: {
      durable: true,
      tickMs: config.schedulerTickMs,
      note: 'Campaigns are stored in the database and resumed after a restart. Run the server (or the standalone worker) on any always-on host and the agent keeps hunting while your devices are off.',
    },
    sources: connectors.map((c) => ({
      key: c.key,
      name: c.name,
      mode: !c.searchable ? 'assisted' : c.readiness?.ready ? 'live' : 'needs_configuration',
      enabled: c.enabled,
      configured: c.configured,
      missing: c.readiness?.missing || [],
      canAutoApply: !!c.canAutoApply,
      automation: c.automationPolicy,
      credentials: c.credentials,
      complianceNote: c.complianceNote,
    })),
    counts: { live: live.length, configured: configured.length, assisted: assisted.length, total: connectors.length },
    blockers,
    limitations: [
      'LinkedIn, Indeed, Glassdoor, Wellfound, PNet, Careers24 and Workday prohibit or restrict automated access. AI Job Hunter never automates them — it uses the assisted flow (you paste the link; it matches, tailors, drafts answers and tracks).',
      'Automatic submission is only possible where a platform publishes a submission API that accepts it. Today that is Greenhouse job boards (opt-in) and adverts that ask for applications by email over your own SMTP.',
      'Interview invitations and rejections are recorded when you mark them, or via the notification webhook if you connect it. AI Job Hunter does not read your email inbox unless you add that integration.',
      'Nothing is ever invented about you: generated text is validated against your CV and unverifiable claims are stripped.',
    ],
    cv: activeCv || null,
  };
}
