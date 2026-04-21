# FixYourLeads Core

Code-first core system scaffold for multi-tenant lead intake, messaging, and booking.

## Start here
- `docs/PROJECT_STATUS.md` for the current handoff and deploy state
- `docs/MINIMUM_PRODUCTION_WORKFLOW.md` for the narrow product target
- `docs/NEW_CHAT_PROMPT.md` for a paste-ready fresh-chat brief

## Stack
- Next.js
- Postgres + Prisma
- Redis + BullMQ
- Telnyx
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

## Local bootstrap
Run `npm run env:openclaw` from the repo root to generate `.env.local` from the
existing OpenClaw secret files. It currently auto-loads:
- `TELNYX_API_KEY`
- `APP_BASE_URL` from `FYL_BASE_URL` when present
- `INTERNAL_API_KEY`

You still need to provide:
- `DATABASE_URL`
- `REDIS_URL`
- `TELNYX_FROM_NUMBER`

## Current routes
- POST /api/webhooks/lead
- POST /api/webhooks/telnyx
- POST /api/internal/leads/import/google-maps
- GET /api/health

## Lean guardrails

- `GET /api/health` now returns `503` when required runtime checks fail, so Railway can use it as a real healthcheck target.
- `instrumentation.ts` emits structured JSON for server boot, unhandled rejections, and uncaught exceptions into Railway logs.
- Sentry is intentionally optional for now. If you wire a DSN later, diagnostics will reflect that immediately.
- `npm run check:health` is available for quick local or deployed readiness checks.

## Current pages
- `/companies`
- `/leads`
- `/conversations`
- `/bookings`
- `/events`
- `/diagnostics`
