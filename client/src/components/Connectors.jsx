import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Badge, Card, Chip, Field, Modal, SectionTitle, Spinner, Toggle, formatDateTime, useToast } from './ui.jsx';

const CATEGORY_LABEL = {
  ats: 'Applicant tracking systems',
  remote_board: 'Remote job boards',
  job_board: 'Job boards',
  feed: 'Feeds',
  manual: 'Manual / imports',
  social_board: 'Social platforms',
  za_job_board: 'South African job boards',
  startup_board: 'Startup boards',
  employer: 'Employer careers pages',
  other: 'Other',
};

const POLICY_TONE = {
  allowed: 'good',
  allowed_with_conditions: 'warn',
  allowed_with_api_key: 'warn',
  allowed_via_paste: 'warn',
  user_initiated: 'warn',
  not_applicable: 'default',
  prohibited: 'bad',
  not_permitted_without_partner_access: 'bad',
  not_permitted_without_account_access: 'bad',
  not_permitted_without_employer_access: 'bad',
  not_permitted_without_employer_api_credentials: 'bad',
  depends_on_host: 'warn',
  unknown: 'default',
};

const POLICY_LABEL = {
  allowed: 'Automation permitted',
  allowed_with_conditions: 'Permitted with conditions',
  allowed_with_api_key: 'Needs your API key',
  allowed_via_paste: 'Paste-a-link only',
  user_initiated: 'User-initiated only',
  not_applicable: 'Applies off-platform',
  prohibited: 'Automation not permitted',
  not_permitted_without_partner_access: 'Needs partner access',
  not_permitted_without_account_access: 'Needs account credentials',
  not_permitted_without_employer_access: 'Needs employer integration',
  not_permitted_without_employer_api_credentials: 'Needs employer API key',
  depends_on_host: 'Depends on the host',
  unknown: 'Unknown',
};

export default function Connectors() {
  const [data, setData] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  const [active, setActive] = useState(null);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  const load = async () => {
    try {
      const res = await api.connectors();
      setData(res);
      setCapabilities(res.capabilities);
    } catch (err) {
      push(err.message, 'error');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) return <Spinner label="Loading job sources…" />;

  const grouped = data.connectors.reduce((acc, c) => {
    const key = c.category || 'other';
    acc[key] = acc[key] || [];
    acc[key].push(c);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Job sources</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-500">
          Each source declares exactly what its platform permits. Where automation is allowed you get live search and, for Greenhouse boards,
          optional automatic submission. Where it is prohibited — LinkedIn, Indeed, Glassdoor, Wellfound, PNet, Careers24, Workday — the connector
          is assisted-only and there is deliberately no code path that automates it.
        </p>
      </div>

      {capabilities ? (
        <Card className="card-pad space-y-3">
          <SectionTitle title="Environment & capabilities" subtitle="What this instance can and cannot do right now." />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-ink-200 p-3 text-sm">
              <p className="font-semibold">Language engine</p>
              <p className="text-ink-600">{capabilities.llm.enabled ? `${capabilities.llm.provider} (${capabilities.llm.model})` : 'Built-in deterministic engine'}</p>
              <p className="mt-1 text-xs text-ink-500">{capabilities.llm.note}</p>
            </div>
            <div className="rounded-lg border border-ink-200 p-3 text-sm">
              <p className="font-semibold">Outbound network</p>
              <p className={capabilities.network.enabled ? 'text-accent-600' : 'text-warn-600'}>{capabilities.network.enabled ? 'Enabled' : 'Disabled in this environment'}</p>
              <p className="mt-1 text-xs text-ink-500">{capabilities.network.note}</p>
            </div>
            <div className="rounded-lg border border-ink-200 p-3 text-sm">
              <p className="font-semibold">Email applications</p>
              <p className={capabilities.email.available ? 'text-accent-600' : 'text-warn-600'}>{capabilities.email.available ? `Ready — from ${capabilities.email.from}` : 'SMTP not configured'}</p>
              <p className="mt-1 text-xs text-ink-500">
                {capabilities.email.available ? 'Adverts that invite email applications can be sent from your own mail account.' : capabilities.email.requiredEnv?.join(', ')}
              </p>
            </div>
            <div className="rounded-lg border border-ink-200 p-3 text-sm">
              <p className="font-semibold">Scheduler</p>
              <p className="text-accent-600">Durable — survives restarts</p>
              <p className="mt-1 text-xs text-ink-500">{capabilities.scheduler.note}</p>
            </div>
          </div>
          {capabilities.blockers?.length ? (
            <div className="rounded-lg bg-warn-500/10 p-3 text-xs text-warn-600">
              <p className="font-semibold uppercase tracking-wide">Before your first live hunt</p>
              <ul className="mt-1 list-disc pl-5">
                {capabilities.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <details className="rounded-lg border border-ink-200 p-3 text-sm">
            <summary className="cursor-pointer font-semibold">Known limitations (read this)</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-600">
              {capabilities.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
        </Card>
      ) : null}

      {Object.entries(grouped).map(([category, list]) => (
        <div key={category} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">{CATEGORY_LABEL[category] || category}</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {list.map((c) => (
              <Card key={c.key} className="card-pad space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-ink-900">{c.name}</h3>
                    <p className="mt-0.5 text-xs text-ink-500">{c.description}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={c.searchable ? (c.readiness?.ready ? 'good' : 'warn') : 'default'}>
                      {c.searchable ? (c.readiness?.ready ? 'Live' : 'Needs setup') : 'Assisted'}
                    </Badge>
                    {c.autoApply ? <Badge tone="brand">Auto-submit</Badge> : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <Chip tone={POLICY_TONE[c.automationPolicy?.automatedSearch] || 'default'}>
                    Search: {POLICY_LABEL[c.automationPolicy?.automatedSearch] || c.automationPolicy?.automatedSearch}
                  </Chip>
                  <Chip tone={POLICY_TONE[c.automationPolicy?.automatedApply] || 'default'}>
                    Apply: {POLICY_LABEL[c.automationPolicy?.automatedApply] || c.automationPolicy?.automatedApply}
                  </Chip>
                </div>

                <p className="rounded-lg bg-ink-50 p-2.5 text-xs text-ink-600">
                  <strong className="font-semibold">Why:</strong> {c.automationPolicy?.basis}
                  {c.automationPolicy?.risk ? <span className="mt-1 block text-warn-600">{c.automationPolicy.risk}</span> : null}
                </p>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
                  <span>
                    {c.configured ? `Configured · last sync ${c.lastSyncAt ? formatDateTime(c.lastSyncAt) : 'never'}` : 'Not configured'}
                    {c.lastError ? ` · ${c.lastError}` : ''}
                  </span>
                  <div className="flex gap-2">
                    <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => setActive(c)}>
                      Configure
                    </button>
                    {c.searchable ? (
                      <button
                        className="btn-ghost px-2.5 py-1 text-xs"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const res = await api.testConnector(c.key);
                            push(res.ok ? `Working — ${res.count} job(s) returned.` : res.message || 'Not ready yet.', res.ok ? 'success' : 'warn');
                          } catch (err) {
                            push(err.message, 'error');
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Test
                      </button>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}

      <ConnectorModal
        connector={active}
        onClose={() => setActive(null)}
        onSaved={async () => {
          setActive(null);
          await load();
        }}
      />
    </div>
  );
}

const BOARD_SOURCES = {
  greenhouse: { field: 'boardTokens', noun: 'board token', example: 'stripe, figma, takealotgroup', hint: 'The token in boards.greenhouse.io/<token> — also works with job-boards.greenhouse.io/<token>. You can paste a whole list at once: commas, spaces, new lines, or a JSON array all work.' },
  lever: { field: 'companies', noun: 'company slug', example: 'mukuru, ozow, paystack', hint: 'The slug in jobs.lever.co/<slug>. Paste the whole list — it is checked and stored in one go.' },
  workable: { field: 'subdomains', noun: 'account subdomain', example: 'valr, luno, purple-group', hint: 'The subdomain in apply.workable.com/<subdomain>. Paste as many as you like.' },
  smartrecruiters: { field: 'companies', noun: 'company identifier', example: 'Ubisoft, Bosch', hint: 'The company identifier in jobs.smartrecruiters.com/<company>.' },
};

/**
 * Pastes, stores and verifies a board list.
 *
 * Verification calls each platform's own public read API, so the result is the truth:
 * a token that returns postings is a real board, a 404 is not. Nothing is scraped and
 * no platform rule is bent to do it.
 */
function BoardListEditor({ connector, config, setConfig, push }) {
  const spec = BOARD_SOURCES[connector.key];
  const stored = String(config[spec.field] || '').split(/[,\n;]+/).map((v) => v.trim()).filter(Boolean);
  const [bulk, setBulk] = useState('');
  const [busy, setBusy] = useState('');
  const [report, setReport] = useState(null);

  const pasteCount = bulk.split(/[,\n;\s]+/).filter(Boolean).length;

  const save = async (replace) => {
    if (!pasteCount) return push('Paste at least one identifier first.', 'error');
    setBusy('save');
    try {
      const res = await api.saveBoards(connector.key, { text: bulk, replace });
      setConfig({ ...config, [spec.field]: (res.identifiers || []).join(', '), boardOffset: 0 });
      setBulk('');
      setReport(null);
      push(
        replace ? `Replaced with ${res.total} ${spec.noun}(s).` : `Added ${res.added} — ${res.total} ${spec.noun}(s) stored.`,
        'success'
      );
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const verify = async () => {
    setBusy('verify');
    setReport(null);
    try {
      const res = await api.verifyBoards(connector.key, { limit: 60 });
      setReport(res);
      const { ok: live, notFound, jobsFound } = res.totals;
      push(
        notFound
          ? `${live} of ${res.checked} boards are live (${jobsFound} open roles). ${notFound} returned nothing.`
          : `${live} of ${res.checked} boards are live — ${jobsFound} open roles in total.`,
        notFound ? 'info' : 'success'
      );
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const pruneDead = async () => {
    if (!report?.notFound?.length) return;
    setBusy('prune');
    try {
      const res = await api.pruneBoards(connector.key, report.notFound);
      setConfig({ ...config, [spec.field]: (res.identifiers || []).join(', ') });
      push(`Removed ${res.removed} dead ${spec.noun}(s); ${res.total} left.`, 'success');
      setReport(null);
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-3">
      <Field label={`${connector.name} — identifiers (${stored.length} stored)`} hint={spec.hint}>
        <textarea
          className="input h-28 font-mono text-xs"
          placeholder={spec.example}
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-ghost" disabled={!!busy} onClick={() => save(false)}>
          {busy === 'save' ? 'Adding…' : `Add ${pasteCount || ''} to list`}
        </button>
        <button className="btn-ghost" disabled={!!busy} onClick={() => save(true)}>
          Replace list
        </button>
        <button className="btn-ghost" disabled={!!busy || !stored.length} onClick={verify}>
          {busy === 'verify' ? 'Checking boards…' : 'Verify saved list'}
        </button>
        {stored.length > 60 ? (
          <span className="text-xs text-ink-400">Checks the first 60 per click (the rest stay saved).</span>
        ) : null}
      </div>
      <p className="text-xs text-ink-400">
        Verification asks the platform&rsquo;s own public API about each identifier. A board with open roles is real; a 404 is not —
        nothing is scraped, guessed or scraped from search engines.
      </p>

      {report ? (
        <div className="max-h-52 space-y-2 overflow-auto rounded-lg border border-ink-200 p-3 text-xs">
          <p className="text-ink-700">
            <strong>{report.totals.ok}</strong> live · <strong>{report.totals.notFound}</strong> not found ·{' '}
            <strong>{report.totals.jobsFound}</strong> open roles
            {report.remaining ? ` · ${report.remaining} not checked yet` : ''}
          </p>
          {report.working?.slice(0, 40).map((r) => (
            <p key={r.identifier} className="text-ink-600">
              ✓ <span className="font-mono">{r.identifier}</span> — {r.company} · {r.jobs} role{r.jobs === 1 ? '' : 's'}
            </p>
          ))}
          {report.notFound?.length ? (
            <div className="border-t border-ink-200 pt-2">
              <p className="text-ink-600">Not found (wrong spelling, or the company moved ATS):</p>
              <p className="mt-1 font-mono text-ink-500">{report.notFound.join(', ')}</p>
              <button className="btn-ghost mt-2" disabled={!!busy} onClick={pruneDead}>
                {busy === 'prune' ? 'Removing…' : `Remove ${report.notFound.length} dead ${spec.noun}(s) from the list`}
              </button>
            </div>
          ) : null}
          {report.other?.length ? (
            <p className="text-ink-500">
              Could not be checked: {report.other.map((r) => `${r.identifier} (${r.status})`).join(', ')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ConnectorModal({ connector, onClose, onSaved }) {
  const [enabled, setEnabled] = useState(false);
  const [config, setConfig] = useState({});
  const [credentials, setCredentials] = useState({});
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  useEffect(() => {
    if (!connector) return;
    setEnabled(!!connector.enabled);
    const cfg = connector.config || {};
    const next = {};
    for (const field of connector.configuration || []) {
      const value = cfg[field.name];
      next[field.name] = Array.isArray(value) ? value.join(', ') : value ?? '';
    }
    setConfig(next);
    setCredentials({});
  }, [connector]);

  if (!connector) return null;

  return (
    <Modal open onClose={onClose} title={connector.name}>
      <div className="space-y-4">
        <p className="text-sm text-ink-600">{connector.description}</p>

        <div className="rounded-lg border border-ink-200 p-3 text-xs text-ink-600">
          <p>
            <strong>Permitted route:</strong> {connector.automationPolicy?.basis}
          </p>
          {connector.complianceNote ? <p className="mt-1 text-ink-500">{connector.complianceNote}</p> : null}
        </div>

        {connector.credentials?.length ? (
          <div className="space-y-3">
            <p className="label">Credentials / integrations</p>
            {connector.credentials.map((cred) => (
              <Field key={cred.name} label={`${cred.label}${cred.required ? ' (required)' : ' (optional)'}`} hint={cred.help}>
                <input
                  className="input"
                  type="password"
                  placeholder={cred.supplied ? `Stored: ${cred.masked}` : 'Not set'}
                  value={credentials[cred.name] || ''}
                  onChange={(e) => setCredentials({ ...credentials, [cred.name]: e.target.value })}
                />
              </Field>
            ))}
            <p className="text-xs text-ink-400">Credentials are encrypted at rest (AES-256-GCM) and never returned to the browser.</p>
          </div>
        ) : null}

        {BOARD_SOURCES[connector.key] ? (
          <BoardListEditor connector={connector} config={config} setConfig={setConfig} push={push} />
        ) : null}

        {connector.configuration?.length ? (
          <div className="space-y-3">
            <p className="label">Configuration</p>
            {connector.configuration
              .filter((field) => BOARD_SOURCES[connector.key]?.field !== field.name)
              .map((field) => (
              <Field key={field.name} label={field.label} hint={field.help}>
                {field.name === 'payload' ? (
                  <textarea className="input h-32 font-mono text-xs" value={config[field.name] || ''} onChange={(e) => setConfig({ ...config, [field.name]: e.target.value })} />
                ) : (
                  <input className="input" value={config[field.name] || ''} onChange={(e) => setConfig({ ...config, [field.name]: e.target.value })} />
                )}
              </Field>
            ))}
          </div>
        ) : null}

        {connector.searchable ? (
          <Toggle
            label="Enable this source"
            hint="Enabled sources are searched on every scheduled run."
            checked={enabled}
            onChange={setEnabled}
          />
        ) : (
          <p className="rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
            This source is assisted-only by design. Add jobs by pasting their links on the Jobs page — matching, tailoring, answers and tracking all
            work exactly the same.
          </p>
        )}

        {connector.key === 'greenhouse' ? (
          <div className="space-y-2">
            <Toggle
              label="Submit applications automatically through Greenhouse (opt in)"
              hint="Only used when automatic application mode is on and a match scores at or above your threshold. Anything the API cannot answer pauses for you instead."
              checked={!!connector.config?.allowAutoSubmit}
              onChange={(on) => setConfig({ ...config, allowAutoSubmit: on })}
            />
            {!connector.credentials?.find((c) => c.name === 'boardApiKey')?.supplied ? (
              <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                Greenhouse only accepts automated submissions with a Job Board API key that the <em>hiring company</em> creates in their own
                account — candidates cannot get one. Without it, AI Job Hunter still finds the jobs and prepares every application in full,
                then hands it to you to submit on the posting. If a company gives you their key, add it above and submission becomes automatic.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const payload = { enabled, config, credentials: Object.keys(credentials).length ? credentials : undefined };
                await api.saveConnector(connector.key, payload);
                push(`${connector.name} saved.`, 'success');
                onSaved();
              } catch (err) {
                push(err.message, 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
