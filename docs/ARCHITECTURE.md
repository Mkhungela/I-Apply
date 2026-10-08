# Architecture

**AI Job Hunter** — developed by [Lulamile Mkhungela](https://github.com/LulamileMkhungela).

This document describes how the system is put together: the processes, the pipeline, the
database, the scoring model, the connector framework and the security posture.

---

## 1. Processes

```
                 ┌──────────────────────────────┐
   browser ───►  │  Express API  (server/src)   │  serves the built React app + /api
                 │  • auth, profile, settings   │
                 │  • jobs, applications        │
                 │  • campaigns, dashboard      │
                 └──────────────┬───────────────┘
                                │ same SQLite database (WAL)
                 ┌──────────────┴───────────────┐
                 │  Scheduler (services/        │  ticks every SCHEDULER_TICK_MS,
                 │  scheduler.js)               │  runs due campaigns, honours
                 │                              │  pause/resume/stop immediately
                 └──────────────────────────────┘
```

Two deployment shapes are supported:

1. **Single process** (`npm start`) — API + scheduler together. Simplest and the default.
2. **Split** (`SCHEDULER_ENABLED=false npm start` plus `npm run worker`) — the web tier can
   scale or restart without interrupting a hunt, and the worker can be supervised
   separately (systemd, Fly process groups, a separate container).

Either way the agent lives on the server. Closing the browser, or turning the device off,
does not stop a campaign — that is the whole point of the scheduler being a backend
component.

---

## 2. The pipeline

`services/jobPipeline.js` implements the loop. Every stage writes to the database as it
goes, so a run can be inspected after the fact (run summary, per-job activity log,
application timeline).

| Stage | What happens | Where |
| --- | --- | --- |
| **FIND** | Enabled connectors are searched per role/location; results are normalised, deduplicated and risk-screened | `connectors/*`, `jobNormalizer.js`, `scamDetector.js` |
| **ANALYSE** | Requirements, seniority, work mode, salary and recency are extracted from the advert | `matcher.js` |
| **MATCH** | Score 0–100 with a component breakdown, strong matches, gaps; caps applied | `matcher.js` |
| **REJECT poor matches** | Below the minimum score → `skip`, never prepared | `decidePolicy()` |
| **TAILOR** | Tailored CV ordering, cover letter, screening answers, all CV-backed | `applicationGenerator.js`, `documentRenderer.js` |
| **APPLY** | Auto-apply only where the source permits and the policy allows; otherwise prepare and hand off | `jobPipeline.submitApplication()` |
| **RECORD** | Application row, timeline events, confirmation (only if the platform confirmed) | `applications`, `application_events` |
| **CONTINUE / REPEAT** | The campaign's next run is scheduled; the run summary is stored | `scheduler.js` |
| **NOTIFY** | Strong match, submitted, human action needed, CAPTCHA/MFA, login expiry, blocked automation, interview detected, run finished | `notifications.js` |

### Application policy

| Score | Risk | Mode | Result |
| --- | --- | --- | --- |
| ≥ `autoApplyThreshold` (default 80) | low | auto-apply on, confirmation off | submit |
| ≥ `autoApplyThreshold` | low | confirmation required, or auto-apply off | prepare, await the user |
| `reviewThreshold`–`autoApplyThreshold − 1` (70–79) | low | any | prepare, recommend to the user |
| any | medium | any | always needs a human look |
| < `reviewThreshold` | any | any | skip |
| any | **high** | any | **skip — never applied to** |

Stored decisions are re-evaluated against the *current* settings whenever a campaign runs,
so changing a threshold takes effect on the next run rather than only for new vacancies.

---

## 3. Data model

SQLite (WAL) with a schema in `server/src/db/schema.sql`; migrations are applied on boot by
`server/src/db/index.js`. All application timestamps are ISO-8601 text so date-window
queries (dialy/weekly caps) are exact.

| Table | Holds |
| --- | --- |
| `users` | accounts, password hash, token version (session revocation) |
| `profiles` | parsed candidate profile + evidence for every value |
| `cvs` | uploaded CVs, extracted text, active flag, storage path |
| `user_settings` | roles, locations, work modes, employment types, salary, thresholds, limits, notification preferences |
| `connectors` | per-user connector state and encrypted credentials |
| `campaigns` | a hunt: schedule, duration, task limit, status, progress |
| `campaign_runs` | one execution: statistics, warnings, errors, summary |
| `jobs` | normalised vacancies, source, dedupe key, risk assessment |
| `matches` | score, breakdown, strong matches, gaps, decision + reason |
| `applications` | the application record (status, documents, answers, cover letter, confirmation) |
| `application_events` | the timeline of an application |
| `notifications` | in-app alerts |
| `activity_log` | what the agent did, per run |
| `audit_log` | security-relevant events |

Duplicate protection is enforced by unique keys and by explicit checks: a posting
(`dedupe_key`), a job ID, or a company + role that has already been applied to is refused
unless reapplication is enabled — and the check is repeated at submission time, not only at
preparation time.

---

## 4. Matching

`services/matcher.js` scores nine components and combines them with fixed weights:

| Component | What it measures |
| --- | --- |
| `skills` | coverage of the advert's requirements by CV skills (`coverage^1.02`, penalised below 65% and 40%) |
| `experience` | years and seniority fit, including *levels below* the advert |
| `roleFit` | how close the vacancy's role family is to the candidate's chosen roles |
| `titleAlignment` | title similarity |
| `location` | location and work-mode agreement |
| `industry` | industry overlap |
| `education` | qualification match |
| `employmentType` | full-time/contract/freelance alignment |
| `recency` | how fresh the posting is |

Caps make the score conservative rather than flattering: two or more seniority levels below
the advert caps the score at 78; a weak role fit caps at 79 and subtracts 5; a large
seniority overshoot or years shortfall caps further. Every cap is returned in the response
so the user can see *why* a score was limited.

The engine is deterministic and explainable. If an LLM provider is configured it is used
only to polish prose — never to decide whether you qualify for something.

---

## 5. Truth guard and generation

`services/applicationGenerator.js` builds the tailored CV, cover letter and screening
answers strictly from the profile, then `services/truthGuard.js` checks every generated
string against the CV's own facts: employers, titles, dates, technologies, certifications,
achievements and years of experience. Unsupported claims are removed and, where relevant,
the answer is marked as needing the user instead of being guessed. The target employer and
role being applied to are the only extra proper nouns permitted.

Documents are rendered to PDF per application (tailored CV, cover letter, and an answer
sheet) and stored under the user's own export directory. Downloads are authenticated.

---

## 6. Connectors

`connectors/index.js` is the single registry. Each connector declares:

* what it can do (`automatedSearch`, `automatedApply`: allowed / allowed with conditions /
  user-initiated / depends on host / prohibited),
* the compliance basis for that position,
* which credentials are required, and whether they are supplied,
* whether it can submit applications automatically.

| Source | Search | Apply | Notes |
| --- | --- | --- | --- |
| Greenhouse, Lever, Workable, SmartRecruiters | allowed (public APIs) | Greenhouse: allowed when the board accepts it | green |
| Remotive, Arbeitnow, Remote OK, RSS | allowed (public APIs/feeds) | assisted | no application endpoint |
| CSV / JSON import | user-initiated | assisted | your own data |
| Paste a job link | user-initiated, single page | depends on host | the compliant path for LinkedIn/Indeed/PNet |
| LinkedIn | prohibited | prohibited | no bot exists in this codebase; assisted handoff only |
| Indeed, Glassdoor, PNet, Careers24, Wellfound | prohibited/restricted | restricted | guided connector: you search, the agent prepares |
| Workday, company career pages | allowed where the employer permits | depends on tenant | per-tenant consent/credentials required |

"Clearly state what is required" is a first-class feature: the Sources screen lists the
missing credentials for each connector, and connectors that cannot work in the current
environment (for example, with outbound network access disabled) say so instead of
silently returning nothing.

---

## 7. Sessions and privacy

* Passwords: bcrypt. Sessions: signed JWT with a `token_version` for revocation.
* The session is delivered as an **httpOnly cookie** *and* as a token in the response body.
  Browsers block cookies when an app is embedded in a third-party frame; the client then
  sends `Authorization: Bearer` instead, so a signed-in user stays signed in. Revocation
  invalidates both at once.
* Any 401 returns the user to the sign-in screen with a clear message rather than a silent
  failure.
* CVs live under `DATA_DIR/uploads/user-<id>/`; credentials for connectors are encrypted at
  rest (`lib/crypto.js`) and never returned unmasked.
* `GET /api/auth/export` produces a full JSON export; `POST /api/auth/delete` removes the
  CV, the profile, the history or the entire account on request.

---

## 8. Error handling and observability

* Every route is wrapped by `asyncHandler`; failures become structured JSON errors with the
  right status code.
* Campaign runs never crash the worker: a failing job is recorded in `errors[]` and the run
  continues; failures are also written to the activity log with the reason.
* The scheduler reports progress (`step`, `message`, `current`, `total`) that the UI polls,
  and logs each stage.
* Structured logging (`lib/logger.js`) with levels and scopes; `LOG_LEVEL` controls
  verbosity.

---

## 9. Frontend

React 18 + Vite + Tailwind. One shell (`App.jsx`) with sidebar navigation, session
handling and 12-second dashboard polling; six views:

* **Dashboard** — start/pause/resume/stop a hunt, live progress, statistics, pipeline, recent applications.
* **Jobs** — discovered vacancies with filters and tabs, score breakdown, strong matches/gaps, risk banner, advert text, timeline, paste-a-link and CSV/JSON import.
* **Applications** — status tabs, per-application record, human-action banner, confirmation source, PDF downloads, editable answers/cover letter/notes, outcome recording.
* **Job sources** — grouped connector cards with policy chips, credential requirements, a test button and the capability panel.
* **Alerts** — notifications and the agent's activity log.
* **Settings** — search, application policy, limits, profile, notifications and privacy (export/delete).

The layout is responsive: sidebar on desktop, hamburger navigation and stacked cards on
mobile.
