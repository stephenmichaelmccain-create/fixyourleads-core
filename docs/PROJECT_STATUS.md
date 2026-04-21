# FixYourLeads Project Status

Last updated: 2026-04-21

## Purpose

`fixyourleads-core` is the code-first core system for lead intake, SMS follow-up,
and booking workflows for clinics.

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

## Current known state

Confirmed:

- Railway MCP works in Codex after OAuth.
- Railway `list-projects` works.
- `whoami` on Railway is unreliable because of a Railway-side validation issue.
- The app repo includes an explicit Railway-safe start command:
  `next start -p ${PORT:-3000} -H 0.0.0.0`
- GitHub should be treated as the stable backup and history source for repo-safe
  changes.

Reported / last observed:

- The live app URL has been returning `502`.
- Earlier logs indicated the process can reach a `Ready` state before Railway
  appears to recycle or lose the instance.
- A Railway variables screen reportedly showed shared values for:
  `APP_BASE_URL`, `DATABASE_URL`, `INTERNAL_API_KEY`, `NODE_ENV`, and
  `REDIS_URL`.

Still not confirmed live:

- `TELNYX_API_KEY` on the Railway app service
- `TELNYX_FROM_NUMBER` on the Railway app service
- Whether `prisma db push` has been run against the live database
- The exact reason the live app returns `502` after startup

## Likely current bottlenecks

- Incomplete live runtime env on Railway
- App or worker service mismatch in Railway settings
- Post-start crash or restart after initial boot
- Missing live schema setup even if `DATABASE_URL` exists

## Safe next debugging steps

1. Verify the Railway app service has all six required env vars.
2. Verify the worker service has the same shared runtime vars it needs.
3. Confirm the live database schema has been pushed.
4. Read the latest Railway app logs around startup and first health traffic.
5. Re-test `/api/health` after env and schema confirmation.

## GitHub policy

- Prefer committing and pushing repo-safe updates promptly.
- Do not commit secrets, `.env.local`, or copied credential files.
- Leave unrelated local scratch files out of commits unless they are intentionally
  wired into the app.
