/**
 * AI Job Hunter — autonomous job search and application platform.
 * Developed by Lulamile Mkhungela.
 */
import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Card, ConfirmButton, Field, KeyValue, SectionTitle, Tabs, TagInput, Toggle, useToast } from './ui.jsx';
import Integrations from './Integrations.jsx';

export default function SettingsPanel({ settings: initial, roleCatalogue, profile, onSaved, onProfileChanged }) {
  const [settings, setSettings] = useState(initial);
  const [tab, setTab] = useState('search');
  const [busy, setBusy] = useState(false);
  const [profileDraft, setProfileDraft] = useState(null);
  const { push } = useToast();

  useEffect(() => setSettings(initial), [initial]);
  useEffect(() => {
    if (!profile) return;
    setProfileDraft({
      fullName: profile.fullName || '',
      headline: profile.headline || '',
      email: profile.email || '',
      phone: profile.phone || '',
      location: profile.location || '',
      summary: profile.summary || '',
      yearsExperience: profile.yearsExperience ?? '',
      workAuthorization: profile.workAuthorization || '',
      salaryExpectation: profile.salaryExpectation || '',
      noticePeriod: profile.noticePeriod || '',
      skills: (profile.skills || []).map((s) => s.label || s),
    });
  }, [profile]);

  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.saveSettings({
        roles: settings.roles,
        locations: settings.locations,
        workModes: settings.workModes,
        employmentTypes: settings.employmentTypes,
        minMatchScore: Number(settings.minMatchScore),
        autoApplyThreshold: Number(settings.autoApplyThreshold),
        reviewThreshold: Number(settings.reviewThreshold),
        autoApplyEnabled: !!settings.autoApplyEnabled,
        requireConfirmation: !!settings.requireConfirmation,
        minSalary: settings.minSalary ? Number(settings.minSalary) : null,
        currency: settings.currency,
        maxApplicationsPerDay: Number(settings.maxApplicationsPerDay),
        maxApplicationsPerWeek: Number(settings.maxApplicationsPerWeek),
        maxPerCompany: Number(settings.maxPerCompany),
        durationDays: Number(settings.durationDays),
        cadence: settings.cadence,
        runsPerDay: Number(settings.runsPerDay),
        preferRecentDays: Number(settings.preferRecentDays),
        prioritizeLowApplicants: !!settings.prioritizeLowApplicants,
        reapplicationAllowed: !!settings.reapplicationAllowed,
        notifyInApp: !!settings.notifyInApp,
        notifyEmail: !!settings.notifyEmail,
        notifyWebhookUrl: settings.notifyWebhookUrl || null,
      });
      onSaved(saved.settings);
      push('Settings saved.', 'success');
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async () => {
    setBusy(true);
    try {
      const payload = { ...profileDraft, yearsExperience: profileDraft.yearsExperience === '' ? null : Number(profileDraft.yearsExperience) };
      delete payload.skills;
      const res = await api.patchProfile({ ...payload, skills: profileDraft.skills });
      onProfileChanged(res.profile);
      push('Profile updated — future applications use this.', 'success');
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="mt-1 text-sm text-ink-500">Search preferences, application policy, limits, notifications and your data.</p>
        </div>
        <button className="btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      <Tabs
        tabs={[
          { key: 'search', label: 'Search' },
          { key: 'policy', label: 'Application policy' },
          { key: 'limits', label: 'Limits' },
          { key: 'profile', label: 'Profile' },
          { key: 'notifications', label: 'Notifications' },
          { key: 'integrations', label: 'Email & AI' },
          { key: 'privacy', label: 'Privacy' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'search' ? (
        <Card className="card-pad space-y-5">
          <SectionTitle title="Roles & locations" subtitle="These drive live search queries and the role-fit part of the score." />
          <Field label="Target roles">
            <TagInput values={settings.roles || []} onChange={(roles) => setSettings({ ...settings, roles })} suggestions={roleCatalogue.map((r) => r.label)} placeholder="Add a role" max={12} />
          </Field>
          <Field label="Locations">
            <TagInput
              values={settings.locations || []}
              onChange={(locations) => setSettings({ ...settings, locations })}
              suggestions={['South Africa', 'Remote', 'International', 'United Kingdom', 'Netherlands', 'Germany', 'Ireland', 'United States', 'Canada', 'Australia', 'Kenya', 'United Arab Emirates']}
              placeholder="Add a location"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
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
                    onChange={(on) => setSettings({ ...settings, workModes: on ? [...settings.workModes, key] : settings.workModes.filter((m) => m !== key) })}
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
                    onChange={(on) => setSettings({ ...settings, employmentTypes: on ? [...settings.employmentTypes, key] : settings.employmentTypes.filter((m) => m !== key) })}
                  />
                ))}
              </div>
            </Field>
            <div className="space-y-4">
              <Toggle label="Prefer recent postings" hint={`Prioritise adverts newer than ${settings.preferRecentDays} days`} checked={settings.preferRecentDays > 0} onChange={(on) => setSettings({ ...settings, preferRecentDays: on ? 14 : 0 })} />
              <Toggle label="Prioritise fewer applicants" checked={!!settings.prioritizeLowApplicants} onChange={(on) => setSettings({ ...settings, prioritizeLowApplicants: on })} />
              <Field label="Minimum salary (optional)">
                <input className="input" type="number" value={settings.minSalary ?? ''} onChange={(e) => setSettings({ ...settings, minSalary: e.target.value })} />
              </Field>
            </div>
          </div>
        </Card>
      ) : null}

      {tab === 'policy' ? (
        <Card className="card-pad space-y-5">
          <SectionTitle title="Application policy" subtitle="The rules that decide apply / review / skip." />
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label={`Auto-apply at ${settings.autoApplyThreshold}% or above`}>
              <input type="range" min="50" max="100" value={settings.autoApplyThreshold} onChange={(e) => setSettings({ ...settings, autoApplyThreshold: Number(e.target.value) })} className="w-full" />
            </Field>
            <Field label={`Review band from ${settings.reviewThreshold}%`}>
              <input type="range" min="40" max="100" value={settings.reviewThreshold} onChange={(e) => setSettings({ ...settings, reviewThreshold: Math.min(Number(e.target.value), settings.autoApplyThreshold) })} className="w-full" />
            </Field>
            <Field label={`Minimum match ${settings.minMatchScore}%`}>
              <input type="range" min="0" max="100" value={settings.minMatchScore} onChange={(e) => setSettings({ ...settings, minMatchScore: Number(e.target.value) })} className="w-full" />
            </Field>
          </div>
          <div className="space-y-3 rounded-lg border border-ink-200 p-3">
            <Toggle
              label="Automatic application mode"
              hint="When on (and confirmation off), matches at or above the threshold are submitted wherever the platform permits it."
              checked={!!settings.autoApplyEnabled}
              onChange={(on) => setSettings({ ...settings, autoApplyEnabled: on, requireConfirmation: on ? settings.requireConfirmation : true })}
            />
            <Toggle
              label="Require my confirmation before submitting"
              hint="Strongly recommended. The agent prepares everything, you press submit (or let it submit for email applications)."
              checked={!!settings.requireConfirmation}
              onChange={(on) => setSettings({ ...settings, requireConfirmation: on })}
            />
            <Toggle
              label="Allow re-applying to the same company + position"
              hint="Off by default. When off, a company/role you already applied to is never applied to again."
              checked={!!settings.reapplicationAllowed}
              onChange={(on) => setSettings({ ...settings, reapplicationAllowed: on })}
            />
          </div>
          <div className="rounded-lg border border-ink-200 p-3 text-xs text-ink-600">
            <p className="font-semibold text-ink-700">Always enforced, regardless of these settings</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>Generated content is validated against your CV; unverifiable claims are stripped before anything is submitted.</li>
              <li>High-risk (likely scam) listings are never applied to.</li>
              <li>CAPTCHA, MFA, identity checks, logins and rate limits pause the application instead of being bypassed.</li>
              <li>A submission is only recorded as “submitted” when the platform or ATS actually accepted it.</li>
            </ul>
          </div>
        </Card>
      ) : null}

      {tab === 'limits' ? (
        <Card className="card-pad space-y-5">
          <SectionTitle title="Application limits & schedule" subtitle="Hard caps the agent can never exceed." />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Max applications per day">
              <input className="input" type="number" min="1" max="100" value={settings.maxApplicationsPerDay} onChange={(e) => setSettings({ ...settings, maxApplicationsPerDay: Number(e.target.value) })} />
            </Field>
            <Field label="Max applications per week">
              <input className="input" type="number" min="1" max="500" value={settings.maxApplicationsPerWeek} onChange={(e) => setSettings({ ...settings, maxApplicationsPerWeek: Number(e.target.value) })} />
            </Field>
            <Field label="Max active applications per company">
              <input className="input" type="number" min="0" max="20" value={settings.maxPerCompany} onChange={(e) => setSettings({ ...settings, maxPerCompany: Number(e.target.value) })} />
            </Field>
            <Field label="Default duration (days)">
              <input className="input" type="number" min="1" max="90" value={settings.durationDays} onChange={(e) => setSettings({ ...settings, durationDays: Number(e.target.value) })} />
            </Field>
            <Field label="Default runs per day">
              <input className="input" type="number" min="1" max="24" value={settings.runsPerDay} onChange={(e) => setSettings({ ...settings, runsPerDay: Number(e.target.value) })} />
            </Field>
            <Field label="Default cadence">
              <select className="input" value={settings.cadence} onChange={(e) => setSettings({ ...settings, cadence: e.target.value })}>
                <option value="once">Run once</option>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="custom">Custom interval</option>
              </select>
            </Field>
          </div>
        </Card>
      ) : null}

      {tab === 'profile' ? (
        <Card className="card-pad space-y-5">
          <SectionTitle
            title="Your profile"
            subtitle="Corrections here change every future application. The CV stays the source of truth for claims."
            right={
              <button className="btn-ghost" onClick={saveProfile} disabled={busy || !profileDraft}>
                Save profile
              </button>
            }
          />
          {profileDraft ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name">
                  <input className="input" value={profileDraft.fullName} onChange={(e) => setProfileDraft({ ...profileDraft, fullName: e.target.value })} />
                </Field>
                <Field label="Headline">
                  <input className="input" value={profileDraft.headline} onChange={(e) => setProfileDraft({ ...profileDraft, headline: e.target.value })} />
                </Field>
                <Field label="Email">
                  <input className="input" value={profileDraft.email} onChange={(e) => setProfileDraft({ ...profileDraft, email: e.target.value })} />
                </Field>
                <Field label="Phone">
                  <input className="input" value={profileDraft.phone} onChange={(e) => setProfileDraft({ ...profileDraft, phone: e.target.value })} />
                </Field>
                <Field label="Location">
                  <input className="input" value={profileDraft.location} onChange={(e) => setProfileDraft({ ...profileDraft, location: e.target.value })} />
                </Field>
                <Field label="Years of experience">
                  <input className="input" type="number" step="0.5" value={profileDraft.yearsExperience} onChange={(e) => setProfileDraft({ ...profileDraft, yearsExperience: e.target.value })} />
                </Field>
                <Field label="Work authorisation" hint="Used to answer right-to-work questions truthfully.">
                  <input className="input" value={profileDraft.workAuthorization} onChange={(e) => setProfileDraft({ ...profileDraft, workAuthorization: e.target.value })} />
                </Field>
                <Field label="Notice period">
                  <input className="input" value={profileDraft.noticePeriod} onChange={(e) => setProfileDraft({ ...profileDraft, noticePeriod: e.target.value })} />
                </Field>
                <Field label="Salary expectation">
                  <input className="input" value={profileDraft.salaryExpectation} onChange={(e) => setProfileDraft({ ...profileDraft, salaryExpectation: e.target.value })} />
                </Field>
              </div>
              <Field label="Professional summary">
                <textarea className="input h-28" value={profileDraft.summary} onChange={(e) => setProfileDraft({ ...profileDraft, summary: e.target.value })} />
              </Field>
              <Field label="Skills" hint="Add anything the parser missed. These are the skills that can be claimed in applications.">
                <TagInput values={profileDraft.skills} onChange={(skills) => setProfileDraft({ ...profileDraft, skills })} placeholder="Add a skill" />
              </Field>
              {profile?.extraction?.warnings?.length ? (
                <div className="rounded-lg bg-warn-500/10 p-3 text-xs text-warn-600">
                  <p className="font-semibold uppercase tracking-wide">Parser notes</p>
                  <ul className="mt-1 list-disc pl-5">
                    {profile.extraction.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <KeyValue
                items={[
                  { label: 'Experience entries', value: profile?.experience?.length ?? 0 },
                  { label: 'Education', value: profile?.education?.length ?? 0 },
                  { label: 'Certifications', value: profile?.certifications?.length ?? 0 },
                  { label: 'Projects', value: profile?.projects?.length ?? 0 },
                  { label: 'Quantified achievements', value: (profile?.achievements || []).length },
                  { label: 'Seniority (detected)', value: profile?.seniority },
                ]}
              />
            </>
          ) : (
            <p className="text-sm text-ink-500">No profile yet — upload a CV first.</p>
          )}
        </Card>
      ) : null}

      {tab === 'notifications' ? (
        <Card className="card-pad space-y-4">
          <SectionTitle title="Notifications" subtitle="You are told about strong matches, submissions, and anything that needs a human." />
          <Toggle label="In-app notifications" checked={!!settings.notifyInApp} onChange={(on) => setSettings({ ...settings, notifyInApp: on })} />
          <Toggle
            label="Email notifications"
            hint="Requires SMTP to be configured on the server (SMTP_HOST, SMTP_USER, SMTP_PASS)."
            checked={!!settings.notifyEmail}
            onChange={(on) => setSettings({ ...settings, notifyEmail: on })}
          />
          <Field label="Webhook URL (optional)" hint="POSTed for every notification — handy for Slack or n8n automations.">
            <input className="input" value={settings.notifyWebhookUrl || ''} onChange={(e) => setSettings({ ...settings, notifyWebhookUrl: e.target.value })} placeholder="https://hooks.slack.com/…" />
          </Field>
          <div className="rounded-lg border border-ink-200 p-3 text-xs text-ink-600">
            <p className="font-semibold text-ink-700">You will be notified when</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>A high-quality job (85%+) is found</li>
              <li>An application is submitted and the platform confirmed it</li>
              <li>Human action is required (answers needed, handoff to submit)</li>
              <li>A CAPTCHA, MFA, identity check or login wall is encountered — the agent pauses</li>
              <li>A platform signals automated-access protection</li>
              <li>An interview is recorded, and when a scheduled run finishes</li>
            </ul>
          </div>
        </Card>
      ) : null}

      {tab === 'integrations' ? <Integrations /> : null}

      {tab === 'privacy' ? (
        <Card className="card-pad space-y-4">
          <SectionTitle title="Your data" subtitle="Stored in your own database. Export or delete it whenever you like." />
          <div className="flex flex-wrap gap-2">
            <a className="btn-ghost" href="/api/auth/export">
              ⬇ Export everything (JSON)
            </a>
            <ConfirmButton
              className="btn-danger"
              confirmLabel="Tap again to delete CV"
              question="Delete the CV file and the extracted profile claims stay?"
              onConfirm={async () => {
                await api.deleteData('cv');
                push('CV deleted.', 'success');
                onProfileChanged(null);
              }}
            >
              Delete CV
            </ConfirmButton>
            <ConfirmButton
              className="btn-danger"
              confirmLabel="Tap again to delete matches"
              onConfirm={async () => {
                await api.deleteData('profile');
                push('Profile and matches deleted.', 'success');
                onProfileChanged(null);
              }}
            >
              Delete profile & matches
            </ConfirmButton>
            <ConfirmButton
              className="btn-danger"
              confirmLabel="Tap again to delete history"
              onConfirm={async () => {
                await api.deleteData('history');
                push('Application history deleted.', 'success');
                onProfileChanged(null);
              }}
            >
              Delete application history
            </ConfirmButton>
            <ConfirmButton
              className="btn-danger"
              confirmLabel="Tap again to delete the account"
              onConfirm={async () => {
                await api.deleteData('account');
                window.location.reload();
              }}
            >
              Delete my account
            </ConfirmButton>
          </div>
          <div className="rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
            <p className="font-semibold text-ink-700">How your CV is handled</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>The uploaded PDF and the text extracted from it are stored on your server only.</li>
              <li>Generated documents (tailored CV, cover letter, answer sheet) live in the exports folder per user.</li>
              <li>Raw CV text is never returned to the browser; only the structured profile and a summary of the evidence are.</li>
              <li>Connector credentials are encrypted with AES-256-GCM and are never echoed back.</li>
            </ul>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
