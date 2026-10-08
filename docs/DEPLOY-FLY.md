# Deploying to Fly.io

**AI Job Hunter** — developed by [Lulamile Mkhungela](https://github.com/LulamileMkhungela).

Fly runs the whole app — API, database and the scheduler that keeps hunting while your
laptop is closed — on one always-on machine with a persistent disk. This is the deployment
this project is shaped for: one process, one origin, no CORS, no external services.

Roughly **$3–6 per month** for a shared-cpu-1x machine plus a 1 GB volume. Fly gives new
organisations trial credit; it is not permanently free.

---

## Why not GitHub Pages

GitHub Pages serves **static files only**. It cannot run this application:

| The app needs | Pages provides |
| --- | --- |
| Node.js API server | Static HTML/CSS/JS |
| SQLite database | No runtime, no storage |
| A scheduler that hunts continuously | No background processes |
| SMTP for sending applications | No outbound connections |

The UI is built to talk to its own origin (`/api/...`, `credentials: 'same-origin'`), and
the Node server serves it from `client/dist`. On Pages every API call would 404, and the
scheduler — the entire point of the product — would not exist. Pages is a fine place for
**documentation**; it is not a place for this app.

---

## 1. Install the Fly CLI

```bash
# macOS / Linux
curl -L https://fly.io/install.sh | sh

# Windows (PowerShell)
pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

```bash
fly auth login      # or: fly auth signup
```

## 2. Give the app its own name

Fly app names are **global**, so `ai-job-hunter` is almost certainly taken. Pick something
unique and set it in `fly.toml`:

```toml
app = "ai-job-hunter-yourname"
```

You can also let Fly generate one with `fly launch --no-deploy --copy-config`, which
rewrites `fly.toml` for you.

## 3. Create the app and the disk

```bash
fly apps create ai-job-hunter-yourname

# Johannesburg, closest to South Africa. Use a region near you otherwise:
#   lhr (London) · fra (Frankfurt) · iad (Virginia) · sjc (California) · syd (Sydney)
fly volumes create ajh_data --region jnb --size 1
```

The volume holds the SQLite database, your uploaded CV and every generated document. It
survives deploys — without it, your history is wiped on every push.

## 4. Set your secrets

Everything sensitive goes in as a secret, never into `fly.toml` (which is committed to git).

```bash
fly secrets set \
  JWT_SECRET="$(openssl rand -hex 48)" \
  SMTP_HOST=smtp.gmail.com \
  SMTP_PORT=465 \
  SMTP_SECURE=true \
  SMTP_USER=you@gmail.com \
  SMTP_PASS="your 16 character app password" \
  SMTP_FROM="Your Name <you@gmail.com>" \
  LLM_PROVIDER=google \
  LLM_API_KEY="your google key" \
  LLM_MODEL=gemini-2.5-pro \
  LLM_PROVIDER_2=groq \
  LLM_API_KEY_2="your groq key" \
  LLM_MODEL_2=llama-3.3-70b-versatile \
  LLM_PROVIDER_3=cerebras \
  LLM_API_KEY_3="your cerebras key" \
  LLM_MODEL_3=llama-3.3-70b
```

> `fly secrets set` restarts the machine, which is harmless — the scheduler resumes from
> the database.

You can skip the email and AI secrets and enter them in the app instead
(**Settings → Email & AI**), where they are encrypted in the database. Secrets set here are
the fallback for accounts that have not saved their own.

## 5. Deploy

```bash
fly deploy
```

The first deploy builds the UI in the container, so expect a few minutes. When it finishes:

```bash
fly scale count 1     # exactly one machine — see the warning below
fly open              # opens https://your-app.fly.dev
```

### One machine, always

The scheduler is durable and the database is SQLite on a single volume. **Two machines
would run the same hunt twice, hit the same boards twice, and fight over the same file.**
Keep `fly scale count 1`.

`fly.toml` also disables Fly's autostop:

```toml
auto_stop_machines = "off"
```

This matters more than it looks. Fly's autostop is driven by **connection** idle time —
background work does not count as activity. With autostop on, your machine would be shut
down whenever nobody had the dashboard open, and the hunt would silently stop. Leave it off.

## 6. Create your account, then close registration

`fly.toml` ships with `ALLOW_REGISTRATION = "true"` so you can sign up. Do that now:

1. Open `https://your-app.fly.dev`
2. Register with your email and a strong password
3. Upload your CV
4. Add your email account and AI keys under **Settings → Email & AI**
5. Open **Job sources** — your account starts with 29 real boards, so the first hunt reaches
   employers instead of searching nothing. Press **Verify saved list** to re-check them from
   this host and prune whatever has gone dead

You choose that password here — nothing is pre-set on a fresh instance, and there is no demo
account unless you deliberately enable demo sign-in. (The demo workspace you may have seen
locally exists only because the development environment seeds it.)

If you would rather keep the account you already use locally, skip this and copy your
database up instead — see [Moving your existing data](#coming-from-your-laptop-moving-your-existing-data).
The account, its password and your history all travel with it.

Then lock it down — edit `fly.toml`:

```toml
ALLOW_REGISTRATION = "false"
```

and redeploy:

```bash
fly deploy
```

## 7. Confirm it is healthy

```bash
fly status                      # machine should be "running", not "stopped"
fly logs                        # watch a hunt happen
curl https://your-app.fly.dev/api/health
```

In the app: **Dashboard → Start hunt**. Close the browser, wait, come back — the dashboard
will have moved. That is the scheduler running on Fly rather than in your browser tab.

---

## Coming from your laptop: moving your existing data

This is optional. A new account is already seeded with the default boards, so you only need
this to carry over your application history, your CV and any boards you added yourself.

If you have been running it locally and want to keep your history, copy the database up:

```bash
# from your machine, with the app deployed
fly ssh sftp shell
# then, in the sftp prompt:
put data/jobhunter.db /data/jobhunter.db
exit

fly apps restart ai-job-hunter-yourname
```

Take a copy of `data/` before you do this — the upload replaces the remote database.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Error: app name is already taken` | Fly names are global — choose another in `fly.toml` |
| Machine keeps stopping | `auto_stop_machines` must be `"off"`, and `fly scale count 1` |
| Data disappears after a deploy | The volume is not mounted — check `[mounts]` and `fly volumes list` |
| `no space left on device` | `fly volumes extend <id> --size 2` |
| Deploy fails during `npm ci` | The lockfile drifted from `package.json`; run `npm install` locally and commit the lock |
| Out of memory while parsing a large CV | `fly scale memory 1024` |
| Board tokens all 404 from the app | `CONNECTOR_NETWORK_ENABLED` must be `"true"`; it is in `fly.toml` `[env]` |
| Emails fail with "invalid login" | Gmail needs an app password, not your account password |
| Locked out — password lost | There is deliberately no in-app password reset. The image ships the operator tool: `fly ssh console -C "node tools/set-password.js you@example.com 'a new password'"` (it also signs out existing sessions) |

## Automatic deploys

`.github/workflows/deploy.yml` runs the 61 tests on every push, and deploys to Fly when
`main` moves. Create a deploy token once:

```bash
fly tokens create deploy -x 999999h
gh secret set FLY_API_TOKEN --body "<the token>"
```

Until that secret exists the deploy job skips itself with an explanation, so tests still
run.

## Updating

```bash
git pull
fly deploy
```

Or merge to `main` and let the workflow do it. Either way the volume, your database and
your settings are untouched.
