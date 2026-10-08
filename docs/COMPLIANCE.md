# Compliance and honesty rules

**AI Job Hunter** — developed by [Lulamile Mkhungela](https://github.com/LulamileMkhungela).

This project exists to save you time, not to break rules on your behalf. The constraints
below are enforced in code, not just documented — each one names where it lives.

---

## 1. Never automate LinkedIn activity

LinkedIn's User Agreement (§8.2, "Dos and Don'ts") prohibits bots, scrapers and automated
activity on the platform. Automating it risks your account, and it is not necessary for the
product to work.

* There is **no code path that automates LinkedIn**: no scraping, no auto-login, no
  auto-apply, no session reuse.
* LinkedIn appears as a first-class source via permitted mechanisms only:
  a guided search you run yourself, pasting a vacancy link for scoring and preparation,
  and a gate that stays closed until an approved LinkedIn partnership is supplied.
* `connectors/guides.js` + `connectors/index.js` mark LinkedIn's `automatedSearch` and
  `automatedApply` as **prohibited**, with the basis shown in the Sources screen.
* If LinkedIn ever grants you API access, the connector interface is already there — supply
  the credentials and the capability flips to what your agreement permits. Nothing else
  changes.

The same treatment applies to Indeed, Glassdoor and other boards whose terms restrict
automated access: assisted handoff, never a bot.

---

## 2. Never bypass a control

Not implemented, and not to be added:

* CAPTCHA solving or relay services
* MFA/2FA circumvention, session hijacking or cookie replay
* Bot-detection evasion, fingerprint spoofing or headless-browser stealth
* Scraper-blocking circumvention, IP rotation or rate-limit dodging
* Accessing anything behind a login, paywall or access control you do not own

When a run reaches something only a human may do — a CAPTCHA, an MFA prompt, an expired
login, a site that blocks automation — the agent **pauses and notifies you** with what to
do next. It does not try harder. Notifications cover CAPTCHA/MFA challenges, login expiry
and blocked automation (`services/notifications.js`).

Rate limiting is respected in the other direction too: connectors batch requests, keep
pages small (`CONNECTOR_PAGE_LIMIT`) and use polite timeouts (`CONNECTOR_TIMEOUT_MS`).

---

## 3. Never invent anything about you

Generated material — cover letters, tailored CV summaries, screening answers — may contain
only facts your CV supports: employers, job titles, dates, years of experience,
technologies, certifications, education, languages and achievements.

* `services/truthGuard.js` validates every generated string against the CV's extracted
  facts and removes unsupported claims.
* `services/profileBuilder.js` records the CV text each value came from, so the guard has
  evidence to check against.
* The only proper nouns allowed beyond your CV are the employer and role you are applying
  to.
* A question the CV cannot answer (salary expectation, notice period, work authorisation)
  is left blank and flagged for you — never guessed.

---

## 4. Never claim an application that did not happen

An application is marked **Applied** only when the destination confirmed it, and the record
stores the confirmation source:

| Route | Confirmation |
| --- | --- |
| ATS/Opportunity API | the API's response (status, ids) |
| Email application | your mail server's acceptance (`messageId`, recipients) |
| You submitted it yourself | `user_asserted` — clearly labelled in the UI |

Demo listings are labelled sample data and are never submitted anywhere; the submit
endpoint answers with `requires_human` and an explanation. If SMTP is not configured, email
applications are prepared and handed to you instead of being reported as sent.

---

## 5. Never apply twice

Unless you explicitly enable reapplication, the following are refused — at preparation time
**and again at submission time** (`jobPipeline.checkEligibility()` and
`submitApplication()`):

* the same posting (dedupe key / job ID), and
* the same company + role.

Applications you skipped, failed or withdrew do not block a retry; a submitted, confirmed
or interview-stage application does.

---

## 6. Never apply to a scam

`services/scamDetector.js` screens every listing for:

* requests for money (registration, training, equipment, "deposits")
* upfront-payment and pay-to-work phrasing
* crypto-only payment or salary routes
* fake recruitment patterns and free-mail recruiters for corporate roles
* requests for sensitive information (ID, bank details, passport) before hiring
* suspicious redirects and look-alike domains
* unrealistically high earnings with no experience required

Each signal carries a severity and the exact text that triggered it. High-risk listings are
**never** applied to: they are skipped at scoring, skipped again if you press prepare, and
blocked a third time if a submit is attempted. Legitimate employers in crypto or fintech are
not penalised for their industry — the checks look at payment behaviour and recruitment
patterns, not at sector vocabulary.

---

## 7. Be honest about what is not wired up

Where a real integration needs something you have not supplied — API keys, board tokens,
SMTP credentials, an approved partnership, tenant consent — the app:

1. shows the connector as **needs configuration**,
2. lists exactly which credentials are missing,
3. explains the compliance basis for what it may and may not do, and
4. keeps the interface ready for when you supply them.

It does not fabricate results, invent vacancies, or simulate a successful application. The
capability panel (`GET /api/system/capabilities`) is the single source of truth the UI uses
for these statements.

---

## 8. Your data

* CVs are stored under your own directory (`DATA_DIR/uploads/user-<id>/`) and are never
  shared between accounts.
* Connector credentials are encrypted at rest and returned masked.
* `GET /api/auth/export` gives you everything as JSON.
* `POST /api/auth/delete` removes your CV, parsed profile, history or the whole account,
  including the files on disk.
* Sessions are signed, revocable (token version) and expire (`SESSION_TTL_DAYS`).


---

## 9. Board tokens are verified, never scraped

A list of board tokens (Greenhouse, Lever, Workable, SmartRecruiters) is checked against
each platform's **own public read API**. That is the same call the connector makes when it
searches, so a token is "live" precisely when the platform says it has postings.

There is deliberately **no scraper for search-engine results**. Harvesting board tokens by
automating Google (as an earlier draft script did) is the exact thing rule 2 forbids:
it defeats a site's anti-bot measures and breaches its terms. Instead:

- you paste the token list you already have, or type the ones you want;
- `verify-boards` tells you which are real, with the number of open roles;
- `prune` deletes the ones that came back empty;
- the connector then reads each live board through the documented API.

The same reasoning applies to the `google.com/...` URL pattern some scripts use: no such
request is ever made by this application.

## 10. Greenhouse: honest about an employer-only key

`POST https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{id}` requires HTTP Basic
authentication with a **Job Board API key that the hiring company creates in its own
Greenhouse account** (Configure → Dev Center → API Credentials). A candidate cannot obtain
one, so:

- the source reports `autoApply: false` and `automatedApply: requires_employer_credentials`
  until such a key is supplied;
- a prepared application is handed to you with the posting link instead;
- if you do hold a key (for example you run that board), you can enter it under the source
  and submission becomes genuinely automatic.

The earlier revision posted to that endpoint without credentials. It would have been
rejected by Greenhouse every time, so it was replaced rather than left looking functional.

---

## 11. AI providers: optional, validated, and never trusted

Several AI providers can be configured (see the free options in Settings → Email & AI).
They are used only to improve wording. Whatever a model returns is passed through the
truth guard before it reaches a document, so a model cannot introduce an employer, a
qualification, a certification, a tool or a year of experience that is not in the CV.

If no provider is configured — or every one fails or is rate-limited — the app falls back
to its deterministic engine and carries on. Nothing about the hunt depends on a model.

Keys are stored encrypted with AES-256-GCM and are never returned to the browser.

## 12. Email: your account, the advert's own mechanism

Applications are sent by email only where the advert asks for that ("send your CV to
careers@…"). The message goes out through the user's own mail account over SMTP; the mail
server's acceptance (`messageId`, accepted recipients) is stored as the confirmation, and
a record is only marked Applied on that basis. If no mail account is connected the
application is prepared and handed over instead — never reported as sent.
