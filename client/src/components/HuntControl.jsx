import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Badge, Card, Chip, ConfirmButton, Field, ProgressBar, SectionTitle, Toggle, formatDateTime, timeAgo, useToast } from './ui.jsx';

/**
 * The START / PAUSE / RESUME / STOP control plus live run progress.
 */
export default function HuntControl({ dashboard, settings, profile, onRefresh }) {
  const { push } = useToast();
  const [busy, setBusy] = useState(null);
  const [draft, setDraft] = useState({
    durationDays: settings.durationDays ?? 7,
    runsPerDay: settings.runsPerDay ?? 3,
    cadence: settings.cadence ?? 'daily',
    taskLimit: 12,
    searchMode: 'live',
  });

  useEffect(() => {
    setDraft((d) => ({ ...d, durationDays: settings.durationDays ?? 7, runsPerDay: settings.runsPerDay ?? 3, cadence: settings.cadence ?? 'daily' }));
  }, [settings.durationDays, settings.runsPerDay, settings.cadence]);

  const campaign = dashboard?.campaign || null;
  const progress = dashboard?.scheduler?.progress?.[campaign?.id];
  const status = campaign?.status || 'idle';
  const liveSources = dashboard?.liveSources ?? null;

  const start = async () => {
    setBusy('start');
    try {
      await api.startCampaign({ ...draft, startImmediately: true });
      push('Job hunt started. The agent is searching now.', 'success');
      onRefresh();
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const action = async (name) => {
    if (!campaign) return;
    setBusy(name);
    try {
      const map = {
        pause: () => api.campaignAction(campaign.id, 'pause'),
        resume: () => api.campaignAction(campaign.id, 'resume'),
        stop: () => api.campaignAction(campaign.id, 'stop'),
        run: () => api.campaignAction(campaign.id, 'run'),
      };
      await map[name]();
      push(
        name === 'pause' ? 'Paused — no new work will start.' : name === 'resume' ? 'Resumed.' : name === 'stop' ? 'Stopped.' : 'Run triggered.',
        name === 'stop' ? 'warn' : 'success'
      );
      onRefresh();
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const runOnce = async () => {
    setBusy('once');
    try {
      const result = await api.runOnce({ searchMode: draft.searchMode, taskLimit: draft.taskLimit });
      push(
        `Run complete: ${result?.stats?.jobsFound ?? 0} found, ${result?.stats?.jobsNew ?? 0} new, ${result?.stats?.jobsMatched ?? 0} matched, ${result?.stats?.applicationsSubmitted ?? 0} submitted.`,
        'success'
      );
      onRefresh();
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 bg-ink-900 px-4 py-3 text-white sm:px-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-300">Job hunt agent</p>
          <p className="mt-0.5 text-sm text-ink-200">
            {status === 'running'
              ? `Running — next slot ${formatDateTime(campaign?.next_run_at)}`
              : status === 'paused'
                ? 'Paused'
                : status === 'completed'
                  ? 'Schedule completed'
                  : status === 'stopped'
                    ? 'Stopped'
                    : 'Not started'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${status === 'running' ? 'bg-accent-500/20 text-accent-500' : status === 'paused' ? 'bg-warn-500/20 text-warn-500' : 'bg-white/10 text-ink-100'}`}>
            <span className={`h-2 w-2 rounded-full ${status === 'running' ? 'animate-pulse bg-accent-500' : 'bg-current'}`} />
            {status.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="card-pad space-y-4">
        {campaign ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="dark">{campaign.name}</Badge>
              <Chip>{campaign.config?.cadence === 'once' ? 'Run once' : `${campaign.config?.runsPerDay || 1}× per day`}</Chip>
              <Chip>{campaign.total_runs || 0} run(s)</Chip>
              {campaign.ends_at ? <Chip>Ends {formatDateTime(campaign.ends_at)}</Chip> : null}
              {campaign.last_run_at ? <Chip>Last run {timeAgo(campaign.last_run_at)}</Chip> : null}
            </div>

            {progress ? (
              <div className="rounded-lg border border-brand-500/30 bg-brand-50/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-brand-800">
                  <span className="capitalize">{progress.step}</span>
                  <span>{progress.total ? `${progress.current}/${progress.total}` : ''}</span>
                </div>
                <p className="mt-1 text-sm text-brand-900">{progress.message}</p>
                {progress.total ? (
                  <div className="mt-2">
                    <ProgressBar value={progress.current} max={progress.total} />
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-4">
              <button className="btn-ghost" disabled={status !== 'running' || busy} onClick={() => action('pause')}>
                ⏸ Pause
              </button>
              <button className="btn-ghost" disabled={status !== 'paused' || busy} onClick={() => action('resume')}>
                ▶ Resume
              </button>
              <button className="btn-ghost" disabled={busy || status === 'stopped'} onClick={() => action('run')}>
                ⟳ Run now
              </button>
              <ConfirmButton className="btn-danger" onConfirm={() => action('stop')} confirmLabel="Tap again to stop" question="Stop the scheduled hunt">
                ⏹ Stop
              </ConfirmButton>
            </div>
            {campaign.last_error ? <p className="rounded bg-warn-500/10 px-3 py-2 text-xs text-warn-600">Last note: {campaign.last_error}</p> : null}
          </div>
        ) : (
          <div className="space-y-4">
            <SectionTitle
              title="Configure and start"
              subtitle={profile ? 'The agent will search, match, prioritise, tailor and apply on your schedule.' : 'Upload your CV first.'}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Duration">
                <select className="input" value={draft.durationDays} onChange={(e) => setDraft({ ...draft, durationDays: Number(e.target.value) })}>
                  <option value={1}>1 day</option>
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                </select>
              </Field>
              <Field label="How often">
                <select className="input" value={draft.runsPerDay} onChange={(e) => setDraft({ ...draft, runsPerDay: Number(e.target.value), cadence: 'daily' })}>
                  <option value={1}>Once a day</option>
                  <option value={2}>Twice a day</option>
                  <option value={3}>Three times a day</option>
                  <option value={6}>Every 4 hours</option>
                  <option value={12}>Every 2 hours</option>
                  <option value={24}>Hourly</option>
                </select>
              </Field>
              <Field label="Jobs processed per run" hint="How many prepared applications each run works through.">
                <input type="number" min="1" max="60" className="input" value={draft.taskLimit} onChange={(e) => setDraft({ ...draft, taskLimit: Number(e.target.value) })} />
              </Field>
              <Field label="Job sources for this hunt" hint={liveSources === 0 ? 'No live source is configured yet — demo mode uses the labelled sample dataset.' : undefined}>
                <select className="input" value={draft.searchMode} onChange={(e) => setDraft({ ...draft, searchMode: e.target.value })}>
                  <option value="live">Live sources (your configured connectors)</option>
                  <option value="demo">Demo dataset (sample jobs, never submitted)</option>
                </select>
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-success px-5 py-2.5 text-base" onClick={start} disabled={!profile || busy}>
                {busy === 'start' ? 'Starting…' : '🚀 START JOB HUNT'}
              </button>
              <button className="btn-ghost" onClick={runOnce} disabled={!profile || busy}>
                {busy === 'once' ? 'Running…' : 'Run once now'}
              </button>
            </div>
            <p className="text-xs text-ink-500">
              The schedule is stored server-side, so runs continue even when this browser is closed — deploy the server (or the standalone worker)
              on an always-on host.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
