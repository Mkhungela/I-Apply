import React, { useState } from 'react';
import { api, currentBuild } from '../lib/api';
import { useToast } from './ui.jsx';

export default function Auth({ onAuthed }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      // The server answers with the session (and the user it belongs to), so the shell
      // can go straight to the dashboard instead of asking again.
      const payload = mode === 'login' ? await api.login(email, password) : await api.register(email, password, name);
      onAuthed(payload?.user);
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <div className="relative flex flex-1 flex-col justify-between bg-ink-900 px-6 py-10 text-white lg:px-12 lg:py-14">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-brand-300">
            <span aria-hidden>◎</span> AI Job Hunter
          </div>
          <h1 className="mt-8 max-w-xl text-3xl font-bold leading-tight sm:text-4xl">
            Upload your CV once. The agent searches, matches, tailors and applies — truthfully.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-200">
            Match scoring with an auditable breakdown, cover letters generated only from what your CV actually says, scam screening,
            duplicate protection, per-day application limits, and a scheduler that keeps working while your laptop is closed.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-ink-100">
            {[
              'Works with real, permitted job sources — Greenhouse, Lever, Workable, SmartRecruiters, Remotive, Arbeitnow, Remote OK, RSS and CSV.',
              'LinkedIn, Indeed, PNet, Careers24, Glassdoor and Workday are supported through a compliant paste-a-link flow, never a bot.',
              'Pauses the moment a site asks for a CAPTCHA, MFA or identity check — it never tries to bypass one.',
            ].map((line) => (
              <li key={line} className="flex gap-3">
                <span className="mt-0.5 text-accent-500" aria-hidden>
                  ✓
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-10 text-xs text-ink-400">
          Self-hosted. Your CV, profile and application history live in your own database and can be deleted at any time.
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-semibold">{mode === 'login' ? 'Sign in' : 'Create your account'}</h2>
          <p className="mt-1 text-sm text-ink-500">
            {mode === 'login' ? 'Welcome back — your agent is waiting.' : 'One account per job hunter. Takes ten seconds.'}
          </p>
          <form className="mt-6 space-y-4" onSubmit={submit}>
            {mode === 'register' ? (
              <label className="block">
                <span className="label">Name</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Thandi Molefe" />
              </label>
            ) : null}
            <label className="block">
              <span className="label">Email</span>
              <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />
            </label>
            <label className="block">
              <span className="label">Password</span>
              <input
                className="input"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="At least 8 characters"
              />
            </label>
            <button className="btn-primary w-full" disabled={busy} type="submit">
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
          <div className="mt-4 rounded-lg border border-ink-200 bg-ink-50 p-3">
            <p className="text-xs text-ink-500">
              Just exploring? Open a demo workspace with a sample CV, 24 labelled sample jobs already scored, and the full agent — no sign-up.
            </p>
            <button
              className="btn-ghost mt-2 w-full"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const payload = await api.demoLogin();
                  if (!payload?.token) {
                    push('The server did not issue a session. Check that you are on the app\'s own preview and reload the page.', 'error');
                    return;
                  }
                  onAuthed(payload?.user);
                } catch (err) {
                  push(err.message, 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              🧪 Explore with demo data
            </button>
          </div>
          <button className="mt-4 text-sm font-medium text-brand-700 hover:text-brand-800" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'No account yet? Create one' : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>

      <p className="mt-4 text-center text-[11px] text-ink-400">
        AI Job Hunter · developed by Lulamile Mkhungela · UI build {currentBuild()}
      </p>
    </div>
  );
}
