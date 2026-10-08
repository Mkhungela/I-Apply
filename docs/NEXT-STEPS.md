# What to do next

**AI Job Hunter** — developed by [Lulamile Mkhungela](https://github.com/LulamileMkhungela).

This is the practical, step-by-step checklist to go from "code on GitHub" to "hunting for
me, on a server, with my keys". Everything here is copy-pasteable.

---

## 0. Read this first: what "aggressive" can and cannot mean

I want to be straight with you, because it affects what you should expect.

**What I built is genuinely aggressive on the part that is allowed:** it searches 21+ live
boards plus the open aggregators continuously, scores everything against your CV, tailors a
CV and cover letter per match, answers screening questions from your real history, tracks
every application, and applies **by itself** wherever a platform actually permits it.

**What it will not do is bypass a platform's protections** — defeat CAPTCHA, fake a human
session, rotate identities, ignore rate limits, or automate LinkedIn/Indeed/Glassdoor
against their terms. That is not caution for its own sake. Two concrete reasons:

1. **It would get your accounts banned.** Platforms detect automation by behaviour, and the
   penalty lands on the account that matters — yours. A banned LinkedIn or Indeed account
   costs you more than every application it could ever send.
2. **You set that rule yourself**, at the top of the original spec: *"never violate platform
   terms/anti-bot/API rules; no bypassing CAPTCHA, MFA, bot detection, rate limits, access
   controls"*. I built to that spec, and I am not going to quietly break it.

So the honest maximum is this: **every application that can legitimately be automated, is.**
For the rest, the app does 100% of the work and leaves you a single click — open, attach,
send. That one click is not a limitation I can engineer away; it is the price of your
accounts staying alive.

Where the line actually falls:

| Route | What the app does by itself |
| --- | --- |
| Adverts that ask for an email application | **Sends it.** Fully automatic. |
| Greenhouse board where you hold the employer's Job Board API key | **Submits it.** Fully automatic. |
| Greenhouse / Lever / Workable / SmartRecruiters without that key | Writes everything, then gives you the posting link pre-loaded with your documents. |
| Remotive, Arbeitnow, Remote OK, RSS, CSV import | Finds and processes; applies on the employer's own site. |
| LinkedIn, Indeed, Glassdoor, PNet, Careers24, Wellfound, Workday | You paste the link; it parses, scores, tailors and drafts. You press send. |

The email route is the big one, and it is fully automatic. A large share of South African
SME and agency adverts ask for applications by email — those send themselves.

---

## 1. Which file, and what goes in it

There are **two** places to put keys. You can use either; the app checks them in this order.

### Option A — in the app (recommended for AI keys)

Nothing to edit. Sign in → **Settings → Email & AI** → paste each key → **Save providers** →
**Check my keys**. Stored encrypted (AES-256-GCM) on your server, editable later, and it
tells you immediately which keys work.

### Option B — in a file called `.env`

The file is **`.env` in the root of the project** — the same folder as `package.json`.
It does not exist yet; create it by copying the template:

```bash
cd /path/to/i-Apply
cp .env.example .env
nano .env          # or any editor
```

> Note: `.env` is in `.gitignore`, so your keys are never committed or pushed. Only put
> real keys in `.env` on your own machine or server — never in `.env.example`.

Below is the complete contents to use. Everything that is not a key is already correct for
a production host; the comments explain each block.

---

## 2. The three AI keys (free, top models)

At least three, as you asked. These are the best free tiers available, all no credit card
required. In the app, pick the provider and paste the key; if you use `.env`, the block at
the end of this section is ready to paste.

| # | Provider | Get the key at | The model to type | Free allowance |
| --- | --- | --- | --- | --- |
| 1 | **Google AI Studio** — best quality | <https://aistudio.google.com/app/apikey> | `gemini-2.5-pro` (or `gemini-2.5-flash` for volume) | ~50/day on Pro, ~250–1,500/day on Flash |
| 2 | **Groq** — fastest, big ceiling | <https://console.groq.com/keys> | `llama-3.3-70b-versatile` | ~30/min, up to ~14,400/day |
| 3 | **Cerebras** — most free tokens | <https://cloud.cerebras.ai/> | `llama-3.3-70b` | ~1M tokens/day |
| 4 | **OpenRouter** — breadth, optional | <https://openrouter.ai/keys> | `deepseek/deepseek-r1:free` | ~50/day (every model name needs `:free`) |

**GitHub Models** is also worth adding if you want a fourth: <https://github.com/settings/tokens>
→ create a token with the `models:read` scope, model `openai/gpt-4o`. No new signup.

They are tried **in the order you list them**, and when one hits a rate limit the app moves
to the next automatically. That is why three beats one: your generation never stalls.

### The `.env` block

Open `.env` and set these. Replace each `PASTE_...` with your real key. Leave a line
commented out (`#`) if you did not get that key.

```env
# --- AI providers: tried in order, first working one wins --------------------
# 1. Google AI Studio — best quality (aistudio.google.com/app/apikey is the source of truth)
LLM_PROVIDER=google
LLM_API_KEY=PASTE_GOOGLE_AI_STUDIO_KEY_HERE
LLM_MODEL=gemini-2.5-pro

# 2. Groq — fastest, highest daily ceiling
LLM_PROVIDER_2=groq
LLM_API_KEY_2=PASTE_GROQ_KEY_HERE
LLM_MODEL_2=llama-3.3-70b-versatile

# 3. Cerebras — most free tokens per day
LLM_PROVIDER_3=cerebras
LLM_API_KEY_3=PASTE_CEREBRAS_KEY_HERE
LLM_MODEL_3=llama-3.3-70b

# 4. OpenRouter — optional, one key reaches ~25 free models
# LLM_PROVIDER_4=openrouter
# LLM_API_KEY_4=PASTE_OPENROUTER_KEY_HERE
# LLM_MODEL_4=deepseek/deepseek-r1:free

# How long to wait for a model before moving to the next provider
# LLM_TIMEOUT_MS=30000
```

Check they work: **Settings → Email & AI → Check my keys**. It asks each provider to answer
and reports exactly which ones replied, so a typo or an unverified account is obvious in
seconds rather than mid-hunt.

---

## 3. Email — this is what turns on real auto-apply

Do not skip this one; it is the highest-value item in the whole list, because it is the only
route that sends applications by itself.

**Gmail / Google Workspace:**

1. Turn on 2-Step Verification: <https://myaccount.google.com/security>
2. Open <https://myaccount.google.com/apppasswords> (it only appears after step 1)
3. Create one named "AI Job Hunter" and copy the **16-character** code
4. In the app: **Settings → Email & AI** → Gmail → paste your address and that code
5. Press **Send a test email** — it tells you the mail server's actual answer

Your normal Gmail password **will not work** here. That is the single most common failure.

In `.env` instead:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=you@gmail.com
SMTP_PASS=the 16 character app password
SMTP_FROM="Your Name <you@gmail.com>"
```

---

## 4. The rest of the `.env` (production host)

```env
# --- Server ----------------------------------------------------------------
NODE_ENV=production
PORT=8787
HOST=0.0.0.0
DATA_DIR=./data
# Set this explicitly in production — generate with: openssl rand -hex 48
JWT_SECRET=PASTE_A_LONG_RANDOM_STRING_HERE

# --- Scheduler: this is what keeps hunting when your laptop is off ----------
SCHEDULER_ENABLED=true
SCHEDULER_TICK_MS=15000

# --- Job sources: MUST be true or nothing can be fetched --------------------
CONNECTOR_NETWORK_ENABLED=true
CONNECTOR_TIMEOUT_MS=12000
CONNECTOR_PAGE_LIMIT=40

# --- Lock the instance down to just you ------------------------------------
ALLOW_REGISTRATION=false
ALLOW_DEMO_LOGIN=false
AUTO_SEED_DEMO=false
```

`CONNECTOR_NETWORK_ENABLED=true` is the one people forget. With it `false`, the app runs
perfectly but fetches nothing, and every source reports "network disabled".

---

## 5. Run it — and test it in VS Code

I have added a `.vscode/` folder to the project, so VS Code already knows how to run,
debug and test all of this. You do not have to type most of the commands.

### 5.1 One-time setup

1. **Install Node.js 22.5 or newer** (<https://nodejs.org>) — the app uses Node's built-in
   SQLite, which older versions do not have. Check with `node -v`.
2. **Open the project folder in VS Code:** `File → Open Folder…` → select `i-Apply`.
3. VS Code will offer to install the recommended extensions — accept.
4. **Create your `.env`:** `Ctrl+Shift+P` → `Tasks: Run Task` → **"Set up .env from the
   template"**. Then open `.env` and paste your keys (section 2 and 3 above).
5. **Install and build:** run these two tasks the same way —
   **"1 · Install dependencies"**, then **"2 · Build the web UI"**.

### 5.2 Start it

Press **F5** and choose **"▶ Server, then open the browser"**. That starts the API, the
worker and the UI in one process, and opens `http://localhost:8787` for you.

Or from the integrated terminal (`Ctrl+``):

```bash
npm run build     # only needed once, or after changing client/ code
npm start
```

`Ctrl+C` in the terminal stops it.

### 5.3 Develop the UI with instant reload

If you are changing the interface, use the hot-reloading setup instead. Press **F5** →
**"══ DEV: server + hot-reloading UI ══"**. That runs two processes together:

* the API on `:8787`
* Vite on `:5173`, which serves the UI and proxies `/api` to the backend

Edit anything under `client/src/` and the browser refreshes instantly — no rebuild. I have
tested this path: the UI loads on `:5173`, `/api/version` and authenticated calls like
`/api/dashboard` all come back `200` through the proxy. **Use `:5173` in this mode**, not
`:8787` (that one is serving the last build).

### 5.4 Test it

**Run the automated tests** — F5 → **"Tests (all 61)"**, or in the terminal:

```bash
npm test
```

You should see **61 tests, 61 passing**. To debug a single file, open it and press F5 →
**"Tests: only the file I have open"**.

**Then walk the real thing end to end** (each of these exercises a different part):

| # | Do this | You should see |
| --- | --- | --- |
| 1 | Open `http://localhost:8787`, register an account | Signed in, dashboard loads |
| 2 | Upload your CV (PDF) | Name, skills, titles, experience extracted — check them against the PDF |
| 3 | **Settings → Email & AI** → paste your Gmail address + app password → **Send a test email** | "Test email accepted…" — check that inbox |
| 4 | Same tab → paste your three AI keys → **Save providers** → **Check my keys** | "3 of 3 provider(s) answered" |
| 5 | **Job sources** → Greenhouse → **Verify saved list** | Your account already holds the default boards; live ones show role counts, dead ones say not found |
| 6 | **Settings → Search** → set roles and locations → Save | Settings persist after a refresh |
| 7 | **Dashboard → Start hunt** | Stats start moving; the activity log fills in |
| 8 | **Applications** | Each row shows a match score, the CV version used and a status |

If steps 3–5 work, the whole wiring is correct: mail, AI and job sources are all live.

### 5.5 Debugging

* **Breakpoints** work normally on the server — put one in
  `server/src/services/jobPipeline.js` (for example in `submitApplication`) and press F5.
* The app logs every HTTP request with its status and which credential was used, so the
  terminal tells you what the browser actually asked for. `LOG_LEVEL=debug` adds more.
* To debug an already-running server, start it with
  `node --inspect server/src/index.js` and use F5 → **"Attach to a running server"**.
* **Nothing fetched?** Almost always `CONNECTOR_NETWORK_ENABLED`. The launch config sets it
  to `true`; if you set it to `false` in `.env`, the `.env` value wins.

### 5.6 Run it on a server instead

For the always-on host (so it hunts while your laptop is shut):

```bash
npm install
npm run build
npm start
```

**Recommended: Fly.io** — one always-on machine, a persistent disk for your database, and a
guide that walks through the CLI, the secrets, the volume and the one setting that matters
most (autostop must be **off**, or the hunt pauses whenever nobody is looking at the
dashboard):

```bash
fly apps create ai-job-hunter-yourname
fly volumes create ajh_data --region jnb --size 1
fly secrets set JWT_SECRET="$(openssl rand -hex 48)"
fly deploy
```

Full walkthrough: **[DEPLOY-FLY.md](DEPLOY-FLY.md)**.

Any other always-on host works the same way — the container is in `Dockerfile`, and SETUP.md
has systemd units, reverse-proxy config and backups: [SETUP.md](SETUP.md).

> Hosting has to be a real Node host. GitHub Pages cannot run this app: it serves static
> files only, so there is no API, no database and no scheduler, and every `/api/...` call
> from the UI would 404.

---

## 6. What happens once it is running

Per cycle, automatically:

1. **Finds** new postings from your boards — every account starts with 29 verified public
   ones (21 Greenhouse, 4 Lever, 4 Workable) — plus the open aggregators
2. **Reads** each advert and scores it against your CV
3. **Rejects** anything below your threshold, and anything the scam detector flags —
   money requests, fake recruiters, crypto payments, odd domains, sensitive-data asks
4. **Tailors** a CV and writes a cover letter for everything that passes
5. **Applies** — by email where the advert asks for it, via the ATS API where permitted
6. **Records** every one with its match score, the CV version used and the confirmation
7. **Notifies** you about strong matches, submissions, and anything needing a human
8. **Repeats** on your schedule until the hunt's duration ends

Rejections are respected: no duplicate application to the same posting, job ID, or
company+role unless you explicitly turn reapplication on.

---

## 7. If something looks wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| Every source says "network disabled" | `CONNECTOR_NETWORK_ENABLED=false` | Set it to `true`, restart |
| "No mail account is connected" | SMTP not set | Settings → Email & AI |
| Gmail test fails with "invalid login" | Normal password used instead of an app password | Create one at myaccount.google.com/apppasswords |
| Sources report 404s for a board | The company moved ATS or the token is wrong | Job sources → Verify saved list → prune |
| Letters still read plainly | No AI key configured, or every key failed | Settings → Email & AI → Check my keys |
| Applications stay "Awaiting your action" | That route cannot legally be automated | Open the record, use the pre-loaded link |
| `npm start` fails: "Cannot find module dist/index.html" | UI not built | Run the task **"2 · Build the web UI"** |
| F5 opens `:8787` but the page looks stale | You are in DEV mode, which serves on `:5173` | Use `http://localhost:5173` instead |
| Node says `node:sqlite` is missing | Node older than 22.5 | Install Node 22.5+ and reopen VS Code |
| Port 8787 already in use | An earlier run is still up | Stop it (`Ctrl+C`), or change `PORT` in `.env` |

---

## 8. The one-line summary

Put your three AI keys and your Gmail app password into **`.env`** (or the in-app Settings
screen), set `CONNECTOR_NETWORK_ENABLED=true`, upload your CV, and press **Start hunt**.

To try it right now in VS Code: open the folder, run the task
**"Set up .env from the template"**, paste your keys, then press **F5** and pick
**"▶ Server, then open the browser"**. Run **"Tests (all 61)"** to confirm the install is
sound, and use **"══ DEV: server + hot-reloading UI ══"** when you are editing the interface.

Then move it to an always-on host so it keeps hunting with your laptop closed — the Fly.io
walkthrough is in [DEPLOY-FLY.md](DEPLOY-FLY.md).

It will search hard, tailor everything, and send every application that the destination
actually allows it to send. For the rest it hands you a finished package and a link.

**Developed by Lulamile Mkhungela.**
