# FixYourLeads Project Status

2026-04-22: Simplified the live app around one vocabulary (`Clients`, `Leads`, `Messages`, `System Status`, `Activity Log`), tightened the home screen and client workspace UI, and cleaned up stale route/docs wording that was still leaking old labels like `Companies`, `Our Leads`, and `Diagnostics`.

Last updated: 2026-04-22

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
npm run env:bootstrap
```

That generates `.env.local` from existing local secret files and currently
auto-loads:

- `TELNYX_API_KEY`
- `APP_BASE_URL` via `FYL_BASE_URL`
- `INTERNAL_API_KEY`

These are still expected to be filled separately for local runtime:

- `DATABASE_URL`
- `REDIS_URL`
- `TELNYX_FROM_NUMBER`

## Current confirmed live state

- Primary navigation is now:
  - `Home`
  - `Clients`
  - `Leads`
  - `Messages`
- Utility/admin links are now:
  - `System Status`
  - `Activity Log`
- New primary routes:
  - `/`
  - `/clients`
  - `/clients/[id]`
  - `/leads`
  - `/messages`
- Legacy routes are compatibility redirects:
  - `/companies` -> `/clients`
  - `/our-leads` -> live prospecting surface reused by `/leads`
  - `/conversations` -> `/messages`
  - `/bookings` -> `/clients` or `/clients/[id]#bookings`
  - `/events` -> `/admin/activity`
  - `/diagnostics` -> `/admin/system`
- Railway `app`, `worker`, `Postgres`, and `Redis` are online in the
  `adorable-commitment` production environment.
- The live app URL is reachable:
  `https://app-production-9ba1.up.railway.app`
- The diagnostics and health surfaces are up:
  - `/admin/system`
  - `/admin/activity`
  - `/diagnostics/workflows`
  - `/api/health`
- The Railway runtime env contract is now present in production:
  - `DATABASE_URL`
  - `REDIS_URL`
  - `TELNYX_API_KEY`
  - `TELNYX_FROM_NUMBER`
  - `APP_BASE_URL`
  - `INTERNAL_API_KEY`
- The live Prisma schema has been pushed to the production database.
- The app now includes a real `Clients` surface and a simplified client workspace page.
- Company workspaces now track inbound routing readiness in-app through each
  company's Telnyx inbound number.
- The client workspace now centers the lead table, message rail, appointments,
  and profile editing without the earlier control-room clutter.
- The app now includes a `Leads` prospecting surface for the FixYourLeads sales
  pipeline, backed by `prospects` and `call_logs`.
- Conversation detail pages now support manual outbound texts and booking from
  the UI.
- Lead intake now normalizes phone numbers and suppresses duplicate lead
  creation for the same company/contact.
- Google Maps lead import is now wired through the internal lead intake path
  with dedupe-aware import behavior.
- Booking email notifications are now supported through optional SMTP/Gmail-like
  env vars.
- The health surface is now suitable for Railway healthchecks:
  - `/api/health` returns `503` when required runtime checks fail
  - deployment metadata and observability readiness are exposed on
    `/admin/system`
- System Status no longer treats OpenClaw or MCP wiring as part of app readiness.
- Structured runtime error logs are now emitted from the app server on boot,
  unhandled promise rejections, and uncaught exceptions.
- Sentry is still optional. The app can run without it, but System Status now
  shows clearly whether a DSN is configured.
- The list pages were updated to force dynamic rendering so live data appears.
- Internal-only debug routes that were not part of operator work were removed.
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

- inbound and outbound Telnyx flows still need full live end-to-end validation
- booking notification email still needs SMTP credentials configured
- worker behavior is online but not fully exercised with real jobs
- Sentry is prepared as an optional next step, but no DSN is configured yet

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
