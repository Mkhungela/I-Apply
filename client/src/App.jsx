/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, checkClientVersion } from './lib/api';
import { Spinner, ToastProvider, useToast } from './components/ui.jsx';
import Auth from './components/Auth.jsx';
import Onboarding from './components/Onboarding.jsx';
import Dashboard from './components/Dashboard.jsx';
import Jobs from './components/Jobs.jsx';
import Applications from './components/Applications.jsx';
import Connectors from './components/Connectors.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import Activity from './components/Activity.jsx';

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: '◧' },
  { key: 'jobs', label: 'Jobs', icon: '⌕' },
  { key: 'applications', label: 'Applications', icon: '✉' },
  { key: 'sources', label: 'Job sources', icon: '⛓' },
  { key: 'activity', label: 'Alerts', icon: '◉' },
  { key: 'settings', label: 'Settings', icon: '⚙' },
];

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const [user, setUser] = useState(undefined);
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState('dashboard');
  const [dashboard, setDashboard] = useState(null);
  const [settings, setSettings] = useState(null);
  const [roleCatalogue, setRoleCatalogue] = useState([]);
  const [profile, setProfile] = useState(null);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [selectedApplicationId, setSelectedApplicationId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { push } = useToast();

  const loadCore = useCallback(async () => {
    try {
      const [d, s, p] = await Promise.all([api.dashboard(), api.settings(), api.profile()]);
      setDashboard(d);
      setSettings(s.settings);
      setRoleCatalogue(s.roles || []);
      setProfile(p.profile);
    } catch (err) {
      push(err.message, 'error');
    }
  }, [push]);

  useEffect(() => {
    (async () => {
      // If the browser is running a cached bundle from before a deploy, refresh it
      // before doing anything else — otherwise the app talks to a newer API than it
      // was written for.
      if (await checkClientVersion()) return;
      try {
        const me = await api.me();
        setUser(me.user);
        if (me.user) {
          const s = await api.settings();
          setSettings(s.settings);
          setRoleCatalogue(s.roles || []);
          const p = await api.profile();
          setProfile(p.profile);
          const d = await api.dashboard();
          setDashboard(d);
        }
      } catch {
        setUser(null);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  // If any request comes back 401 (expired session, revoked token, or a database that
  // was reset underneath us), drop straight back to the sign-in screen and say why.
  const userRef = useRef(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    // Several requests can fail with 401 at the same moment (the dashboard loads three
    // in parallel). The user only needs to be told once.
    let lastNotifiedAt = 0;
    const onUnauthorized = (event) => {
      const wasSignedIn = Boolean(userRef.current);
      setUser(null);
      setDashboard(null);
      const now = Date.now();
      if (wasSignedIn && now - lastNotifiedAt > 4000) {
        lastNotifiedAt = now;
        push(event?.detail || 'Your session ended — please sign in again.', 'warn');
      }
    };
    window.addEventListener('ajh:unauthorized', onUnauthorized);
    return () => window.removeEventListener('ajh:unauthorized', onUnauthorized);
  }, [push]);

  // Poll while a hunt is running so progress and counters stay live.
  useEffect(() => {
    if (!user) return undefined;
    const id = setInterval(async () => {
      try {
        const d = await api.dashboard();
        setDashboard(d);
      } catch {
        /* ignore transient errors */
      }
    }, 12000);
    return () => clearInterval(id);
  }, [user]);

  const openJob = async (jobId) => {
    setSelectedJobId(jobId);
    setView('jobs');
  };
  const openApplication = async (applicationId) => {
    setSelectedApplicationId(applicationId);
    setView('applications');
  };

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Starting AI Job Hunter…" />
      </div>
    );
  }

  if (!user) {
    return (
      <Auth
        onAuthed={async (signedInUser) => {
          // Prefer the user the server just returned; fall back to asking /me (which
          // reads either the cookie or the bearer token).
          let account = signedInUser || null;
          if (!account) {
            try {
              account = (await api.me()).user;
            } catch {
              account = null;
            }
          }
          if (!account) {
            push('Signed in, but the session could not be established. Please allow cookies for this site, or try again.', 'error');
            return;
          }
          setBooting(true);
          setUser(account);
          await loadCore();
          setBooting(false);
        }}
      />
    );
  }

  const needsOnboarding = !profile || !(settings?.roles || []).length;

  return (
    <div className="min-h-screen lg:flex">
      {/* Sidebar */}
      <aside className={`${menuOpen ? 'block' : 'hidden'} shrink-0 bg-ink-900 text-ink-100 lg:block lg:w-64`}>
        <div className="flex h-full flex-col p-4">
          <div className="flex items-center gap-2 px-2 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-brand-300">
            <span aria-hidden>◎</span> AI Job Hunter
          </div>
          <nav className="mt-4 space-y-1">
            {NAV.map((item) => (
              <button
                key={item.key}
                onClick={() => {
                  setView(item.key);
                  setMenuOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                  view === item.key ? 'bg-white/10 text-white' : 'text-ink-200 hover:bg-white/5'
                }`}
              >
                <span aria-hidden className="w-4 text-center">
                  {item.icon}
                </span>
                {item.label}
                {item.key === 'activity' && dashboard?.unreadNotifications ? (
                  <span className="ml-auto rounded-full bg-warn-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{dashboard.unreadNotifications}</span>
                ) : null}
              </button>
            ))}
          </nav>
          <div className="mt-auto space-y-2 pt-6 text-xs text-ink-300">
            <p className="px-2">
              {dashboard?.scheduler?.running ? <span className="text-accent-500">● Scheduler live</span> : <span className="text-warn-500">● Scheduler off</span>}
            </p>
            <p className="px-2">
              {dashboard?.campaign ? `${dashboard.campaign.status} · ${dashboard.campaign.totalRuns || 0} run(s)` : 'No active campaign'}
            </p>
            <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/5" onClick={async () => { await api.logout(); window.location.reload(); }}>
              Sign out · {user.email}
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between gap-3 border-b border-ink-200 bg-white px-4 py-3 lg:hidden">
          <button className="btn-ghost px-2 py-1" onClick={() => setMenuOpen((v) => !v)} aria-label="Toggle navigation">
            ☰
          </button>
          <span className="text-sm font-semibold">AI Job Hunter</span>
          {dashboard?.unreadNotifications ? <span className="chip-warn">{dashboard.unreadNotifications}</span> : <span />}
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {needsOnboarding ? (
            <Onboarding
              profile={profile}
              settings={settings}
              roleCatalogue={roleCatalogue}
              onProfile={(p) => setProfile(p)}
              onSettings={(s) => setSettings(s)}
              onDone={async () => {
                await loadCore();
                setView('dashboard');
              }}
            />
          ) : view === 'dashboard' ? (
            <Dashboard
              dashboard={dashboard}
              settings={settings}
              profile={profile}
              onRefresh={loadCore}
              onOpenJob={openJob}
              onOpenApplication={openApplication}
              goTo={setView}
            />
          ) : view === 'jobs' ? (
            <Jobs onOpenApplication={openApplication} selectedJobId={selectedJobId} clearSelectedJob={() => setSelectedJobId(null)} />
          ) : view === 'applications' ? (
            <Applications selectedId={selectedApplicationId} clearSelected={() => setSelectedApplicationId(null)} />
          ) : view === 'sources' ? (
            <Connectors />
          ) : view === 'activity' ? (
            <Activity dashboard={dashboard} onOpenJob={openJob} onOpenApplication={openApplication} />
          ) : (
            <SettingsPanel
              settings={settings}
              roleCatalogue={roleCatalogue}
              profile={profile}
              onSaved={(s) => setSettings(s)}
              onProfileChanged={(p) => setProfile(p)}
            />
          )}
        </main>

        <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-ink-400 sm:px-6 lg:px-8">
          AI Job Hunter · self-hosted autonomous job search. Respects each platform’s automation rules: LinkedIn, Indeed, PNet, Careers24,
          Glassdoor, Wellfound and Workday are assisted-only by design. Submissions are only recorded when the target platform confirmed them.
        </footer>
      </div>
    </div>
  );
}
