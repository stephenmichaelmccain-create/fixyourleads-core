# FixYourLeads Project Status

Last updated: 2026-04-21

## Purpose

`fixyourleads-core` is the code-first core system for clinic lead intake,
outreach, messaging, and booking workflows.

## Current stack

- Next.js app/router app
- Prisma + Postgres
- Redis + BullMQ
- Telnyx for messaging
- Railway for app, worker, database, and Redis hosting

## Repo and deploy anchors

- Repo name: `fixyourleads-core`
- Local repo path: `~/.openclaw/workspace/fixyourleads-core`
- Primary Railway project: `adorable-commitment`
- Reported live app URL: `https://app-production-9ba1.up.railway.app`

## Read these files first

- `README.md`
- `docs/PROJECT_STATUS.md`
- `docs/MINIMUM_PRODUCTION_WORKFLOW.md`
- `docs/NEW_CHAT_PROMPT.md`
- `railway-worker.md`
- `package.json`

## Runtime contract

The app expects these env vars at runtime:

- `DATABASE_URL`
- `REDIS_URL`
- `TELNYX_API_KEY`
- `TELNYX_FROM_NUMBER`
- `APP_BASE_URL`
- `INTERNAL_API_KEY`

## Local bootstrap

Run this from the repo root:

```bash
npm run env:openclaw
```

That generates `.env.local` from existing OpenClaw secret files and currently
auto-loads:

- `TELNYX_API_KEY`
- `APP_BASE_URL` via `FYL_BASE_URL`
- `INTERNAL_API_KEY`

These are still expected to be filled separately for local runtime:

- `DATABASE_URL`
- `REDIS_URL`
- `TELNYX_FROM_NUMBER`

## Current confirmed live state

- Railway `app`, `worker`, `Postgres`, and `Redis` are online in the
  `adorable-commitment` production environment.
- The live app URL is reachable:
  `https://app-production-9ba1.up.railway.app`
- The diagnostics and health surfaces are up:
  - `/diagnostics`
  - `/api/health`
- The Railway runtime env contract is now present in production:
  - `DATABASE_URL`
  - `REDIS_URL`
  - `TELNYX_API_KEY`
  - `TELNYX_FROM_NUMBER`
  - `APP_BASE_URL`
  - `INTERNAL_API_KEY`
- The live Prisma schema has been pushed to the production database.
- A demo company exists in production:
  - `cmo90bu4q0000oicgg06ml53d`
  - `Fix Your Leads Demo`
- A sample lead, conversation, and event exist in production for smoke testing.
- The app now includes a `Companies` page to manage client records and
  notification emails in-app.
- Conversation detail pages now support manual outbound texts and booking from
  the UI.
- Lead intake now normalizes phone numbers and suppresses duplicate lead
  creation for the same company/contact.
- Booking email notifications are now supported through optional SMTP/Gmail-like
  env vars.
- The list pages were updated to force dynamic rendering so live data appears:
  - `/leads`
  - `/conversations`
  - `/events`
- GitHub should be treated as the stable backup and history source for repo-safe
  changes.

## Current product position

The product should stay narrow:

- source clinic leads
- avoid duplicate outreach
- contact leads by text and call
- handle inbound replies
- book appointments
- notify clients when appointments are booked

This should remain a code-first app. Codex helps build it, but the runtime
system should not depend on Codex or agents.

## Current likely bottlenecks

- inbound and outbound Telnyx flows still need a full real-world smoke test
- booking notification email still needs SMTP credentials configured
- worker behavior is online but not fully exercised with real jobs
- Google Maps lead sourcing is still not wired

## Minimum production focus

See `docs/MINIMUM_PRODUCTION_WORKFLOW.md`.

The next real build target is:

1. lead import and dedupe
2. first outbound SMS flow
3. inbound SMS webhook handling
4. booking creation
5. client notification email
6. voice workflow on top of the same records

## GitHub policy

- Prefer committing and pushing repo-safe updates promptly.
- Do not commit secrets, `.env.local`, or copied credential files.
- Leave unrelated local scratch files out of commits unless they are intentionally
  wired into the app.
