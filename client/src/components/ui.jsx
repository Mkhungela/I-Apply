import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */

const ToastContext = createContext({ push: () => {} });

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 9000 : 5000);
  }, []);
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,26rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-lift ${
              t.tone === 'error'
                ? 'border-danger-500/40 bg-white text-danger-600'
                : t.tone === 'success'
                  ? 'border-accent-500/40 bg-white text-accent-600'
                  : t.tone === 'warn'
                    ? 'border-warn-500/40 bg-white text-warn-600'
                    : 'border-ink-200 bg-white text-ink-800'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* ------------------------------------------------------------------ *
 * Basics
 * ------------------------------------------------------------------ */

export function Card({ className = '', children, ...rest }) {
  return (
    <div className={`card ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ title, subtitle, right }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, hint, tone = 'default' }) {
  const tones = {
    default: 'text-ink-900',
    good: 'text-accent-600',
    warn: 'text-warn-600',
    bad: 'text-danger-600',
    brand: 'text-brand-700',
  };
  return (
    <Card className="card-pad">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${tones[tone] || tones.default}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-500">{hint}</p> : null}
    </Card>
  );
}

export function Chip({ children, tone = 'default', title }) {
  const cls =
    tone === 'good' ? 'chip-good' : tone === 'warn' ? 'chip-warn' : tone === 'danger' ? 'chip-danger' : tone === 'brand' ? 'chip-brand' : 'chip';
  return (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}

export function Badge({ children, tone = 'default' }) {
  const tones = {
    default: 'bg-ink-100 text-ink-700 border-ink-200',
    good: 'bg-accent-500/10 text-accent-600 border-accent-500/30',
    warn: 'bg-warn-500/10 text-warn-600 border-warn-500/30',
    bad: 'bg-danger-500/10 text-danger-600 border-danger-500/30',
    brand: 'bg-brand-500/10 text-brand-700 border-brand-500/30',
    dark: 'bg-ink-900 text-white border-ink-900',
  };
  return <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${tones[tone] || tones.default}`}>{children}</span>;
}

export function Spinner({ label }) {
  return (
    <div className="flex items-center gap-2 text-sm text-ink-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-300 border-t-brand-600" aria-hidden />
      {label || 'Loading…'}
    </div>
  );
}

export function EmptyState({ title, body, action }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-300 bg-white/60 p-8 text-center">
      <h3 className="text-base font-semibold text-ink-800">{title}</h3>
      {body ? <p className="mx-auto mt-1 max-w-xl text-sm text-ink-500">{body}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink-900/40 p-3 sm:p-6" onMouseDown={onClose}>
      <div
        className={`my-4 w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'} rounded-xl border border-ink-200 bg-white shadow-lift`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between gap-4 border-b border-ink-100 px-4 py-3 sm:px-5">
          <h3 className="text-base font-semibold">{title}</h3>
          <button className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-4 py-4 scroll-thin sm:px-5">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmButton({ onConfirm, children, className = 'btn-danger', confirmLabel = 'Confirm?', question }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={className}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
      title={question}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}

export function ScoreRing({ score = 0, size = 56, label = true }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, score));
  const stroke = pct >= 80 ? '#12b981' : pct >= 70 ? '#3465f5' : pct >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth="5" className="stroke-ink-200" fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth="5"
          stroke={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
        />
      </svg>
      {label ? (
        <span className="absolute text-xs font-bold tabular-nums text-ink-800">{pct}%</span>
      ) : null}
    </div>
  );
}

export function ProgressBar({ value = 0, max = 100, tone = 'brand' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const tones = { brand: 'bg-brand-600', good: 'bg-accent-500', warn: 'bg-warn-500' };
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
      <div className={`h-full rounded-full ${tones[tone] || tones.brand}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-ink-200 bg-white p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            value === t.key ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-50'
          }`}
        >
          {t.label}
          {t.count !== undefined && t.count !== null ? <span className="ml-1.5 text-xs opacity-70">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-500">{hint}</span> : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-5 w-9 shrink-0 rounded-full border transition ${checked ? 'border-brand-600 bg-brand-600' : 'border-ink-300 bg-ink-200'}`}
      >
        <span className={`block h-4 w-4 rounded-full bg-white transition ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
      <span>
        <span className="block text-sm font-medium text-ink-800">{label}</span>
        {hint ? <span className="block text-xs text-ink-500">{hint}</span> : null}
      </span>
    </div>
  );
}

export function TagInput({ values = [], onChange, placeholder, suggestions = [], max = 20 }) {
  const [draft, setDraft] = useState('');
  const add = (value) => {
    const v = String(value).trim();
    if (!v || values.includes(v) || values.length >= max) return;
    onChange([...values, v]);
    setDraft('');
  };
  const filtered = useMemo(
    () => suggestions.filter((s) => !values.includes(s) && (!draft || s.toLowerCase().includes(draft.toLowerCase()))).slice(0, 6),
    [suggestions, values, draft]
  );
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {values.map((v) => (
          <span key={v} className="chip-brand">
            {v}
            <button type="button" className="ml-1 text-brand-700/70 hover:text-brand-900" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          className="input"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(draft);
            }
          }}
        />
        <button type="button" className="btn-ghost" onClick={() => add(draft)}>
          Add
        </button>
      </div>
      {filtered.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {filtered.map((s) => (
            <button key={s} type="button" className="chip hover:bg-ink-100" onClick={() => add(s)}>
              + {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function KeyValue({ items = [] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {items.filter(Boolean).map(({ label, value }) => (
        <div key={label} className="flex items-baseline justify-between gap-3 border-b border-ink-100 pb-1">
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
          <dd className="text-right text-sm text-ink-800">{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function timeAgo(value) {
  if (!value) return '—';
  const date = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') || String(value).includes('T') ? '' : 'Z'));
  const diff = Date.now() - date.getTime();
  if (Number.isNaN(diff)) return '—';
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function money(salary) {
  if (!salary || (!salary.min && !salary.max)) return null;
  const fmt = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const range = salary.min && salary.max ? `${fmt(salary.min)}–${fmt(salary.max)}` : fmt(salary.min || salary.max);
  return `${salary.currency || ''} ${range}`.trim();
}
