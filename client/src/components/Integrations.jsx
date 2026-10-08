/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 *
 * Integrations: connect a mail account (so applications to adverts that ask for an
 * email can actually be sent) and stack several AI providers that issue free keys.
 *
 * Both are optional — the app runs fully on the deterministic engine and the assisted
 * application flow without them. Nothing here is ever sent anywhere except the provider
 * the user chose, and keys are stored encrypted on their own server.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { Card, Field, SectionTitle, Toggle, useToast } from './ui.jsx';

/* ------------------------------------------------------------------ *
 * Email / SMTP
 * ------------------------------------------------------------------ */

function EmailCard() {
  const [state, setState] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState('');
  const { push } = useToast();

  const load = async () => {
    try {
      const res = await api.emailSettings();
      setState(res);
      setDraft({
        host: res.email.host || '',
        port: res.email.port || 587,
        secure: !!res.email.secure,
        user: res.email.user || '',
        from: res.email.from || '',
        pass: '',
      });
    } catch (err) {
      push(err.message, 'error');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!state || !draft) return null;
  const preset = state.email.presets.find((p) => p.host && p.host === draft.host) || state.email.presets.find((p) => p.id === 'custom');
  const chosen = state.email.presets.find((p) => p.host && p.host === draft.host);
  const isGoogle = chosen && /gmail\.com$/.test(chosen.host);

  const applyPreset = (id) => {
    const next = state.email.presets.find((p) => p.id === id);
    if (!next) return;
    setDraft({ ...draft, host: next.host, port: next.port, secure: next.secure });
  };

  const save = async () => {
    setBusy('save');
    try {
      const res = await api.saveEmailSettings(draft);
      setState(res);
      setDraft((d) => ({ ...d, pass: '' }));
      push(res.capability.available ? `Mail account saved — sending as ${res.capability.from}.` : 'Saved, but the details look incomplete.', res.capability.available ? 'success' : 'error');
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const sendTest = async () => {
    setBusy('test');
    try {
      const res = await api.testEmailSettings(draft.user || undefined);
      if (res.ok) {
        push(`Test email accepted by the mail server for ${res.to}. Check that inbox.`, 'success');
      } else {
        push(res.detail || 'The test email failed.', 'error');
      }
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <Card className="card-pad space-y-4">
      <SectionTitle
        title="Email account"
        subtitle="Connect your own mailbox so applications to adverts that ask for an email can be sent — and so you get notified."
      />

      <div className="rounded-lg border border-ink-200 p-3 text-xs">
        <p className="font-semibold text-ink-700">
          {state.capability.available ? '✓ Connected' : 'Not connected yet'}
        </p>
        <p className="mt-1 text-ink-600">{state.capability.detail}</p>
        {state.capability.available ? (
          <p className="mt-1 text-ink-400">
            Source: {state.capability.source === 'account' ? 'saved in this app' : 'the server’s .env file'}
          </p>
        ) : null}
      </div>

      <Field label="Mail provider" hint="Pick one to fill in the server address, or choose “Other SMTP server”.">
        <select className="input" value={chosen?.id || 'custom'} onChange={(e) => applyPreset(e.target.value)}>
          {state.email.presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      {isGoogle ? (
        <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">Gmail needs an app password, not your normal password</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>
              Turn on 2-Step Verification: <span className="font-mono">myaccount.google.com/security</span>
            </li>
            <li>
              Open <span className="font-mono">myaccount.google.com/apppasswords</span> — it only appears once step 1 is done.
            </li>
            <li>Create one named “AI Job Hunter” and copy the 16-character code.</li>
            <li>Paste it below as the password. Your normal Gmail password will be rejected.</li>
          </ol>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your email address" hint={chosen?.userHint}>
          <input className="input" value={draft.user} onChange={(e) => setDraft({ ...draft, user: e.target.value })} placeholder="you@example.com" />
        </Field>
        <Field label={chosen?.passwordLabel || 'Password'} hint={chosen?.passwordHelp}>
          <input
            className="input"
            type="password"
            value={draft.pass}
            onChange={(e) => setDraft({ ...draft, pass: e.target.value })}
            placeholder={state.email.passwordSet ? 'Stored — leave blank to keep it' : 'Paste the app password'}
          />
        </Field>
        <Field label="Send from" hint={chosen?.fromHint || 'What recipients see. Often the same as your address.'}>
          <input className="input" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} placeholder="Your Name <you@example.com>" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="SMTP server">
            <input className="input" value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} placeholder="smtp.gmail.com" />
          </Field>
          <Field label="Port">
            <input className="input" type="number" value={draft.port} onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) })} />
          </Field>
        </div>
      </div>

      <Toggle
        label="Use a secure connection (TLS)"
        hint="On for port 465. Turn off for port 587, which upgrades with STARTTLS."
        checked={draft.secure}
        onChange={(v) => setDraft({ ...draft, secure: v })}
      />

      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={!!busy} onClick={save}>
          {busy === 'save' ? 'Saving…' : 'Save mail account'}
        </button>
        <button className="btn-ghost" disabled={!!busy || !state.capability.available} onClick={sendTest}>
          {busy === 'test' ? 'Sending…' : 'Send a test email'}
        </button>
        {state.capability.source === 'account' ? (
          <button
            className="btn-ghost text-danger-600"
            disabled={!!busy}
            onClick={async () => {
              setBusy('clear');
              try {
                const res = await api.saveEmailSettings({ clear: true });
                setState(res);
                push('Mail account disconnected.', 'success');
              } finally {
                setBusy('');
              }
            }}
          >
            Disconnect
          </button>
        ) : null}
      </div>

      <p className="text-xs text-ink-400">
        Stored encrypted (AES-256-GCM) on your own server and never sent back to the browser. Used only to send your applications and
        notifications.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * AI providers
 * ------------------------------------------------------------------ */

function AiCard() {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState('');
  const { push } = useToast();

  const load = async () => {
    try {
      const res = await api.aiSettings();
      setData(res);
      const next = {};
      for (const p of res.catalogue) {
        const saved = res.configured.find((c) => c.id === p.id) || {};
        next[p.id] = { apiKey: '', model: saved.model || '', accountId: saved.accountId || '', enabled: saved.enabled !== false && !!saved.keySet };
      }
      setDraft(next);
    } catch (err) {
      push(err.message, 'error');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCount = useMemo(() => (data ? data.active.length : 0), [data]);

  if (!data) return null;

  const save = async () => {
    setBusy('save');
    try {
      const providers = data.catalogue
        .filter((p) => draft[p.id]?.enabled || draft[p.id]?.apiKey)
        .map((p) => ({
          id: p.id,
          apiKey: draft[p.id]?.apiKey || undefined,
          model: draft[p.id]?.model || '',
          accountId: draft[p.id]?.accountId || '',
          enabled: true,
        }));
      const res = await api.saveAiSettings(providers);
      setData(res);
      setDraft((d) => {
        const next = { ...d };
        for (const key of Object.keys(next)) next[key] = { ...next[key], apiKey: '' };
        return next;
      });
      push(
        res.summary.enabled
          ? `Saved. ${res.summary.providers.length} provider(s) active${res.summary.providers.length > 1 ? ' — tried in order, moving on when one hits a rate limit.' : '.'}`
          : 'Saved. No keys yet, so the deterministic engine is in use.',
        'success'
      );
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const res = await api.testAiSettings();
      push(res.message, res.working ? 'success' : 'error');
      if (!res.working) load();
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const free = data.catalogue.filter((p) => p.free);
  const paid = data.catalogue.filter((p) => !p.free);

  const providerRow = (p) => {
    const d = draft[p.id] || { apiKey: '', model: '', enabled: false };
    const saved = data.configured.find((c) => c.id === p.id);
    return (
      <div key={p.id} className={`rounded-lg border p-3 ${d.enabled || d.apiKey ? 'border-brand-300 bg-brand-50/40' : 'border-ink-200'}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink-800">
              {p.name}
              {saved?.keySet ? <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800">key saved</span> : null}
            </p>
            <p className="text-xs text-ink-500">{p.bestFor}</p>
          </div>
          <a className="btn-ghost shrink-0 text-xs" href={p.signup} target="_blank" rel="noreferrer">
            Get a free key ↗
          </a>
        </div>

        <p className="mt-2 rounded bg-ink-50 px-2 py-1 text-[11px] text-ink-600">{p.freeTier}</p>
        {p.catch ? <p className="mt-1 text-[11px] text-amber-700">Watch out: {p.catch}</p> : null}

        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Field label={p.keyLabel}>
            <input
              className="input"
              type="password"
              value={d.apiKey}
              onChange={(e) => setDraft({ ...draft, [p.id]: { ...d, apiKey: e.target.value, enabled: true } })}
              placeholder={saved?.keySet ? `Stored: ${saved.keyMasked} — leave blank to keep` : 'Paste your key'}
            />
          </Field>
          <Field label="Model" hint={`Default: ${p.defaultModel}`}>
            <input
              className="input"
              value={d.model}
              onChange={(e) => setDraft({ ...draft, [p.id]: { ...d, model: e.target.value } })}
              placeholder={p.defaultModel}
            />
          </Field>
          {p.needsAccountId ? (
            <Field label="Account ID" hint="Cloudflare dashboard → Workers & Pages → your account ID.">
              <input
                className="input"
                value={d.accountId}
                onChange={(e) => setDraft({ ...draft, [p.id]: { ...d, accountId: e.target.value } })}
                placeholder="a1b2c3…"
              />
            </Field>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <Card className="card-pad space-y-4">
      <SectionTitle
        title="AI providers (all optional, several free)"
        subtitle="These only improve the wording of letters and explanations. Matching, tailoring and truth-checking work without them."
      />

      <div className="rounded-lg border border-ink-200 p-3 text-xs">
        <p className="font-semibold text-ink-700">
          {activeCount ? `${activeCount} provider(s) active` : 'No provider configured — the built-in engine is writing your letters'}
        </p>
        <p className="mt-1 text-ink-600">
          Free tiers are small on purpose, so add two or three: they are tried in order and the app moves to the next one when one returns
          a rate-limit error. The order you fill them in above is the order they are used.
        </p>
      </div>

      <div className="space-y-3">
        <p className="label">Free — no credit card needed</p>
        {free.map(providerRow)}
      </div>

      <details className="rounded-lg border border-ink-200 p-3">
        <summary className="cursor-pointer text-sm font-medium text-ink-700">Paid or local options</summary>
        <div className="mt-3 space-y-3">{paid.map(providerRow)}</div>
      </details>

      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={!!busy} onClick={save}>
          {busy === 'save' ? 'Saving…' : 'Save providers'}
        </button>
        <button className="btn-ghost" disabled={!!busy || !activeCount} onClick={test}>
          {busy === 'test' ? 'Checking…' : 'Check my keys'}
        </button>
      </div>
      <p className="text-xs text-ink-400">
        Keys are encrypted on your server and never returned to the browser. Nothing generated by a model can add a qualification, employer
        or skill that is not in your CV — every draft is validated against it before it reaches you.
      </p>
    </Card>
  );
}

export default function Integrations() {
  return (
    <div className="space-y-4">
      <EmailCard />
      <AiCard />
    </div>
  );
}
