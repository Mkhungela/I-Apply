# AI Job Hunter

**Autonomous job search, matching and application platform.**

Upload your CV once. The agent searches for roles that fit, scores every vacancy against
what you have actually done, tailors your CV and cover letter, applies where a platform
permits it, and tracks everything — truthfully, within each platform's rules, and while
your device is off.

> **Developed by Lulamile Mkhungela.**
> Every part of this project — the frontend, the API, the database, the matching and
> generation engines, the job-source connectors, the scheduler and the documentation —
> was designed and written by Lulamile Mkhungela.

---

## What it actually does

**1. Your CV, once.** Upload a PDF (or paste text). The parser extracts your name, contact
details, LinkedIn/GitHub/portfolio links, skills, job titles, years of experience,
employment history with dates, education, certifications, tools, projects, languages and
industries. Every extracted value keeps the CV text it came from, so you can audit it.

**2. Your search.** Choose role titles (10 common UX/UI/product/frontend roles are
pre-filled, plus your own), locations, remote/hybrid/onsite preference, employment types,
minimum salary, minimum match score, and a run duration (1, 3, 7, 14 days or custom).

**3. Continuous hunting.** `FIND → ANALYSE → MATCH → REJECT POOR MATCHES → TAILOR →
APPLY (where permitted) → RECORD → CONTINUE → NOTIFY → REPEAT`. A backend scheduler runs
the campaign on its own timetable, so there is no "press start every morning". Pause,
resume and stop take effect immediately from the UI.

**4. Honest match scoring.** A 0–100 score with a breakdown you can inspect (skills,
experience, role fit, title alignment, location, industry, education, employment type,
recency), plus *Strong matches* and *Potential gaps*. Priority ordering weighs match
score, recency, preferred roles, location, salary, remote preference, experience fit and
how heavy the application is.

**5. Safety screening.** Listings that ask for money, push registration fees, use fake
recruiter patterns, odd email domains, crypto-only payment routes, sensitive-information
harvesting or suspicious redirects are flagged with the evidence. **High-risk listings are
never applied to** — not by the agent, and not by the submit endpoint either.

**6. Applications you can trust.** Cover letters, tailored CVs and screening answers are
generated only from what your CV supports; a truth guard blocks unsupported statements
rather than inventing them. Nothing is listed as *Applied* unless the target platform
confirmed it, and you can always see which confirmation source was used.

**7. Tracking and alerts.** A tracker with statuses *Found · Matched · Applied · Pending ·
Interview · Rejected · Withdrawn · Skipped*, a per-application record (title, company, URL,
date found, date applied, match score, CV version, cover letter, status, notes), and
notifications for strong matches, submissions, human-action steps, CAPTCHA/MFA walls,
login expiry, blocked automation, detected interviews and finished runs.

**8. Privacy.** CVs are stored server-side under a per-user directory, never echoed to
other users, and you can delete the CV, the parsed profile, your history, or the whole
account — plus export everything as JSON.

---

## Compliance is a design constraint, not a footnote

* **No LinkedIn automation.** LinkedIn's User Agreement prohibits bots and scrapers, so
  this app contains no code path that automates activity on LinkedIn. It is a first-class
  source via permitted mechanisms only: your configured search, assisted handoff and a
  gate that stays closed until you hold an approved LinkedIn partnership.
* **No bypassing anything.** No CAPTCHA solving, no MFA circumvention, no identity
  verification defeat, no bot-detection evasion, no rate-limit dodging. When a human step
  is reached the run pauses and you are told exactly what to do.
* **No invented facts.** Employers, titles, dates, technologies, certifications and
  metrics come from your CV or they do not appear.
* **No duplicate applications.** A posting, a job ID, or a company + title that you have
  already applied to is blocked — unless you explicitly enable reapplication.
* **No fake confirmations.** A submission is recorded as such only when the destination
  platform (or, for email applications, your own mail server) accepted it.
* **No pretending.** Where a source needs credentials, an API key or an approved
  integration before it can work, the app says so in the UI, lists what is required, and
  keeps the connector interface ready — rather than faking results.

The full policy matrix lives in [docs/COMPLIANCE.md](docs/COMPLIANCE.md).

---

## Quick start

```bash
git clone https://github.com/LulamileMkhungela/i-Apply.git
cd i-Apply
npm install                 # installs server + client workspaces
npm run build               # builds the React client into client/dist
cp .env.example .env        # optional: edit ports, secrets, SMTP, LLM
npm start                   # API + scheduler + built UI on http://localhost:8787
```

Open <http://localhost:8787>, create an account, and upload your CV. On a fresh,
non-production database the server also creates a demo account — click **“Explore with
demo data”** on the sign-in screen to look around a fully populated workspace (24
clearly-labelled sample vacancies, already scored) without signing up.

Requirements: **Node.js 22.5+** (uses the built-in `node:sqlite`; `better-sqlite3` is
optional). No external services are required to run: matching, tailoring and tracking work
with the built-in deterministic engine. An LLM key and an SMTP account are optional
extras.

---

## Adding your own job boards (bulk)

**Every account starts with 29 real boards** — 21 Greenhouse (Figma, Stripe, Vercel, Airbnb,
Dropbox, Reddit, Coinbase, takealot.com, OfferZen, Luno…), 4 Lever and 4 Workable — each one
verified against its platform's public API. They are ordinary defaults, not fixtures: prune
what you do not want, and paste your own.

Greenhouse, Lever, Workable and SmartRecruiters are searched per company identifier. Open
**Sources**, pick the platform, and paste your whole list — commas, newlines or a copied
JSON array all work:

```
vercel, figma, stripe, takealotgroup, yoco, offerzen
```

Then press **Verify saved list**. Each identifier is checked against the platform's *own*
public read API, so you get the truth: `✓ figma — Figma · 37 roles`, or a 404 that means the
token is wrong or the company moved ATS. One click prunes the dead ones.

Long lists are searched **in rotation** (`maxBoardsPerRun`, default 25 per run), so a
44-token list is covered over a couple of runs and no platform is hammered.

Nothing here scrapes a search engine. Token harvesting through Google is exactly the kind
of anti-bot workaround this project refuses to do — see
[docs/COMPLIANCE.md](docs/COMPLIANCE.md#9-board-tokens-are-verified-never-scraped).

### Connecting your email (real auto-apply) and free AI keys

Open **Settings → Email & AI**. Both are optional — the app runs completely without them.

**Email.** Pick your provider (Gmail, Google Workspace, Outlook, Zoho or any SMTP server),
then enter your address and an *app password*. For Gmail: turn on 2-Step Verification,
create an app password at `myaccount.google.com/apppasswords`, and paste the 16-character
code. Press **Send a test email** — you get a straight yes/no with the server's response,
not a guess. Once connected, applications to adverts that ask you to email your CV are
actually sent, and the mail server's acceptance is stored as the confirmation.

**AI.** Nine providers that issue **free keys on free accounts, with no credit card** are
listed with a link and their real limits — Google AI Studio, Groq, Cerebras, OpenRouter,
GitHub Models, Mistral, NVIDIA NIM, Hugging Face and Cloudflare. GitHub Models needs no new
signup if you already have a GitHub account; Google's is the strongest free tier.

Add two or three. They are tried in order and the app moves to the next one when a free
tier returns a rate limit, so generation is never interrupted. **Check my keys** asks each
one to reply, so a bad key is obvious immediately. Keys are encrypted on your server
(AES-256-GCM) and never returned to the browser.

Whatever a model writes is still validated against your CV: it can reword, but it cannot
add a qualification, employer, tool or year of experience that is not there.

### What actually submits by itself

| Route | Automatic? |
| --- | --- |
| Adverts that ask for an email application | **Yes** — sent through your SMTP account, with the server's acceptance stored as proof |
| Greenhouse board where you hold the company's Job Board API key | **Yes** — via the documented endpoint, Basic auth |
| Everything else | Prepared in full, then handed to you to submit |

Greenhouse's submission endpoint requires a Job Board API key issued to the **employer**, so
for a normal candidate every Greenhouse application is prepared and handed over. That is
stated in the app rather than papered over.

---

## Running it so it keeps working when your device is off

The app is designed to run on any always-on host — a small VPS, Fly.io, Railway, Render, a
Raspberry Pi:

```bash
npm start                   # one process: API + scheduler + UI
# or split them:
SCHEDULER_ENABLED=false npm start   # API/UI only
npm run worker                      # scheduler worker, no browser needed
```

**Fastest route to always-on — Fly.io.** One always-on machine with a persistent disk runs
the API, the database and the scheduler:

```bash
fly apps create ai-job-hunter-yourname   # names are global, pick your own
fly volumes create ajh_data --region jnb --size 1
fly secrets set JWT_SECRET="$(openssl rand -hex 48)"   # plus SMTP and AI keys
fly deploy
```

Step-by-step, including why the machine must never autostop:
[docs/DEPLOY-FLY.md](docs/DEPLOY-FLY.md).

> **Not GitHub Pages.** Pages serves static files only — no Node, no database, no
> scheduler — so the app cannot run there. It is a fine home for documentation, not for
> this. The reasoning is in the deploy guide.

Full self-hosting notes (systemd units, reverse proxy, backups, SMTP, LLM providers,
troubleshooting): [docs/SETUP.md](docs/SETUP.md).

**New here? Start with [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md)** — the step-by-step
checklist: which file to put your keys in, the three free AI providers worth using with the
exact model names, the Gmail app-password walkthrough, a VS Code run-and-test guide (press
F5), and what the agent will and will not do by itself.

This project ships a ready-made `.vscode/` setup: open the folder, run the
**"Set up .env from the template"** task, and press **F5**.

---

## How it is put together

```
client/                 React + Vite + Tailwind single-page app (served by the API in production)
  src/components/       Dashboard · Jobs · Applications · Sources · Alerts · Settings · Auth · Onboarding
  src/lib/api.js        Typed API client (cookie + bearer session, authenticated downloads)
server/
  src/app.js            Express app: security headers, sessions, routes, static client, error handling
  src/index.js          Entry point: API + scheduler
  src/worker.js         Standalone always-on scheduler worker
  src/db/               Schema (14 tables), migrations, adapter (node:sqlite / better-sqlite3)
  src/services/         cvParser · profileBuilder · matcher · scamDetector · truthGuard ·
                        applicationGenerator · documentRenderer · jobPipeline · scheduler ·
                        notifications · dashboard · privacy · demoSeed · llm
  src/connectors/       Greenhouse · Lever · Workable · SmartRecruiters · Remotive ·
                        Arbeitnow · Remote OK · RSS · CSV/JSON import · manual link ·
                        guided connectors for LinkedIn, Indeed, PNet, Careers24, Glassdoor,
                        Wellfound, Workday and company career pages
  src/routes/           auth · profile · config · hunt
tools/smtp-sink.js      Local SMTP sink for exercising email applications in development
server/test/            Unit tests + end-to-end API tests (node:test)
```

Pipeline and data model in detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Endpoint reference: [docs/API.md](docs/API.md).

---

## Tests

```bash
npm test
```

`server/test/unit.test.js` covers CV parsing, application-email detection, scam screening,
the application policy thresholds, the truth guard and document generation.
`server/test/api.test.js` boots a real server on a throwaway database and exercises
authentication, a full hunt run, document downloads, the duplicate rules, the high-risk
block, outcome tracking, campaign lifecycle and the privacy controls over HTTP.

---

## Configuration

Everything is optional except the basics — see [.env.example](.env.example):

| Variable | Purpose |
| --- | --- |
| `PORT`, `HOST`, `DATA_DIR` | Where the server listens and stores its database, uploads and exports |
| `JWT_SECRET` | Session signing key (auto-generated and persisted if unset) |
| `SCHEDULER_ENABLED`, `SCHEDULER_TICK_MS` | Whether this process runs the agent, and how often it checks |
| `CONNECTOR_NETWORK_ENABLED`, `CONNECTOR_TIMEOUT_MS`, `CONNECTOR_PAGE_LIMIT` | Outbound job-source access |
| `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` | Optional prose polish (the app is fully functional without it) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Email applications and email notifications |
| `ALLOW_REGISTRATION`, `SECURE_COOKIES` | Account creation and cookie hardening |

---

## Licence and ownership

Written and maintained by **Lulamile Mkhungela**
(<https://github.com/LulamileMkhungela>). See [AUTHORS.md](AUTHORS.md).
