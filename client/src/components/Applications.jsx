/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
import React, { useEffect, useState } from 'react';
import { api, downloadDocument } from '../lib/api';
import { Badge, Card, Chip, EmptyState, Field, Modal, SectionTitle, Spinner, Tabs, formatDate, formatDateTime, money, useToast } from './ui.jsx';

const STATUS_TONE = {
  awaiting_user_action: 'warn',
  preparing: 'warn',
  new: 'warn',
  submitted: 'good',
  confirmed: 'good',
  interview: 'good',
  rejected: 'bad',
  failed: 'bad',
  blocked: 'bad',
  withdrawn: 'default',
  skipped: 'default',
};
const STATUS_LABEL = {
  awaiting_user_action: 'Awaiting action',
  preparing: 'Preparing',
  new: 'New',
  submitted: 'Submitted',
  confirmed: 'Confirmed',
  interview: 'Interview',
  rejected: 'Rejected',
  failed: 'Failed',
  blocked: 'Blocked',
  withdrawn: 'Withdrawn',
  skipped: 'Skipped',
};

export default function Applications({ selectedId, clearSelected }) {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const query = filter === 'all' ? '' : `?status=${filter}`;
      const data = await api.applications(query);
      setItems(data.applications || []);
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
    if (selectedId) void open(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const open = async (id) => {
    try {
      setDetail(await api.application(id));
    } catch (err) {
      push(err.message, 'error');
    }
  };

  const counts = items.reduce((acc, a) => ({ ...acc, [a.status]: (acc[a.status] || 0) + 1 }), {});

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Application tracker</h1>
        <p className="mt-1 text-sm text-ink-500">
          Every application stores the job, the match score, the CV and cover letter used, the answers, and the truthful confirmation status.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          tabs={[
            { key: 'all', label: 'All', count: items.length },
            { key: 'awaiting_user_action', label: 'Awaiting action', count: counts.awaiting_user_action || 0 },
            { key: 'submitted', label: 'Submitted', count: counts.submitted || 0 },
            { key: 'interview', label: 'Interview', count: counts.interview || 0 },
            { key: 'rejected', label: 'Rejected', count: counts.rejected || 0 },
            { key: 'failed', label: 'Failed', count: counts.failed || 0 },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <button className="btn-ghost" onClick={load}>
          Refresh
        </button>
      </div>

      {loading ? (
        <Spinner label="Loading applications…" />
      ) : items.length ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto scroll-thin">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Job</th>
                  <th>Company</th>
                  <th>Match</th>
                  <th>Mode</th>
                  <th>Submitted</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className="hover:bg-ink-50">
                    <td>
                      <Chip tone={STATUS_TONE[a.status] || 'default'}>{STATUS_LABEL[a.status] || a.status}</Chip>
                    </td>
                    <td className="max-w-[16rem]">
                      <button className="truncate text-left font-medium hover:text-brand-700" onClick={() => open(a.id)}>
                        {a.job.isDemo ? '🧪 ' : ''}
                        {a.job.title}
                      </button>
                      {a.humanAction?.type === 'captcha' ? <Chip tone="danger">CAPTCHA — needs you</Chip> : null}
                    </td>
                    <td className="max-w-[10rem] truncate">{a.job.company || '—'}</td>
                    <td className="tabular-nums">{a.matchScore ?? '—'}%</td>
                    <td className="text-xs text-ink-500">{a.mode}</td>
                    <td className="whitespace-nowrap text-xs text-ink-500">{a.submittedAt ? formatDate(a.submittedAt) : '—'}</td>
                    <td>
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => open(a.id)}>
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
        <EmptyState title="No applications here yet" body="Start a hunt, or open a job and choose “Prepare application”." />
      )}

      <ApplicationDetail
        detail={detail}
        busy={busy}
        onClose={() => {
          setDetail(null);
          clearSelected?.();
        }}
        onChanged={async () => {
          await load();
          if (detail) await open(detail.application.id);
        }}
        onBusy={setBusy}
        push={push}
      />
    </div>
  );
}

function ApplicationDetail({ detail, busy, onClose, onChanged, onBusy, push }) {
  const [answersDraft, setAnswersDraft] = useState([]);
  const [coverDraft, setCoverDraft] = useState('');
  const [notes, setNotes] = useState('');
  const [outcome, setOutcome] = useState('applied');
  const [outcomeNote, setOutcomeNote] = useState('');

  useEffect(() => {
    if (!detail) return;
    setAnswersDraft(detail.application.answers || []);
    setCoverDraft(detail.application.coverLetter || '');
    setNotes(detail.application.notes || '');
  }, [detail]);

  if (!detail) return null;
  const { application, job, match, events, documents } = detail;

  const submit = async () => {
    onBusy(true);
    try {
      const result = await api.submitApplication(application.id);
      push(
        result.status === 'submitted'
          ? 'Submitted — the platform confirmed receipt.'
          : result.status === 'requires_human'
            ? `Prepared, but needs you: ${result.detail}`
            : `Did not submit: ${result.detail || result.status}`,
        result.status === 'submitted' ? 'success' : 'warn'
      );
      await onChanged();
    } catch (err) {
      push(err.message, 'error');
    } finally {
      onBusy(false);
    }
  };

  const save = async () => {
    onBusy(true);
    try {
      await api.patchApplication(application.id, { answers: answersDraft, coverLetter: coverDraft, notes });
      push('Saved.', 'success');
      await onChanged();
    } catch (err) {
      push(err.message, 'error');
    } finally {
      onBusy(false);
    }
  };

  const download = async (kind) => {
    setBusy(true);
    try {
      const file = await downloadDocument(application.id, kind);
      push(`Downloaded ${file.filename}.`, 'success');
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const recordOutcome = async () => {
    onBusy(true);
    try {
      await api.applicationOutcome(application.id, outcome, outcomeNote || undefined);
      push('Status recorded.', 'success');
      await onChanged();
    } catch (err) {
      push(err.message, 'error');
    } finally {
      onBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} wide title={`${job.title}${job.company ? ` — ${job.company}` : ''}`}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[application.status]}>{STATUS_LABEL[application.status]}</Badge>
          <Badge tone="brand">Match {application.matchScore}%</Badge>
          <Badge>Mode: {application.mode}</Badge>
          {job.isDemo ? <Badge tone="warn">Demo listing</Badge> : null}
          {application.submittedAt ? <span className="text-xs text-ink-500">Submitted {formatDateTime(application.submittedAt)}</span> : null}
        </div>

        {application.humanAction ? (
          <div className={`rounded-lg px-3 py-2 text-sm ${application.humanAction.type === 'captcha' || application.humanAction.type === 'blocked' ? 'bg-danger-500/10 text-danger-600' : 'bg-warn-500/10 text-warn-600'}`}>
            <strong>Needs you:</strong> {application.humanAction.detail}
            {application.humanAction.questions?.length ? <ul className="mt-1 list-disc pl-5 text-xs">{application.humanAction.questions.map((q) => <li key={q}>{q}</li>)}</ul> : null}
          </div>
        ) : null}

        {application.confirmation?.source ? (
          <p className="rounded-lg bg-accent-500/10 px-3 py-2 text-xs text-accent-600">
            Confirmation recorded from <strong>{application.confirmation.source}</strong>
            {application.confirmation.messageId ? ` (message ${application.confirmation.messageId})` : ''}
            {application.confirmation.httpStatus ? ` (HTTP ${application.confirmation.httpStatus})` : ''}
            {application.confirmation.source === 'user_asserted' ? ' — you marked this as submitted.' : ''}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <button
            className={`btn-ghost ${documents.tailoredCv ? '' : 'pointer-events-none opacity-50'}`}
            onClick={() => download('cv')}
            disabled={!documents.tailoredCv || busy}
          >
            ⬇ Tailored CV {documents.tailoredCv ? '' : '(not rendered)'}
          </button>
          <button
            className={`btn-ghost ${documents.coverLetter ? '' : 'pointer-events-none opacity-50'}`}
            onClick={() => download('cover')}
            disabled={!documents.coverLetter || busy}
          >
            ⬇ Cover letter {documents.coverLetter ? '' : '(not rendered)'}
          </button>
          {job.url ? (
            <a className="btn-primary" href={job.url} target="_blank" rel="noreferrer noopener">
              Open application form ↗
            </a>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="btn-success" onClick={submit} disabled={busy}>
            {busy ? 'Working…' : 'Submit now (where permitted)'}
          </button>
          <button className="btn-ghost" onClick={save} disabled={busy}>
            Save edits
          </button>
        </div>

        <div className="space-y-3">
          <SectionTitle title="Answers" subtitle="Anything the CV could not answer is left blank for you — never guessed." />
          {answersDraft.length ? (
            answersDraft.map((a, i) => (
              <div key={`${a.question}-${i}`} className="rounded-lg border border-ink-200 p-3">
                <p className="text-sm font-medium text-ink-800">{a.question}</p>
                <textarea
                  className="input mt-2 h-20 text-sm"
                  value={a.answer || ''}
                  placeholder={a.needsUser ? 'Needs your input…' : ''}
                  onChange={(e) => {
                    const next = [...answersDraft];
                    next[i] = { ...a, answer: e.target.value, needsUser: e.target.value ? false : a.needsUser };
                    setAnswersDraft(next);
                  }}
                />
                <p className="mt-1 text-xs text-ink-400">
                  Source: {a.source || 'unknown'}
                  {a.note ? ` · ${a.note}` : ''}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-ink-500">No questions were detected on this advert.</p>
          )}
        </div>

        <Field label="Cover letter" hint="Generated from your CV only. Edit freely — it is your application.">
          <textarea className="input h-64 text-sm leading-relaxed" value={coverDraft} onChange={(e) => setCoverDraft(e.target.value)} />
        </Field>

        <Field label="Notes" hint="Private to you.">
          <textarea className="input h-20 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Recruiter name, follow-up date…" />
        </Field>

        <div className="rounded-lg border border-ink-200 p-3">
          <p className="label">Record what happened</p>
          <div className="flex flex-wrap gap-2">
            <select className="input max-w-[12rem]" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="applied">I submitted this myself</option>
              <option value="interview">Interview invitation</option>
              <option value="rejected">Rejected</option>
              <option value="withdrawn">Withdrew</option>
              <option value="blocked">Blocked by the platform</option>
            </select>
            <input className="input flex-1" placeholder="Optional note" value={outcomeNote} onChange={(e) => setOutcomeNote(e.target.value)} />
            <button className="btn-ghost" onClick={recordOutcome} disabled={busy}>
              Record
            </button>
          </div>
        </div>

        {match ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-accent-500/30 bg-accent-500/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent-600">Strong matches used</p>
              <p className="mt-1 text-sm">{(match.strongMatches || []).join(', ') || '—'}</p>
            </div>
            <div className="rounded-lg border border-warn-500/30 bg-warn-500/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-warn-600">Gaps acknowledged</p>
              <p className="mt-1 text-sm">{(match.gaps || []).join(', ') || '—'}</p>
            </div>
          </div>
        ) : null}

        {events?.length ? (
          <div>
            <p className="label">Timeline</p>
            <ol className="space-y-1 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="w-40 shrink-0 text-xs text-ink-400">{formatDateTime(e.at)}</span>
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
