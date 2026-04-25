# FixYourLeads Core

Production application for clinic lead intake, workflow orchestration, messaging, and booking.

## Product model

This app runs two connected pipelines:

- `Leads`: outbound prospecting for clinics we want to sell. These records are imported in bulk, called first, and moved through outcomes like no answer, booked, sold, or do not contact.
- `Clients`: sold or onboarded clinics we actively serve. These workspaces hold conversations, bookings, routing numbers, and setup state.

The bridge between them is `/clients/intake`:

- sold prospects from `Leads` land there
- direct website signups also land there
- onboarding submissions enrich or match an existing client workspace

Core runtime flow:

1. lead or signup reaches the app through a webhook or internal create route
2. Prisma writes the source-of-truth records in Postgres
3. BullMQ workers pick up slow or async work like lead processing and message handling
4. operators work mostly from `/leads`, `/clients`, `/clients/[id]`, and `/messages`
5. Telnyx executes messaging and calling, while the app decides workflow state and `System Status` plus `Activity Log` show the live operational truth

## Execution boundary

Use Telnyx for the communications layer:

- message and call execution
- delivery and inbound events
- number routing and messaging profiles
- telecom compliance and scheduling features

Use this app for the workflow layer:

- contact and clinic source of truth
- dedupe and suppression
- workflow ownership and booking state
- operator controls, history, and reporting

## Start here
- `docs/PROJECT_STATUS.md` for the current handoff and deploy state
- `docs/MINIMUM_PRODUCTION_WORKFLOW.md` for the narrow product target
- `docs/NEW_CHAT_PROMPT.md` for a paste-ready fresh-chat brief

## Stack
- Next.js
- Postgres + Prisma
- Redis + BullMQ
- Telnyx for communications execution
- SMTP/Gmail-compatible booking notifications

## Required env
- DATABASE_URL
- REDIS_URL
- TELNYX_API_KEY
- TELNYX_FROM_NUMBER
- APP_BASE_URL
- INTERNAL_API_KEY

## Optional env

These are only needed for client booking notification emails:

- SMTP_USER
- SMTP_PASSWORD
- SMTP_HOST (defaults to `smtp.gmail.com`)
- SMTP_PORT (defaults to `465`)
- SMTP_SECURE (defaults to `true`)
- NOTIFICATION_FROM_EMAIL
- DEFAULT_CLIENT_NOTIFICATION_EMAIL

These are recommended for observability, but the app still runs without them:

- SENTRY_DSN
- NEXT_PUBLIC_SENTRY_DSN
- SENTRY_ENVIRONMENT
- NEXT_PUBLIC_SENTRY_ENVIRONMENT

This is recommended for protected client status links:

- CLIENT_VIEW_SECRET

## Local bootstrap
Run `npm run env:bootstrap` from the repo root to generate `.env.local` from
existing local secret files. It currently auto-loads:
- `TELNYX_API_KEY`
- `APP_BASE_URL` from `FYL_BASE_URL` when present
- `INTERNAL_API_KEY`

You still need to provide:
- `DATABASE_URL`
- `REDIS_URL`
- `TELNYX_FROM_NUMBER`

## Main workflows

### Website intake
- `POST /api/webhooks/website/intake`
- `POST /api/webhooks/website/onboarding`

These public website-facing routes accept browser or form-platform submissions and land them in the client intake bridge. Intake routes currently normalize the live website payload shapes for:
- book-a-call modal / lightbox
- full signup
- onboarding / 10DLC setup

### Telnyx
- `POST /api/webhooks/telnyx`

Inbound SMS and delivery events are routed by destination number so multiple clients can safely share one Telnyx account while keeping number ownership isolated per client. The app uses those events to attach messages to the right contact, conversation, and workflow state.

### Review automation
- `POST /api/webhooks/reviews/[clientId]`

Completed appointments can hit this route to queue a delayed post-visit review request. Review scoring, escalation, and Google review follow-up run through the same workflow and messaging stack as the rest of the app.

### Lead sourcing
- `POST /api/webhooks/lead`
- `POST /api/internal/leads/import/google-maps`

These feed the outbound Leads workflow.

## Current routes
- POST /api/webhooks/lead
- POST /api/webhooks/telnyx
- POST /api/webhooks/website/intake
- POST /api/webhooks/website/onboarding
- POST /api/internal/leads/import/google-maps
- POST /api/internal/clients/intake
- POST /api/internal/clients/onboarding
- GET /api/health

## Lean guardrails

- `GET /api/health` now returns `503` when required runtime checks fail, so Railway can use it as a real healthcheck target.
- `instrumentation.ts` emits structured JSON for server boot, unhandled rejections, and uncaught exceptions into Railway logs.
- Sentry is intentionally optional for now. If you wire a DSN later, diagnostics will reflect that immediately.
- `npm run check:health` is available for quick local or deployed readiness checks.
- `npm test` runs the webhook payload normalization tests for the live website form shapes.

## Current pages
- `/` — activity-style operator landing
- `/clients` — paying client list
- `/clients/[id]` — main client workspace
- `/clients/[id]/crm` — collected records for one client
- `/clients/[id]/operator` — Comms Lab and live client thread view
- `/clients/[id]/telnyx` — Telnyx onboarding and 10DLC setup
- `/clients/[id]/booking` — booking destination, review automation, and sync readiness
- `/clients/new` — lightweight new-client setup flow
- `/clients/intake` — sold-to-signup bridge
- `/c/[id]` — lightweight client-facing status view, intended for signed links
- `/leads` — outbound prospecting board
- `/messages` — unified inbox across clients
- `/conversations/[conversationId]` — full thread detail
- `/admin/system` — simplified system status
- `/admin/activity` — activity log
- `/diagnostics/queues`
- `/diagnostics/workflows`
- `/diagnostics/clients/[id]`
