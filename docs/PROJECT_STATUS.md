# FixYourLeads Project Status

2026-04-25: Client workspace now centers around five operator tabs (`Client profile`, `CRM`, `Comms Lab`, `Telnyx Setup`, `Booking`), includes a lightweight client-facing status page with signed links, and ships review automation from completed appointment webhook through delayed SMS follow-up and owner escalation.

Last updated: 2026-04-25

## Purpose

`fixyourleads-core` is the code-first core system for clinic lead intake,
outreach, messaging, and booking workflows.

## Current stack

- Next.js app/router app
- Prisma + Postgres
- Redis + BullMQ
- Telnyx for messaging and voice execution
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

Recommended for signed client view links:

- `CLIENT_VIEW_SECRET`

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
- The app now includes a real `Clients` surface and a simplified five-tab client workspace:
  - `Client profile`
  - `CRM`
  - `Comms Lab`
  - `Telnyx Setup`
  - `Booking`
- Company workspaces now track inbound routing readiness in-app through each
  company's Telnyx inbound number.
- Client workspaces now split onboarding, records, testing, carrier setup, and booking into separate focused surfaces instead of the earlier mixed dashboard.
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
- Review automation is now implemented:
  - completed appointments can hit `/api/webhooks/reviews/[clientId]`
  - the app queues delayed review requests through BullMQ
  - inbound `1-10` score replies branch to Google review follow-up or private recovery
  - operator test controls exist on the Booking tab
- A simple client-facing status page now exists at `/c/[id]`, intended to be shared through signed links.
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

## Architecture boundary

Telnyx should own the communications execution layer:

- outbound SMS and call delivery
- inbound telecom events
- messaging profiles, routing numbers, and scheduling features
- compliance, number behavior, and voice runtime

The app should own the workflow layer:

- clinic, contact, and conversation source of truth
- dedupe and suppression
- workflow ownership and booking state
- operator UI, history, diagnostics, and reporting

## Current likely bottlenecks

- inbound and outbound Telnyx flows still need full live end-to-end validation on a real approved 10DLC client number
- Google Calendar OAuth and real booking writeback are not implemented yet
- booking notification email still needs SMTP credentials configured
- client-facing `/c/[id]` links now require signed tokens, but there is still no client login or magic-link auth layer
- worker behavior is online but still needs a full production smoke test across lead -> reply -> booking -> review flow
- Sentry is prepared as an optional next step, but no DSN is configured yet
- native Telnyx features need to be integrated intentionally so we do not rebuild scheduling or runtime behavior unnecessarily

## Minimum production focus

See `docs/MINIMUM_PRODUCTION_WORKFLOW.md`.

The next real build target is:

1. real approved client number plus successful outbound/inbound Telnyx validation
2. Google Calendar OAuth and booking writeback
3. SMTP-backed booking notification email in production
4. one full end-to-end production smoke test:
   - lead comes in
   - SMS sends
   - reply is captured
   - booking is created
   - review automation can fire after completion
5. voice workflow on top of the same records through Telnyx

## GitHub policy

- Prefer committing and pushing repo-safe updates promptly.
- Do not commit secrets, `.env.local`, or copied credential files.
- Leave unrelated local scratch files out of commits unless they are intentionally
  wired into the app.
