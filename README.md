# FixYourLeads Core

Code-first core system scaffold for multi-tenant lead intake, messaging, and booking.

## Stack
- Next.js
- Postgres + Prisma
- Redis + BullMQ
- Telnyx

## Required env
- DATABASE_URL
- REDIS_URL
- TELNYX_API_KEY
- TELNYX_FROM_NUMBER
- APP_BASE_URL
- INTERNAL_API_KEY

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
