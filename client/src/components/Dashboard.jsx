/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
import React from 'react';
import { Card, Chip, EmptyState, ScoreRing, SectionTitle, Stat, formatDate, money, timeAgo } from './ui.jsx';
import HuntControl from './HuntControl.jsx';

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

export default function Dashboard({ dashboard, settings, profile, onRefresh, onOpenJob, onOpenApplication, goTo }) {
  const stats = dashboard?.stats || {};
  const pipeline = dashboard?.pipeline || [];
  const topMatches = dashboard?.topMatches || [];
  const recent = dashboard?.recentApplications || [];
  const activity = dashboard?.activity || [];
  const lastRun = dashboard?.lastRun;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="mt-1 text-sm text-ink-500">
            {profile ? `Hunting for ${(settings.roles || []).slice(0, 3).join(', ') || 'your target roles'} · minimum match ${settings.minMatchScore}% · auto-apply at ${settings.autoApplyThreshold}%${settings.autoApplyEnabled ? '' : ' (automatic mode off)'}` : 'Add your CV to begin.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip tone={dashboard?.unreadNotifications ? 'warn' : 'default'}>{dashboard?.unreadNotifications || 0} unread alerts</Chip>
          {dashboard?.scheduler?.running ? <Chip tone="good">Scheduler live</Chip> : <Chip tone="danger">Scheduler off</Chip>}
        </div>
      </div>

      <HuntControl dashboard={dashboard} settings={settings} profile={profile} onRefresh={onRefresh} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Jobs found today" value={stats.jobsFoundToday ?? 0} hint={`${stats.jobsFoundTotal ?? 0} total discovered`} />
        <Stat label="Matched your profile" value={stats.jobsMatched ?? 0} hint={`${stats.highMatches ?? 0} are strong matches`} tone="brand" />
        <Stat label="Applications submitted" value={stats.applied ?? 0} hint="Only counted when the platform accepted it" tone="good" />
        <Stat label="Awaiting action" value={stats.pending ?? 0} hint="Prepared, needs you" tone={stats.pending ? 'warn' : 'default'} />
        <Stat label="Interviews" value={stats.interviews ?? 0} tone={stats.interviews ? 'good' : 'default'} />
        <Stat label="Response rate" value={stats.responseRate === null || stats.responseRate === undefined ? '—' : `${stats.responseRate}%`} hint="Interviews ÷ applications" />
        <Stat label="Average match" value={stats.averageMatchScore ? `${stats.averageMatchScore}%` : '—'} />
        <Stat label="Skipped" value={stats.skipped ?? 0} hint="Below threshold or high risk" />
      </div>

      <Card className="card-pad">
        <SectionTitle title="Pipeline" subtitle="Where every job the agent has seen ended up." />
        <div className="flex flex-wrap gap-2">
          {pipeline.map((stage) => (
            <div key={stage.key} className="min-w-[8.5rem] flex-1 rounded-lg border border-ink-200 bg-ink-50/60 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{stage.label}</p>
              <p className="text-xl font-bold tabular-nums">{stage.value}</p>
            </div>
          ))}
        </div>
        {lastRun ? (
          <p className="mt-3 text-xs text-ink-500">
            Last run {timeAgo(lastRun.startedAt)} · {lastRun.jobsFound} found · {lastRun.jobsNew} new · {lastRun.jobsMatched} matched ·{' '}
            {lastRun.applicationsSubmitted} submitted · {lastRun.humanActions} awaiting you
            {lastRun.errors?.length ? ` · ${lastRun.errors.length} issue(s)` : ''}
          </p>
        ) : null}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="card-pad">
          <SectionTitle
            title="Top matches to action"
            subtitle="Highest priority prepared matches."
            right={
              <button className="btn-ghost" onClick={() => goTo('jobs')}>
                All jobs
              </button>
            }
          />
          {topMatches.length ? (
            <ul className="divide-y divide-ink-100">
              {topMatches.slice(0, 6).map((m) => (
                <li key={m.jobId} className="flex items-start gap-3 py-3">
                  <ScoreRing score={m.score} size={52} />
                  <div className="min-w-0 flex-1">
                    <button className="truncate text-left text-sm font-semibold text-ink-900 hover:text-brand-700" onClick={() => onOpenJob(m.jobId)}>
                      {m.title}
                    </button>
                    <p className="truncate text-xs text-ink-500">
                      {m.company} · {m.location || 'Location not stated'} {m.salary ? `· ${money(m.salary)}` : ''} · {timeAgo(m.postedAt)}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {m.isDemo ? <Chip tone="warn">Demo</Chip> : null}
                      <Chip tone={m.decision === 'auto_apply' ? 'good' : 'brand'}>{m.decision === 'auto_apply' ? 'Auto-apply' : 'Review'}</Chip>
                      {(m.strongMatches || []).slice(0, 3).map((s) => (
                        <Chip key={s} tone="good">
                          {s}
                        </Chip>
                      ))}
                      {(m.gaps || []).slice(0, 2).map((g) => (
                        <Chip key={g} tone="warn">
                          gap: {g}
                        </Chip>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No scored matches yet" body="Run the agent once, or paste a job link to see the matching engine at work." />
          )}
        </Card>

        <Card className="card-pad">
          <SectionTitle
            title="Recent applications"
            subtitle="Every row links to its prepared documents and answers."
            right={
              <button className="btn-ghost" onClick={() => goTo('applications')}>
                Open tracker
              </button>
            }
          />
          {recent.length ? (
            <div className="overflow-x-auto scroll-thin">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Job</th>
                    <th>Match</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.slice(0, 8).map((a) => (
                    <tr key={a.id} className="cursor-pointer hover:bg-ink-50" onClick={() => onOpenApplication(a.id)}>
                      <td className="max-w-[10rem] truncate">{a.company || '—'}</td>
                      <td className="max-w-[12rem] truncate">
                        {a.isDemo ? '🧪 ' : ''}
                        {a.title}
                      </td>
                      <td className="tabular-nums">{a.matchScore ?? '—'}%</td>
                      <td>
                        <Chip tone={STATUS_TONE[a.status] || 'default'}>{STATUS_LABEL[a.status] || a.status}</Chip>
                      </td>
                      <td className="whitespace-nowrap text-xs text-ink-500">{formatDate(a.submittedAt || a.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No applications yet" body="Start a hunt and the tracker fills itself in — with the truthful status of each attempt." />
          )}
        </Card>
      </div>

      <Card className="card-pad">
        <SectionTitle title="Live activity" subtitle="What the agent is doing, in its own words." />
        {activity.length ? (
          <ol className="space-y-2">
            {activity.slice(0, 12).map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 text-sm">
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    entry.level === 'error' ? 'bg-danger-500' : entry.level === 'warn' ? 'bg-warn-500' : 'bg-accent-500'
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-ink-800">{entry.message}</p>
                  <p className="text-xs text-ink-400">
                    {entry.scope} · {timeAgo(entry.created_at)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-ink-500">Nothing logged yet.</p>
        )}
      </Card>
    </div>
  );
}
