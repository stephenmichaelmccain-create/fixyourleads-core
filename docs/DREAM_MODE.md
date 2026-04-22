# Dream Mode

6-hour autonomous work session for `fixyourleads-core`.

## Branch rule

- Work only on `dream/2026-04-21-overnight`.
- Never push unattended work directly to `main`.
- Push stable checkpoints to the dream branch after build and typecheck pass.

## Objective

Advance FixYourLeads toward production readiness with small, safe, reversible changes.

## Priority lanes

1. Live blockers
2. Core operator workflows
3. Diagnostics, workflow visibility, and master logs
4. Follow-up heartbeat worker hardening
5. Cleanup and dead code removal
6. Docs only when they reduce future token cost

## Hard rules

- Max 4 commits per heartbeat cycle.
- If two consecutive heartbeats produce zero commits, write the blocker into `docs/NEXT_TASKS.md` and stop spinning.
- Prefer extending existing systems over adding new ones.
- Never make destructive DB changes unattended.
- Never rotate or print secrets.
- Never change Railway service config unattended.

## Per-heartbeat protocol

1. `git pull --ff-only origin dream/2026-04-21-overnight`
2. Read `docs/NEXT_TASKS.md`
3. Pick the highest-priority unblocked task
4. Implement the smallest safe version
5. Run `npx tsc --noEmit`
6. Run `npm run build`
7. Commit and push if stable
8. Update `docs/NEXT_TASKS.md`
9. If blocked, record it and pivot once; if still blocked next cycle, stop

## Stop and wait for approval

- Destructive migrations
- Secret rotation or secret output
- Billing, domain, DNS, or paid service changes
- Railway config changes
- Anything not cleanly reversible with `git revert`

## End-of-session

Update `docs/PROJECT_STATUS.md` with a short dated summary:

- date and session duration
- branch name
- commits shipped
- lanes advanced
- blockers hit
- recommended next task
- merge readiness
