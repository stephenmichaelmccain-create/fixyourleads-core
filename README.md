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

## Current routes
- POST /api/webhooks/lead
- POST /api/webhooks/telnyx
