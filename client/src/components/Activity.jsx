import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Badge, Card, Chip, EmptyState, SectionTitle, Spinner, Tabs, formatDateTime, timeAgo, useToast } from './ui.jsx';

const LEVEL_TONE = { error: 'bad', warn: 'warn', info: 'default' };
const TYPE_TONE = {
  human_action_required: 'warn',
  captcha_encountered: 'bad',
  login_expired: 'warn',
  platform_blocked: 'bad',
  application_submitted: 'good',
  interview_detected: 'good',
  high_match_job: 'brand',
  run_finished: 'default',
  campaign_started: 'good',
  campaign_stopped: 'warn',
  system: 'default',
  policy_skipped: 'default',
};

export default function Activity({ dashboard, onOpenJob, onOpenApplication }) {
  const [tab, setTab] = useState('notifications');
  const [notifications, setNotifications] = useState([]);
  const [activity, setActivity] = useState(dashboard?.activity || []);
  const [loading, setLoading] = useState(false);
  const { push } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const [n, a] = await Promise.all([api.notifications(), api.activity(200)]);
      setNotifications(n.notifications || []);
      setActivity(a.activity || []);
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unread = notifications.filter((n) => !n.read_at).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Alerts & activity</h1>
          <p className="mt-1 text-sm text-ink-500">Everything the agent did, and everything it needs from you.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={load}>
            Refresh
          </button>
          <button
            className="btn-ghost"
            disabled={!unread}
            onClick={async () => {
              await api.markNotificationsRead([]);
              push('All marked read.', 'success');
              load();
            }}
          >
            Mark all read {unread ? `(${unread})` : ''}
          </button>
        </div>
      </div>

      <Tabs tabs={[{ key: 'notifications', label: 'Notifications', count: unread || undefined }, { key: 'log', label: 'Activity log' }]} value={tab} onChange={setTab} />

      {loading ? <Spinner /> : null}

      {tab === 'notifications' ? (
        notifications.length ? (
          <div className="space-y-2">
            {notifications.map((n) => (
              <Card key={n.id} className={`card-pad ${n.read_at ? '' : 'border-l-4 border-l-brand-500'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={TYPE_TONE[n.type] || 'default'}>{n.type.replace(/_/g, ' ')}</Badge>
                      <span className="text-xs text-ink-400">{formatDateTime(n.created_at)}</span>
                    </div>
                    <p className="mt-1.5 font-medium text-ink-900">{n.title}</p>
                    {n.body ? <p className="mt-0.5 text-sm text-ink-600">{n.body}</p> : null}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {n.job_id ? (
                      <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => onOpenJob(n.job_id)}>
                        Open job
                      </button>
                    ) : null}
                    {n.application_id ? (
                      <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => onOpenApplication(n.application_id)}>
                        Open application
                      </button>
                    ) : null}
                    {!n.read_at ? (
                      <button
                        className="btn-ghost px-2.5 py-1 text-xs"
                        onClick={async () => {
                          await api.markNotificationsRead([n.id]);
                          load();
                        }}
                      >
                        Mark read
                      </button>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState title="No notifications yet" body="Strong matches, submissions and anything needing a human shows up here." />
        )
      ) : (
        <Card className="card-pad">
          <SectionTitle title="Activity log" subtitle="Diagnostics for every connector, policy decision and application step." />
          {activity.length ? (
            <ol className="space-y-2">
              {activity.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 border-b border-ink-100 pb-2 text-sm last:border-0">
                  <Chip tone={LEVEL_TONE[entry.level] || 'default'}>{entry.scope}</Chip>
                  <div className="min-w-0 flex-1">
                    <p className="text-ink-800">{entry.message}</p>
                    <p className="text-xs text-ink-400">{timeAgo(entry.created_at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-ink-500">Nothing logged yet.</p>
          )}
        </Card>
      )}
    </div>
  );
}
