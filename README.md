# cup-bots

`cup-bots` is a personal Node.js automation project that watches protected forum pages, detects high-signal updates in near real time, sends multi-channel alerts, and can trigger best-effort Google Form auto-submission.

It started as a focused tool for forum monitoring, then evolved into a small event-driven pipeline with stronger reliability, observability, and testability.

---

## What it does

- Monitors target forum pages that require authentication.
- Detects new top messages and newly discovered topics.
- Extracts metadata from forum HTML (title, subforum, timestamp, content).
- Detects Google Forms links (`forms.gle` and `docs.google.com/forms`).
- Sends alerts to Discord and/or ntfy.
- Optionally auto-submits forms when business conditions match a whitelist.

---

## Tech stack

- Node.js (ESM, `.mjs`)
- `node-fetch` for HTTP
- `cheerio` for HTML parsing
- `dotenv` + custom env loader for runtime config
- Jest (ESM) for unit tests

---

## Project layout

```text
cup-bots-public/
  launcher/
    watch_top_message.mjs            # Main v2 launcher (top message watcher)
    v1/
      launch_watcher_dep_*.mjs       # Legacy section watchers
      launch_resale_psglens.mjs      # Legacy resale pipeline launcher

  main/
    scraper.mjs                      # v2 core: auth, scraping, analysis, detection, auto-submit
    v1/
      cookies.mjs                    # Legacy cookie auth
      scraper.mjs                    # Legacy scraper
      topic_watcher.mjs              # Legacy topic watcher
      processor.mjs                  # Legacy message scoring pipeline
      notification_sender.mjs        # Discord + ntfy sender
      safety_heartbeat.mjs           # Safety heartbeat

  scripts/
    test_auto_submit.mjs             # Manual runner for form submission checks

  test/
    *.test.mjs                       # Unit tests
```

---

## Core features

### 1) Resilient authenticated scraping (`main/scraper.mjs`)

- Reuses persisted cookies from `COOKIE_FILE` (default: `.session_cookies.txt`).
- Detects auth loss via redirect + HTML markers.
- Re-authenticates automatically with `FORUM_USER` / `FORUM_PASS`.
- Normalizes `Set-Cookie` headers into a safe reusable `Cookie` header.
- Retries with delay and explicit fatal exit for supervisor-friendly behavior.

### 2) Forum HTML analysis

- Extracts the top message from phpBB-like structures (with fallback selectors).
- Removes nested blockquotes to reduce quote-related false positives.
- Captures useful metadata: timestamp, subforum name, topic title.
- Detects Google Forms URLs in both raw HTML and extracted text.

### 3) Google Form auto-submission (best effort)

- Resolves submit endpoint (`viewform` -> `formResponse`).
- Finds dynamic `entry.*` fields from the live DOM.
- Includes fallback parsing of `FB_PUBLIC_LOAD_DATA_` when needed.
- Maps common FR labels (`nom`, `prenom`, `mail`, `numero`) to env values.
- Supports manual payload enrichment via `FORM_PAYLOAD_JSON`.

### 4) Event-driven top message watcher (`launcher/watch_top_message.mjs`)

- Polls target URL on interval (`SCRAPE_INTERVAL_MS`).
- Detects novelty using content hash + timestamp comparison.
- Parses multiple timestamp formats (including French phpBB patterns).
- Routes notifications per subforum.
- Enables auto-submit only when title matches whitelist rules.
- Supports local HTML debug mode (`HTML_PAGE_DEBUG`).

### 5) Legacy v1 pipeline (still usable)

- Section-level topic watcher (`main/v1/topic_watcher.mjs`).
- Legacy resale detection with optional OpenAI scoring (`main/v1/processor.mjs`).
- Safety heartbeat (`main/v1/safety_heartbeat.mjs`).

The `v1` + `v2` split reflects an incremental evolution path: keep stable flows running while improving the architecture.

---

## How it works at runtime

1. Launcher boots and loads env values.
2. Safety heartbeat starts (optional webhook).
3. Scraper fetches target page with stored cookies.
4. If auth is stale, scraper logs in again and persists fresh cookies.
5. Analyzer extracts top message + metadata.
6. Watcher compares with previous state (hash + timestamp).
7. If new signal is detected, notifications are sent.
8. If whitelist + config allow it, form auto-submission is attempted.

---

## Installation

Requirements:

- Node.js 18+
- npm

Install:

```bash
npm install
```

---

## Configuration (`.env`)

Example (adapt to your context):

```env
# --- Forum auth ---
BASE_FORUM_URL=https://forum.example.com/
FORUM_USER=my_user
FORUM_PASS=my_password
COOKIE_FILE=.session_cookies.txt

# --- Main v2 watcher ---
TARGET_URL=https://forum.example.com/search.php?keywords=...
SCRAPE_INTERVAL_MS=150000
BOT_NAME=watch_top_message
USE_AUTO_SUBMISSION=true
HTML_PAGE_DEBUG=false

# Whitelist JSON keyed by exact subforum name
WHITEWORDS='{"Matchs / Deplacements - Equipe premiere": ["Lorient", "Marseille"]}'

# --- Auto-submit identity values ---
FORM_NOM=Doe
FORM_PRENOM=John
FORM_MAIL=john.doe@example.com
FORM_NUMERO=0600000000

# Optional manual form entries
FORM_PAYLOAD_JSON={"entry.123456":"custom value"}

# --- Notification routing ---
PSG_A_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
PSG_A_NTFY_URL=https://ntfy.sh/topic-a

PSG_F_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
PSG_F_NTFY_URL=https://ntfy.sh/topic-f

PSG_H_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
PSG_H_NTFY_URL=https://ntfy.sh/topic-h

DEBUG_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
DEBUG_NTFY_URL=https://ntfy.sh/topic-debug

# Optional generic channels
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
NTFY_URL=https://ntfy.sh/topic-generic
DISCORD_SAFETY_WEBHOOK_URL=https://discord.com/api/webhooks/...

# --- Optional legacy v1 vars ---
OPENAI_API_KEY=sk-...
FORUM_URL_DEP_FOOT_A=https://forum.example.com/viewforum.php?f=1
FORUM_URL_DEP_FOOT_FEMININES=https://forum.example.com/viewforum.php?f=2
FORUM_URL_DEP_HAND=https://forum.example.com/viewforum.php?f=3
DEP_FOOT_A_WEBHOOK_URL=https://discord.com/api/webhooks/...
DEP_FOOT_A_NTFY_URL=https://ntfy.sh/dep-a
DEP_FOOT_FEMININES_WEBHOOK_URL=https://discord.com/api/webhooks/...
DEP_FOOT_FEMININES_NTFY_URL=https://ntfy.sh/dep-f
DEP_HAND_WEBHOOK_URL=https://discord.com/api/webhooks/...
DEP_HAND_NTFY_URL=https://ntfy.sh/dep-h
RESALE_PSGLENS_BASE_FORUM_URL=https://forum.example.com/search.php?keywords=psg+lens
RESALE_PSGLENS_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

Security notes:

- Never commit `.env` or `.session_cookies.txt`.
- Use dedicated service credentials when possible.
- Keep webhook scopes minimal.

---

## Run

Main watcher (v2):

```bash
npm run watch-top
```

Auto-submit test runner:

```bash
npm run test:auto-submit -- "https://docs.google.com/forms/d/e/.../viewform"
```

or:

```bash
FORMS_URLS="https://forms.gle/abc,https://docs.google.com/forms/d/e/.../viewform" npm run test:auto-submit
```

Legacy v1 launcher example:

```bash
node launcher/v1/launch_watcher_dep_foot_a.mjs
```

---

## Tests

Run the test suite:

```bash
npm test
```

Current tests cover:

- login-page detection
- cookie header normalization
- top-message extraction
- Google Forms detection
- helper logic (hash, date parsing, whitelist matching)
- auto-submit behavior with mocked fetch

---

## Design choices

- **Hash + timestamp gating**: reduces noisy triggers from edits/deletions.
- **Dual auth-loss detection**: redirect and HTML-content checks.
- **Graceful fallbacks**: selector fallbacks for forum and form parsing.
- **Operational visibility**: explicit logs + safety heartbeat channel.
- **Test-friendly modules**: pure helper exports for deterministic unit tests.

---

## Known limitations

- Heavily dependent on forum HTML structure (phpBB-like assumptions).
- Google Forms are heterogeneous; some require explicit `FORM_PAYLOAD_JSON`.
- In-memory state tracking for novelty detection (no persistent event store yet).
- Loop-based workers only (no external queue/orchestration layer).

---

## Roadmap ideas

- Persistent state backend (SQLite/Redis).
- Dry-run mode + richer metrics.
- Smarter retry strategy (exponential backoff + jitter).
- Docker image + health endpoint.
- CI pipeline (tests + lint + release automation).

---

## Changelog

See `CHANGELOG.md`.

---

## Author

Maintained by **Loris Henry**.
