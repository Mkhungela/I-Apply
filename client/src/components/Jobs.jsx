/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Badge, Card, Chip, EmptyState, Field, Modal, ScoreRing, SectionTitle, Spinner, Tabs, formatDate, money, timeAgo, useToast } from './ui.jsx';

const DECISION_TONE = { auto_apply: 'good', review: 'brand', skip: 'default' };
const DECISION_LABEL = { auto_apply: 'Auto-apply', review: 'Review', skip: 'Below policy' };

export default function Jobs({ onOpenApplication, selectedJobId, clearSelectedJob }) {
  const [jobs, setJobs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [minScore, setMinScore] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPaste, setShowPaste] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const { push } = useToast();

  const load = async (override = {}) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      const f = override.filter ?? filter;
      if (f !== 'all') params.set('status', f);
      const q = override.query ?? query;
      if (q) params.set('q', q);
      const s = override.minScore ?? minScore;
      if (s) params.set('minScore', String(s));
      params.set('limit', '120');
      const data = await api.jobs(`?${params.toString()}`);
      setJobs(data.jobs || []);
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    if (!selectedJobId) return;
    void openJob(selectedJobId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJobId]);

  const openJob = async (id) => {
    try {
      const data = await api.job(id);
      setDetail(data);
    } catch (err) {
      push(err.message, 'error');
    }
  };

  const analyze = async (id) => {
    setBusy(true);
    try {
      const { match } = await api.analyzeJob(id);
      push(`Match ${match.score}% — ${match.decisionReason}`, match.score >= 70 ? 'success' : 'warn');
      await openJob(id);
      await load();
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const prepare = async (id) => {
    setBusy(true);
    try {
      const result = await api.prepareJob(id);
      push(
        result.outcome === 'submitted'
          ? 'Application submitted.'
          : result.outcome === 'awaiting_user_action' || result.outcome === 'awaiting_answers'
            ? 'Application prepared — open the tracker to review and submit.'
            : `Outcome: ${result.outcome}`,
        'success'
      );
      await openJob(id);
      await load();
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const skip = async (id) => {
    try {
      await api.skipJob(id, 'Skipped from the job list');
      push('Skipped — the agent will not touch it.', 'warn');
      setDetail(null);
      await load();
    } catch (err) {
      push(err.message, 'error');
    }
  };

  const tabs = [
    { key: 'all', label: 'All' },
    { key: 'unapplied', label: 'Not applied' },
    { key: 'awaiting_user_action', label: 'Awaiting action' },
    { key: 'applied', label: 'Applied' },
    { key: 'interview', label: 'Interview' },
    { key: 'rejected', label: 'Rejected' },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Jobs</h1>
          <p className="mt-1 text-sm text-ink-500">
            Every job discovered, with the match analysis behind its score. {jobs.length} shown.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => setShowPaste(true)}>
            🔗 Paste a job link
          </button>
          <button className="btn-ghost" onClick={() => setShowImport(true)}>
            Import CSV/JSON
          </button>
        </div>
      </div>

      <Card className="card-pad">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <Field label="Search">
              <input className="input" value={query} placeholder="Title or company" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
            </Field>
          </div>
          <div className="w-40">
            <Field label="Minimum score">
              <select className="input" value={minScore} onChange={(e) => { setMinScore(e.target.value); load({ minScore: e.target.value }); }}>
                <option value="">Any</option>
                <option value="60">60%+</option>
                <option value="70">70%+</option>
                <option value="80">80%+</option>
                <option value="90">90%+</option>
              </select>
            </Field>
          </div>
          <button className="btn-ghost" onClick={() => load()}>
            Apply filters
          </button>
        </div>
        <div className="mt-4">
          <Tabs tabs={tabs} value={filter} onChange={setFilter} />
        </div>
      </Card>

      {loading ? (
        <Spinner label="Loading jobs…" />
      ) : jobs.length ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto scroll-thin">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Role</th>
                  <th>Company</th>
                  <th>Location</th>
                  <th>Salary</th>
                  <th>Posted</th>
                  <th>Source</th>
                  <th>Policy</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-ink-50">
                    <td>
                      <ScoreRing score={job.score ?? 0} size={46} />
                    </td>
                    <td className="max-w-[16rem]">
                      <button className="truncate text-left font-medium text-ink-900 hover:text-brand-700" onClick={() => openJob(job.id)}>
                        {job.title}
                      </button>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {job.isDemo ? <Chip tone="warn">Demo</Chip> : null}
                        {job.workMode ? <Chip>{job.workMode}</Chip> : null}
                        {job.employmentType ? <Chip>{job.employmentType}</Chip> : null}
                        {(job.riskFlags || []).length ? <Chip tone="danger">risk</Chip> : null}
                      </div>
                    </td>
                    <td className="max-w-[12rem] truncate">{job.company || '—'}</td>
                    <td className="max-w-[12rem] truncate text-sm text-ink-600">{job.location || '—'}</td>
                    <td className="whitespace-nowrap text-sm">{money(job.salary) || '—'}</td>
                    <td className="whitespace-nowrap text-xs text-ink-500">{job.postedAt ? timeAgo(job.postedAt) : formatDate(job.discoveredAt)}</td>
                    <td className="text-xs text-ink-500">{job.source}</td>
                    <td>{job.decision ? <Chip tone={DECISION_TONE[job.decision]}>{DECISION_LABEL[job.decision]}</Chip> : <Chip tone="warn">Not scored</Chip>}</td>
                    <td className="whitespace-nowrap">
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => openJob(job.id)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <EmptyState
          title="No jobs match these filters"
          body="Try widening the filters, run the agent, or paste a job link to analyse it immediately."
          action={
            <button className="btn-primary" onClick={() => setShowPaste(true)}>
              Paste a job link
            </button>
          }
        />
      )}

      <JobDetail
        detail={detail}
        busy={busy}
        onClose={() => {
          setDetail(null);
          clearSelectedJob?.();
        }}
        onAnalyze={analyze}
        onPrepare={prepare}
        onSkip={skip}
        onOpenApplication={onOpenApplication}
      />

      <Modal open={showPaste} onClose={() => setShowPaste(false)} title="Paste a job link">
        <PasteJob
          onDone={async () => {
            setShowPaste(false);
            await load();
          }}
        />
      </Modal>

      <Modal open={showImport} onClose={() => setShowImport(false)} title="Import jobs from CSV or JSON">
        <ImportJobs
          onDone={async () => {
            setShowImport(false);
            await load();
          }}
        />
      </Modal>
    </div>
  );
}

function JobDetail({ detail, busy, onClose, onAnalyze, onPrepare, onSkip, onOpenApplication }) {
  if (!detail) return null;
  const { job, match, application, events } = detail;
  const components = match?.breakdown?.components || {};
  const weights = match?.breakdown?.weights || {};
  const labels = {
    skills: 'Skills & tools',
    experience: 'Experience level',
    roleFit: 'Role fit',
    titleAlignment: 'Title alignment',
    location: 'Location / remote',
    industry: 'Industry',
    education: 'Education',
    employmentType: 'Employment type',
    recency: 'Recency',
  };
  return (
    <Modal open onClose={onClose} wide title={`${job.title}${job.company ? ` — ${job.company}` : ''}`}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start gap-4">
          <ScoreRing score={match?.score ?? 0} size={72} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-2">
              {job.isDemo ? <Badge tone="warn">Demo listing</Badge> : null}
              {match ? <Badge tone={DECISION_TONE[match.decision]}>{DECISION_LABEL[match.decision]}</Badge> : <Badge tone="warn">Not scored</Badge>}
              {job.workMode ? <Badge>{job.workMode}</Badge> : null}
              {job.employmentType ? <Badge>{job.employmentType}</Badge> : null}
              <Badge>{job.sourceKey}</Badge>
            </div>
            <p className="mt-2 text-sm text-ink-600">
              {job.location || 'Location not stated'} · posted {job.postedAt ? formatDate(job.postedAt) : 'unknown'} ·{' '}
              {job.applicantsCount !== null && job.applicantsCount !== undefined ? `${job.applicantsCount} applicants` : 'applicant count unknown'} ·{' '}
              {money({ min: job.salaryMin, max: job.salaryMax, currency: job.salaryCurrency }) || 'salary not stated'}
            </p>
            {match?.decisionReason ? <p className="mt-1 text-sm font-medium text-ink-800">{match.decisionReason}</p> : null}
            {job.risk?.level && job.risk.level !== 'low' ? (
              <p className={`mt-2 rounded-lg px-3 py-2 text-xs ${job.risk.level === 'high' ? 'bg-danger-500/10 text-danger-600' : 'bg-warn-500/10 text-warn-600'}`}>
                <strong>Safety screening ({job.risk.level}):</strong> {(job.risk.flags || []).map((f) => f.label).join('; ')}
              </p>
            ) : null}
          </div>
        </div>

        {match ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-accent-500/30 bg-accent-500/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent-600">Strong matches</p>
              <ul className="mt-1.5 space-y-1 text-sm">
                {(match.strongMatches || []).map((s) => (
                  <li key={s}>✓ {s}</li>
                ))}
                {!match.strongMatches?.length ? <li className="text-ink-500">None detected</li> : null}
              </ul>
            </div>
            <div className="rounded-lg border border-warn-500/30 bg-warn-500/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-warn-600">Potential gaps</p>
              <ul className="mt-1.5 space-y-1 text-sm">
                {(match.gaps || []).map((g) => (
                  <li key={g}>○ {g}</li>
                ))}
                {!match.gaps?.length ? <li className="text-ink-500">No gaps detected</li> : null}
              </ul>
            </div>
          </div>
        ) : null}

        {match ? (
          <details className="rounded-lg border border-ink-200 p-3">
            <summary className="cursor-pointer text-sm font-semibold">Why this score — full breakdown</summary>
            <div className="mt-3 space-y-2">
              {Object.entries(components).map(([key, value]) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-36 shrink-0 text-xs text-ink-500">
                    {labels[key] || key} <span className="text-ink-400">({Math.round((weights[key] || 0) * 100)}%)</span>
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                    <span className="block h-full rounded-full bg-brand-500" style={{ width: `${Math.round(value * 100)}%` }} />
                  </span>
                  <span className="w-10 text-right text-xs tabular-nums text-ink-600">{Math.round(value * 100)}%</span>
                </div>
              ))}
              {(match.breakdown?.caps || []).map((cap) => (
                <p key={cap.reason} className="text-xs text-warn-600">
                  Cap applied — {cap.reason} → {cap.cap}%
                </p>
              ))}
              {(match.breakdown?.notes || []).map((note) => (
                <p key={note} className="text-xs text-ink-500">
                  • {note}
                </p>
              ))}
            </div>
          </details>
        ) : null}

        {application ? (
          <div className="rounded-lg border border-brand-500/30 bg-brand-50/50 p-3">
            <p className="text-sm font-semibold text-brand-800">
              Application: {application.status.replace(/_/g, ' ')} · mode {application.mode}
            </p>
            {application.humanAction?.questions?.length ? (
              <p className="mt-1 text-xs text-brand-900">Needs: {application.humanAction.questions.join(' · ')}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => onOpenApplication(application.id)}>
                Open in tracker
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" disabled={busy} onClick={() => onAnalyze(job.id)}>
            {match ? 'Re-analyse' : 'Analyse match'}
          </button>
          <button className="btn-primary" disabled={busy || !match} onClick={() => onPrepare(job.id)}>
            Prepare application
          </button>
          {job.url ? (
            <a className="btn-ghost" href={job.url} target="_blank" rel="noreferrer noopener">
              Open job posting ↗
            </a>
          ) : null}
          <button className="btn-danger" onClick={() => onSkip(job.id)}>
            Skip this job
          </button>
        </div>

        <div>
          <p className="label">Advert</p>
          <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-ink-100 bg-ink-50/40 p-3 text-xs leading-relaxed text-ink-700 scroll-thin">
            {job.description || 'No advert text stored — paste the description when adding the link to improve matching.'}
          </pre>
        </div>

        {events?.length ? (
          <div>
            <p className="label">Application timeline</p>
            <ol className="space-y-1 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="w-36 shrink-0 text-xs text-ink-400">{formatDate(e.at)}</span>
                  <span className="text-ink-700">{e.message}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function PasteJob({ onDone }) {
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [fetchPage, setFetchPage] = useState(true);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  const submit = async () => {
    setBusy(true);
    try {
      const result = await api.addJobLink({ url, description: description || undefined, title: title || undefined, company: company || undefined, location: location || undefined, fetchPage });
      if (result.duplicate) push('You already have this job — it was not added twice.', 'warn');
      else push(`Added${result.detected?.ats ? ` (hosted on ${result.detected.ats})` : ''}. ${result.match ? `Match ${result.match.score}%.` : ''}`, 'success');
      (result.warnings || []).forEach((w) => push(w, 'warn'));
      onDone();
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800">
        This is the compliant route for LinkedIn, Indeed, Glassdoor, PNet, Careers24, Wellfound and Workday: you browse normally, paste the
        link, and AI Job Hunter does the matching, tailoring, answers and tracking. No scraping, no bots.
      </p>
      <Field label="Job URL" hint="Paste the full link from the job board.">
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.linkedin.com/jobs/view/…" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Job title (optional)">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="UX/UI Designer" />
        </Field>
        <Field label="Company (optional)">
          <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Kora Health" />
        </Field>
        <Field label="Location (optional)">
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Johannesburg, South Africa" />
        </Field>
        <Field label="Fetch the page text?" hint="One user-initiated fetch. Some boards block it — paste the text instead if so.">
          <select className="input" value={fetchPage ? 'yes' : 'no'} onChange={(e) => setFetchPage(e.target.value === 'yes')}>
            <option value="yes">Yes — try to read the advert</option>
            <option value="no">No — I'll paste the description</option>
          </select>
        </Field>
      </div>
      <Field label="Advert text (optional but improves matching)">
        <textarea className="input h-40" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Paste the full job description here…" />
      </Field>
      <button className="btn-primary w-full" onClick={submit} disabled={busy || !/^https?:\/\//.test(url)}>
        {busy ? 'Analysing…' : 'Add, analyse and prepare'}
      </button>
    </div>
  );
}

function ImportJobs({ onDone }) {
  const [payload, setPayload] = useState('');
  const [busy, setBusy] = useState(false);
  const { push } = useToast();
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-600">
        Paste a CSV export or a JSON array. Column names are auto-detected: <span className="font-mono text-xs">title, company, location, url, description, posted_at, salary, employment_type</span>.
      </p>
      <textarea className="input h-52 font-mono text-xs" value={payload} onChange={(e) => setPayload(e.target.value)} placeholder={'title,company,location,url\nUX Designer,Acme,"Cape Town",https://…'} />
      <button
        className="btn-primary w-full"
        disabled={busy || payload.trim().length < 5}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await api.importJobs(payload);
            push(`Imported ${result.imported} new job(s) (${result.duplicates} duplicate, ${result.rows} rows).`, 'success');
            (result.warnings || []).forEach((w) => push(w, 'warn'));
            onDone();
          } catch (err) {
            push(err.message, 'error');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Importing…' : 'Import and analyse'}
      </button>
    </div>
  );
}
