# Setup and deployment

**AI Job Hunter** — developed by [Lulamile Mkhungela](https://github.com/LulamileMkhungela).

---

## 1. Requirements

* **Node.js 22.5 or newer** (the database uses the built-in `node:sqlite` module; if you
  prefer, `better-sqlite3` is an optional dependency and is used automatically when it
  compiles).
* ~200 MB of disk for the app, plus whatever your CVs, exports and database need.
* No database server, no external service and no API key is required to run. LLM and SMTP
  are optional enhancements.

## 2. Install and run locally

```bash
git clone https://github.com/LulamileMkhungela/i-Apply.git
cd i-Apply
npm install                       # installs the server and client workspaces
npm run build                     # builds the React client into client/dist
cp .env.example .env              # optional
npm start                         # http://localhost:8787
```

`npm run dev:server` restarts the API on change; `npm run dev:client` runs Vite on port
5173 with `/api` proxied to the server (useful while working on the UI).

Databases are created on first boot at `DATA_DIR` (default `./data`):

```
data/jobhunter.db      SQLite database (WAL)
data/uploads/          uploaded CVs, one directory per user
data/exports/          generated tailored CVs, cover letters and answer sheets
data/.app-secret       generated session-signing key (only if JWT_SECRET is unset)
```

To start over, stop the server and delete `data/`. **Do not delete `data/` while the
server is running** — the running process keeps writing to the deleted file, and (if you
rely on the generated secret) every signed-in session becomes invalid.

## 3. Configuration

Copy `.env.example` to `.env` and adjust. The essentials:

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` enables secure cookies and hides demo affordances |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | |
| `DATA_DIR` | `./data` | Put this on a backed-up volume |
| `JWT_SECRET` | auto-generated | **Set this explicitly in production** (`openssl rand -hex 48`) |
| `SCHEDULER_ENABLED` | `true` | `false` = API only, run `npm run worker` separately |
| `SCHEDULER_TICK_MS` | `15000` | How often due campaigns are checked |
| `CONNECTOR_NETWORK_ENABLED` | `true` | `false` for air-gapped/sandboxed hosts |
| `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` | `none` | Optional prose polish only |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | unset | Email applications and email notifications |
| `ALLOW_REGISTRATION` | `true` | Set `false` on a private instance |
| `EMBED_ORIGINS` / `ALLOW_EMBEDDING` | dev: allowed, prod: same-origin only | Which origins may embed the app in a frame |
| `COOKIE_SAMESITE` | auto (`none` when embedded over HTTPS, else `lax`) | Cookie policy for the session; override if the proxy hides the scheme |
| `SECURE_COOKIES` | `false` | `true` behind HTTPS |
| `AUTO_SEED_DEMO` | `true` (non-production) | Creates the demo account on an empty database |
| `ALLOW_DEMO_LOGIN` | `true` (non-production) | The “Explore with demo data” button |

## 4. Deployment: an always-on host

The point of the scheduler is that your laptop can be closed. Any always-on host works — a
small VPS, Fly.io, Railway, Render, a Raspberry Pi, a home server.

**Deploying to Fly.io has its own walkthrough: [DEPLOY-FLY.md](DEPLOY-FLY.md)** — CLI
install, app and volume creation, secrets, the health check, and the autostop setting that
must stay `off` so the scheduler is never shut down mid-hunt. A container is included
(`Dockerfile`), and `.github/workflows/deploy.yml` deploys on every push to `main` once you
add a `FLY_API_TOKEN` secret.

```bash
# on the host
git clone https://github.com/LulamileMkhungela/i-Apply.git /opt/ai-job-hunter
cd /opt/ai-job-hunter
npm ci --omit=dev
npm run build
cp .env.example .env   # set NODE_ENV=production, JWT_SECRET, DATA_DIR, SMTP if you have it
npm start
```

### systemd (single process)

```ini
# /etc/systemd/system/ai-job-hunter.service
[Unit]
Description=AI Job Hunter
After=network.target

[Service]
Type=simple
User=jobhunter
WorkingDirectory=/opt/ai-job-hunter
EnvironmentFile=/opt/ai-job-hunter/.env
ExecStart=/usr/bin/node server/src/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now ai-job-hunter
```

### systemd (split API and worker)

Run the web process with `SCHEDULER_ENABLED=false` and add a second unit:

```ini
# /etc/systemd/system/ai-job-hunter-worker.service
[Unit]
Description=AI Job Hunter scheduler worker
After=network.target

[Service]
Type=simple
User=jobhunter
WorkingDirectory=/opt/ai-job-hunter
EnvironmentFile=/opt/ai-job-hunter/.env
ExecStart=/usr/bin/node server/src/worker.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Reverse proxy

Terminate TLS in front of the app (nginx/Caddy) and forward to `127.0.0.1:8787`, then set
`SECURE_COOKIES=true`. The server already sends a strict Content-Security-Policy and
other hardening headers.

### Backups

Everything that matters is in `DATA_DIR`:

```bash
sqlite3 data/jobhunter.db ".backup '/backups/jobhunter-$(date +%F).db'"
tar czf /backups/uploads-$(date +%F).tar.gz data/uploads data/exports
```

## 5. Email applications (optional)

Some adverts ask you to email your CV. To let the agent send those, point SMTP at your own
mail account:

```env
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=you@example.com
SMTP_PASS=app-password
SMTP_FROM="Your Name <you@example.com>"
```

Without SMTP the app prepares the application and tells you to send it yourself, with a
pre-filled `mailto:` link and the documents attached to the record — it never claims an
email was sent when it was not.

For local development, `node tools/smtp-sink.js 2525` is a throwaway SMTP server that
writes received messages to `data/outbox/*.eml`, so the email path can be exercised
without a real mailbox. Do not use it in production.

## 6. Job sources

* **Greenhouse / Lever / Workable / SmartRecruiters** — add the employer's board token(s)
  under *Job sources*. Reads use the published public APIs.
* **Remotive / Arbeitnow / Remote OK / RSS** — work out of the box; add feed URLs for RSS.
* **Paste a job link** — the compliant path for sources whose terms restrict automated
  access (LinkedIn, Indeed, Glassdoor, PNet, Careers24, Wellfound). You supply the link;
  the app fetches that single page, parses it, scores it and prepares the application.
* **CSV / JSON import** — bring your own vacancy list.
* **Workday / company career pages** — per-tenant; the app states what it needs.
* **LinkedIn** — assisted only. The connector has no automation path by design; it will
  stay that way unless an approved partnership grants API access.

With `CONNECTOR_NETWORK_ENABLED=false` (or on a host with no internet) the UI says so
plainly and the demo dataset is used for exploration.

## 7. Health and troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `EADDRINUSE` on start | Another instance is running (`pgrep -f server/src/index.js`), or change `PORT` |
| Signed in, then “Not authenticated” | The browser dropped the session cookie (third-party frame) — the app falls back to a bearer token automatically; make sure you are on the current build, and avoid deleting `data/` while logged in |
| `database is locked` | Two processes writing the same file with an old SQLite build; update Node and check no other instance shares `DATA_DIR` |
| Live search returns nothing | `CONNECTOR_NETWORK_ENABLED=false`, no internet, or no connector configured — the UI names the reason |
| Documents missing | PDF rendering failed; the application timeline shows the reason and the text is still on the record |
| `ExperimentalWarning: SQLite` | Expected with `node:sqlite`; harmless |
| `502 Bad Gateway` on some API calls | Usually the proxy reusing a connection that the origin just closed: this app raises `keepAliveTimeout` to 76 s for exactly that reason. Also check you are opening the app's own preview (the dev SMTP sink is a raw socket and answers HTTP with a 502) |
| App looks out of date after a deploy | It detects a stale bundle via `/api/version` and reloads itself once; a hard reload also clears it |

`GET /api/health` is a cheap liveness probe for a load balancer or uptime monitor.
