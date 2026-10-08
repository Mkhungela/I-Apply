import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Badge, Card, Chip, Field, KeyValue, SectionTitle, Spinner, TagInput, Toggle, useToast } from './ui.jsx';

const STEPS = ['Upload CV', 'Review profile', 'Target roles', 'Application policy'];

/**
 * Step 1 — CV upload and understanding. Steps 2-4 — the brief: roles, locations,
 * employment types, thresholds and duration, ending in START JOB HUNT.
 */
export default function Onboarding({ profile, settings, roleCatalogue, onProfile, onSettings, onDone }) {
  const [step, setStep] = useState(profile ? 1 : 0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const { push } = useToast();
  const fileRef = useRef(null);
  const [pasted, setPasted] = useState('');

  const upload = async (file) => {
    setBusy(true);
    try {
      const res = await api.uploadCv(file, file ? undefined : pasted);
      setResult(res);
      onProfile(res.profile);
      push(`CV understood: ${res.profile.skills?.length || 0} skills, ${res.profile.experience?.length || 0} role(s).`, 'success');
      setStep(1);
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveTargets = async () => {
    setBusy(true);
    try {
      const saved = await api.saveSettings({
        roles: settings.roles,
        locations: settings.locations,
        workModes: settings.workModes,
        employmentTypes: settings.employmentTypes,
        minMatchScore: settings.minMatchScore,
        autoApplyThreshold: settings.autoApplyThreshold,
        reviewThreshold: settings.reviewThreshold,
        autoApplyEnabled: settings.autoApplyEnabled,
        requireConfirmation: settings.requireConfirmation,
        maxApplicationsPerDay: settings.maxApplicationsPerDay,
        maxApplicationsPerWeek: settings.maxApplicationsPerWeek,
        durationDays: settings.durationDays,
        cadence: settings.cadence,
        runsPerDay: settings.runsPerDay,
      });
      onSettings(saved.settings);
      push('Preferences saved.', 'success');
      onDone();
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Set up your job hunt</h1>
        <p className="mt-1 text-sm text-ink-500">Four quick steps. Everything can be changed later in Settings.</p>
        <ol className="mt-4 flex flex-wrap gap-2 text-xs">
          {STEPS.map((label, i) => (
            <li key={label} className={`rounded-full border px-3 py-1 font-semibold ${i === step ? 'border-brand-500 bg-brand-50 text-brand-700' : i < step ? 'border-accent-500/40 bg-accent-500/10 text-accent-600' : 'border-ink-200 bg-white text-ink-500'}`}>
              {i + 1}. {label}
            </li>
          ))}
        </ol>
      </div>

      {step === 0 ? (
        <Card className="card-pad space-y-4">
          <SectionTitle title="Upload your CV (PDF)" subtitle="Text-based PDFs work best. Scans and image-only exports cannot be read — paste the text instead." />
          <div
            className="rounded-xl border-2 border-dashed border-ink-300 bg-ink-50/50 p-6 text-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) upload(file);
            }}
          >
            <input ref={fileRef} type="file" accept="application/pdf,.pdf,.txt,.md" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
            <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}>
              Choose CV file
            </button>
            <p className="mt-2 text-xs text-ink-500">or drop the PDF here — max 15 MB</p>
          </div>
          <details className="rounded-lg border border-ink-200 p-3">
            <summary className="cursor-pointer text-sm font-medium">Prefer to paste your CV text?</summary>
            <textarea className="input mt-3 h-40 font-mono text-xs" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste the full text of your CV here…" />
            <button className="btn-ghost mt-2" onClick={() => upload(null)} disabled={busy || pasted.trim().length < 80}>
              Build profile from pasted text
            </button>
          </details>
          <button
            className="text-sm font-medium text-ink-500 underline disabled:opacity-50"
            disabled={busy}
            onClick={async () => {
              // Seeding a workspace must never fail silently: report the outcome, then
              // refresh the shell's data in place (no page reload — it is blocked in
              // some sandboxed frames).
              setBusy(true);
              try {
                const res = await api.seedDemo();
                const count = res?.seeded?.demoJobs ?? 0;
                push(`Demo workspace loaded: ${count} sample jobs, scored against the sample CV.`, 'success');
                await onDone?.();
              } catch (err) {
                push(err.message || 'Could not load the demo workspace.', 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Loading the demo workspace…' : 'Or load the demo workspace to explore first (clearly-labelled sample data)'}
          </button>
        </Card>
      ) : null}

      {step === 1 && profile ? (
        <Card className="card-pad space-y-4">
          <SectionTitle
            title="What we understood"
            subtitle="Check these. Corrections here change every application the agent writes."
            right={<Badge tone={(profile.extraction?.confidence ?? 0) >= 80 ? 'good' : 'warn'}>Confidence {profile.extraction?.confidence ?? '—'}%</Badge>}
          />
          <KeyValue
            items={[
              { label: 'Name', value: profile.fullName },
              { label: 'Headline', value: profile.headline },
              { label: 'Email', value: profile.email },
              { label: 'Phone', value: profile.phone },
              { label: 'Location', value: profile.location },
              { label: 'Experience', value: profile.yearsExperience ? `${profile.yearsExperience} years` : 'not stated' },
              { label: 'Seniority', value: profile.seniority ? `${profile.seniority} — ${profile.extraction?.seniorityBasis || ''}` : '—' },
              { label: 'Notice period', value: profile.noticePeriod },
              { label: 'Salary expectation', value: profile.salaryExpectation },
              { label: 'Work authorisation', value: profile.workAuthorization },
              { label: 'LinkedIn', value: profile.linkedinUrl },
              { label: 'Portfolio', value: profile.portfolioUrl },
            ]}
          />
          <div>
            <p className="label">Skills detected ({profile.skills?.length || 0})</p>
            <div className="flex flex-wrap gap-1.5">
              {(profile.skills || []).slice(0, 26).map((s) => (
                <Chip key={s.id || s.label}>{s.label}</Chip>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="label">Experience</p>
              <ul className="space-y-1.5 text-sm">
                {(profile.experience || []).slice(0, 4).map((e, i) => (
                  <li key={i} className="rounded-lg border border-ink-100 p-2">
                    <span className="font-medium">{e.title || 'Role'}</span>
                    {e.company ? <span className="text-ink-500"> · {e.company}</span> : null}
                    {e.highlights?.length ? <span className="block text-xs text-ink-500">{e.highlights.length} achievement bullet(s) captured</span> : null}
                  </li>
                ))}
                {!profile.experience?.length ? <li className="text-sm text-warn-600">No dated roles found — edit them in Settings → Profile.</li> : null}
              </ul>
            </div>
            <div>
              <p className="label">Education & certifications</p>
              <ul className="space-y-1 text-sm text-ink-700">
                {(profile.education || []).map((e, i) => (
                  <li key={`e${i}`}>🎓 {e.qualification} {e.year ? `(${e.year})` : ''}</li>
                ))}
                {(profile.certifications || []).slice(0, 4).map((c, i) => (
                  <li key={`c${i}`}>📜 {c.name}</li>
                ))}
              </ul>
            </div>
          </div>
          {profile.salaryExpectation || profile.noticePeriod ? (
            <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800">
              These will be used for the “salary expectation” and “notice period” questions. Anything the CV does not answer is left for you
              instead of being guessed.
            </p>
          ) : (
            <p className="rounded-lg bg-warn-500/10 px-3 py-2 text-xs text-warn-600">
              No salary expectation or notice period was found. Add them in Settings → Profile so applications can answer those questions
              automatically — otherwise they pause for your input.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => setStep(2)}>
              Looks right — continue
            </button>
            <button className="btn-ghost" onClick={() => setStep(0)}>
              Upload a different CV
            </button>
            <a className="btn-ghost" href="#settings" onClick={onDone}>
              Edit the details instead
            </a>
          </div>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card className="card-pad space-y-5">
          <SectionTitle title="What are you looking for?" subtitle="Roles drive the search and the matching weights." />
          <Field label="Target roles" hint="Pick from the catalogue or add your own.">
            <TagInput
              values={settings.roles || []}
              onChange={(roles) => onSettings({ ...settings, roles })}
              placeholder="Add a role, e.g. Design Lead"
              suggestions={roleCatalogue.map((r) => r.label)}
              max={12}
            />
          </Field>
          <Field label="Locations" hint="Countries, cities, or “Remote” / “International”.">
            <TagInput
              values={settings.locations || []}
              onChange={(locations) => onSettings({ ...settings, locations })}
              placeholder="e.g. South Africa"
              suggestions={['South Africa', 'Remote', 'International', 'United Kingdom', 'Netherlands', 'Germany', 'United States', 'Canada', 'Australia', 'United Arab Emirates', 'Kenya', 'Ireland']}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Work modes">
              <div className="space-y-2">
                {[
                  ['remote', 'Remote'],
                  ['hybrid', 'Hybrid'],
                  ['onsite', 'On-site'],
                ].map(([key, label]) => (
                  <Toggle
                    key={key}
                    label={label}
                    checked={(settings.workModes || []).includes(key)}
                    onChange={(on) =>
                      onSettings({
                        ...settings,
                        workModes: on ? [...(settings.workModes || []), key] : (settings.workModes || []).filter((m) => m !== key),
                      })
                    }
                  />
                ))}
              </div>
            </Field>
            <Field label="Employment types">
              <div className="space-y-2">
                {[
                  ['full-time', 'Full-time'],
                  ['part-time', 'Part-time'],
                  ['contract', 'Contract'],
                  ['freelance', 'Freelance'],
                  ['internship', 'Internship'],
                ].map(([key, label]) => (
                  <Toggle
                    key={key}
                    label={label}
                    checked={(settings.employmentTypes || []).includes(key)}
                    onChange={(on) =>
                      onSettings({
                        ...settings,
                        employmentTypes: on ? [...(settings.employmentTypes || []), key] : (settings.employmentTypes || []).filter((m) => m !== key),
                      })
                    }
                  />
                ))}
              </div>
            </Field>
          </div>
          <div className="flex justify-between">
            <button className="btn-ghost" onClick={() => setStep(1)}>
              Back
            </button>
            <button className="btn-primary" onClick={() => setStep(3)}>
              Continue
            </button>
          </div>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card className="card-pad space-y-5">
          <SectionTitle title="Application policy & schedule" subtitle="These thresholds decide what gets applied to, reviewed or skipped." />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={`Auto-apply threshold — ${settings.autoApplyThreshold}%`} hint="At or above this score, the agent applies automatically (when the platform permits it).">
              <input
                type="range"
                min="50"
                max="100"
                value={settings.autoApplyThreshold}
                onChange={(e) => onSettings({ ...settings, autoApplyThreshold: Number(e.target.value) })}
                className="w-full"
              />
            </Field>
            <Field label={`Review threshold — ${settings.reviewThreshold}%`} hint="Between this and the auto-apply threshold, everything is prepared for your confirmation.">
              <input
                type="range"
                min="40"
                max="100"
                value={settings.reviewThreshold}
                onChange={(e) => onSettings({ ...settings, reviewThreshold: Math.min(Number(e.target.value), settings.autoApplyThreshold) })}
                className="w-full"
              />
            </Field>
            <Field label={`Minimum match to consider — ${settings.minMatchScore}%`} hint="Below this, jobs are skipped without touching your CV.">
              <input type="range" min="0" max="100" value={settings.minMatchScore} onChange={(e) => onSettings({ ...settings, minMatchScore: Number(e.target.value) })} className="w-full" />
            </Field>
            <Field label={`Duration — ${settings.durationDays} day(s)`} hint="The agent keeps hunting for this long, on the schedule you set.">
              <input type="range" min="1" max="30" value={settings.durationDays} onChange={(e) => onSettings({ ...settings, durationDays: Number(e.target.value) })} className="w-full" />
            </Field>
            <Field label={`Runs per day — ${settings.runsPerDay}`}>
              <input type="range" min="1" max="12" value={settings.runsPerDay} onChange={(e) => onSettings({ ...settings, runsPerDay: Number(e.target.value) })} className="w-full" />
            </Field>
            <Field label="Max applications per day" hint="Hard cap, whatever the scores say.">
              <input
                type="number"
                min="1"
                max="100"
                className="input"
                value={settings.maxApplicationsPerDay}
                onChange={(e) => onSettings({ ...settings, maxApplicationsPerDay: Number(e.target.value) })}
              />
            </Field>
          </div>
          <div className="space-y-3 rounded-lg border border-ink-200 p-3">
            <Toggle
              label="Automatic application mode"
              hint="Off by default. When on, matches at or above the threshold are submitted where the platform permits it. Everything is still validated against your CV."
              checked={!!settings.autoApplyEnabled}
              onChange={(on) => onSettings({ ...settings, autoApplyEnabled: on, requireConfirmation: on ? false : true })}
            />
            <Toggle
              label="Require my confirmation before submitting"
              hint="Recommended. The agent prepares the full application and waits for you."
              checked={!!settings.requireConfirmation}
              onChange={(on) => onSettings({ ...settings, requireConfirmation: on })}
            />
            <Toggle
              label="Prefer recently posted jobs and fewer applicants"
              hint="Newer adverts and less-crowded postings are prioritised."
              checked={!!settings.prioritizeLowApplicants}
              onChange={(on) => onSettings({ ...settings, prioritizeLowApplicants: on })}
            />
          </div>
          <div className="rounded-lg bg-ink-900 px-4 py-3 text-xs text-ink-100">
            <p className="font-semibold text-white">The policy the agent will follow</p>
            <ul className="mt-1.5 space-y-1">
              <li>• Apply automatically at ≥ {settings.autoApplyThreshold}% {settings.autoApplyEnabled ? '' : '(automatic mode is off — you confirm instead)'}</li>
              <li>• Prepare for review between {settings.reviewThreshold}% and {settings.autoApplyThreshold - 1}%</li>
              <li>• Skip below {settings.minMatchScore}% — no time wasted</li>
              <li>• Never invent qualifications, employers, tools or years of experience</li>
              <li>• Never apply twice to the same posting, company + position, or over your {settings.maxApplicationsPerDay}/day cap</li>
              <li>• Skip anything flagged as a scam; pause for CAPTCHA, MFA or identity checks</li>
            </ul>
          </div>
          <div className="flex justify-between">
            <button className="btn-ghost" onClick={() => setStep(2)}>
              Back
            </button>
            <button className="btn-success" onClick={saveTargets} disabled={busy}>
              {busy ? 'Saving…' : 'Save and continue to dashboard'}
            </button>
          </div>
        </Card>
      ) : null}

      {busy && !result ? <Spinner label="Reading your CV…" /> : null}
    </div>
  );
}
