# API reference

**AI Job Hunter** — developed by [Lulamile Mkhungela](https://github.com/LulamileMkhungela).

All endpoints are JSON over HTTP, same-origin with the client. Authentication is a session
cookie **or** `Authorization: Bearer <token>` (both are issued on sign-in; see
[ARCHITECTURE.md](ARCHITECTURE.md) §7).

Responses use the resource name as the key (`{ "jobs": [...] }`) and errors are
`{ "error": "message" }` with an appropriate status code.

---

## Authentication — `/api/auth`

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/register` | Create an account. Returns `{ user, token, expiresInDays }` |
| `POST` | `/login` | Sign in. Returns `{ user, token, expiresInDays }` |
| `POST` | `/demo-login` | One-click demo workspace (non-production only) |
| `POST` | `/logout` | Clear the session cookie |
| `GET` | `/me` | Current user, or `{ user: null }` |
| `POST` | `/logout-all` | Revoke every session (bumps the token version) |
| `GET` | `/export` | Full JSON export of your data |
| `POST` | `/delete` | `{ scope: "cv" \| "profile" \| "history" \| "account" }` |

## CV and profile — `/api`

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/cv` | Upload a CV (multipart `file`, PDF or text). Parses and builds the profile |
| `DELETE` | `/cv` | Remove the active CV |
| `GET` | `/profile` | Parsed profile with evidence |
| `PUT` | `/profile` | Edit the profile (corrections always win over parsing) |
| `POST` | `/profile/reparse` | Re-run extraction from the stored CV text |

## Settings — `/api`

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/settings` | Settings plus the role catalogue |
| `PUT` | `/settings` | Update roles, locations, work modes, thresholds, limits, notifications |
| `GET` | `/policy` | The compliance model per source |
| `GET` | `/system/capabilities` | LLM/SMTP/network state and the full source capability matrix |
| `POST` | `/system/demo` | Load (or refresh) the labelled demo dataset |

## Jobs — `/api`

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/jobs` | List vacancies. Filters: `status`, `minScore`, `q`, `source`, `limit` |
| `GET` | `/jobs/:id` | Job, match breakdown, strong matches, gaps, risk, events |
| `POST` | `/jobs/:id/analyze` | Re-score against the current profile and settings |
| `POST` | `/jobs/:id/prepare` | Generate the application package (and apply if policy allows) |
| `POST` | `/jobs/:id/skip` | Mark as skipped with a reason |
| `POST` | `/jobs/manual` | Add a vacancy from a pasted link/advert, optionally analysing it |
| `POST` | `/jobs/import` | Import vacancies from CSV/JSON |
| `POST` | `/sources/search` | Ad-hoc search across configured sources (preview only) |

## Applications — `/api`

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/applications` | Tracker list. Filters: `status`, `limit` |
| `GET` | `/applications/:id` | Full record: application, job, match, timeline, documents |
| `POST` | `/applications/:id/submit` | Submit now (respects every policy and safety rule) |
| `PATCH` | `/applications/:id` | Edit answers, cover letter or notes |
| `POST` | `/applications/:id/outcome` | Record `applied` (user-asserted), `interview`, `rejected`, `withdrawn`, `blocked` |
| `GET` | `/applications/:id/documents/:kind` | Download `cv` or `cover` as a PDF |

## Campaigns — `/api`

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/campaigns` | List campaigns with recent runs |
| `POST` | `/campaigns` | Create: `name`, `durationDays`, `cadence`, `runsPerDay`, `taskLimit`, `searchMode`, `startImmediately` |
| `GET` | `/campaigns/:id` | Campaign, runs, statistics, live progress |
| `POST` | `/campaigns/:id/start` | Start (or restart) the schedule |
| `POST` | `/campaigns/:id/pause` | Pause — no further runs until resumed |
| `POST` | `/campaigns/:id/resume` | Resume, optionally running immediately |
| `POST` | `/campaigns/:id/stop` | Stop the hunt permanently |
| `POST` | `/campaigns/:id/run` | Run once, now |
| `POST` | `/hunt/run-once` | One-off run with no schedule attached |

## Dashboard, alerts, sources — `/api`

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/dashboard` | Statistics, pipeline, recent applications, campaign and scheduler state |
| `GET` | `/notifications` | Alerts with `unread` count |
| `POST` | `/notifications/read` | Mark alerts read (`{ ids: [...] }` or all) |
| `GET` | `/activity` | The agent's activity log |
| `GET` | `/connectors` | Source cards: status, missing credentials, capabilities |
| `PUT` | `/connectors/:key` | Save credentials/configuration for a source |
| `POST` | `/connectors/:key/test` | Test a source and report what it needs |
| `POST` | `/connectors/:key/boards` | Bulk-save a board list (`{ text }` or `{ tokens: [...] }`, optional `replace`) |
| `POST` | `/connectors/:key/verify-boards` | Check every saved identifier against the platform's public read API |
| `POST` | `/connectors/:key/boards/prune` | Drop the identifiers that failed verification |
| `GET` | `/health` | Liveness probe |

---

## Example: a complete hunt

```bash
BASE=http://localhost:8787
COOKIE=/tmp/ajh.cookies

# 1. account
curl -s -c $COOKIE -X POST $BASE/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"a-strong-password","name":"Your Name"}'

# 2. CV
curl -s -b $COOKIE -X POST $BASE/api/cv -F "file=@/path/to/cv.pdf"

# 3. search preferences
curl -s -b $COOKIE -X PUT $BASE/api/settings -H 'content-type: application/json' \
  -d '{"roles":["UX Designer","Product Designer"],"locations":["South Africa","Remote"],
       "minMatchScore":70,"autoApplyThreshold":80,"maxApplicationsPerDay":5,"durationDays":7}'

# 4. start a 7-day hunt that runs three times a day
curl -s -b $COOKIE -X POST $BASE/api/campaigns -H 'content-type: application/json' \
  -d '{"name":"7-day UX hunt","durationDays":7,"runsPerDay":3,"taskLimit":10,"startImmediately":true}'

# 5. watch it
curl -s -b $COOKIE $BASE/api/dashboard
curl -s -b $COOKIE $BASE/api/applications

# 6. pause / resume / stop
curl -s -b $COOKIE -X POST $BASE/api/campaigns/1/pause
curl -s -b $COOKIE -X POST $BASE/api/campaigns/1/resume
curl -s -b $COOKIE -X POST $BASE/api/campaigns/1/stop
```


---

## Bulk board lists

Greenhouse, Lever, Workable and SmartRecruiters are searched by identifier, so a list of
companies is the whole configuration. Paste them in whatever shape you have them — commas,
newlines, mixed, or a copied JSON array — and they are normalised, de-duplicated and stored:

```bash
curl -X POST $HOST/api/connectors/greenhouse/boards \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"text":"vercel, figma, stripe\ntakealotgroup, yoco, offerzen"}'
# → { "added": 6, "total": 6, "identifiers": ["vercel", "figma", …] }
```

Then ask the platforms themselves which entries are real:

```bash
curl -X POST $HOST/api/connectors/greenhouse/verify-boards \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"limit":60}'
# → { "checked": 60, "working": [{ "identifier":"figma", "company":"Figma", "jobs":37 }, …],
#     "notFound": ["some-typo"], "totals": { "ok": 41, "notFound": 19, "jobsFound": 1204 } }
```

A board that returns postings is live; a 404 means the token is wrong or the company moved
to another ATS. `prune` removes the dead ones so later runs are not wasted on them.

**Long lists are worked in rotation, not all at once.** `maxBoardsPerRun` (default 25)
governs how many boards a run visits; the offset advances each run, so a 44-token list is
covered across two runs and the platform sees a modest, polite request rate.

## Applying automatically — what is actually possible

| Route | Automatic submission |
| --- | --- |
| Email adverts (`apply@`, `careers@`…) | **Yes** — sent through your own SMTP account; the mail server's acceptance is stored as confirmation |
| Greenhouse board with an employer API key | **Yes** — `POST /v1/boards/{token}/jobs/{id}` with Basic auth using the key the hiring company issued to you |
| Greenhouse board without that key | No — prepared in full and handed to you. The key is issued to employers, not to candidates |
| Lever / Workable / SmartRecruiters | No — needs the employer's account credentials |
| LinkedIn / Indeed / PNet / Careers24 / Glassdoor / Wellfound | No — the connector reads via permitted APIs or accepts pasted links, then prepares everything for you |

Where the answer is "No", the application record moves to **Awaiting your action** with the
tailored CV, cover letter and drafted answers attached. Nothing is ever reported as sent
unless the destination confirmed it.

---

## Integrations

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/settings/email` | The mail-account form: current values, provider presets, readiness |
| `PUT` | `/settings/email` | Save the mail account (password encrypted; blank keeps the stored one) |
| `POST` | `/settings/email/test` | Send one real test message and report the server's answer |
| `GET` | `/settings/ai` | The provider catalogue (free tiers, signup links) plus the user's list |
| `PUT` | `/settings/ai` | Save the ordered provider list (blank key keeps the stored one) |
| `POST` | `/settings/ai/test` | Ask every configured provider to answer, and report which did |

Passwords and keys are stored encrypted (AES-256-GCM) and are **never** returned — the API
reports `passwordSet` / `keySet` and a masked hint only. Environment variables
(`SMTP_*`, `LLM_PROVIDER` + `LLM_API_KEY`, plus numbered extras `LLM_PROVIDER_2` … `_5`)
act as the fallback for accounts that have not saved their own.

```bash
# stack two free providers, then check them
curl -X PUT $HOST/api/settings/ai -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"providers":[{"id":"google","apiKey":"…"},{"id":"groq","apiKey":"…"}]}'
curl -X POST $HOST/api/settings/ai/test -H "authorization: Bearer $TOKEN"
# → { "results": [ { "id":"google","ok":true }, { "id":"groq","ok":true } ], "working": 2, "tested": 2 }
```
