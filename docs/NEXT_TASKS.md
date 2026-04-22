## Now
- Fix any live blocker first. Current live app is up, so next priority is core operator workflow improvements on `/clients/[id]`.
- Keep the client workspace as the primary operator surface now that operators can send, book, and even start a first thread without leaving `/clients/[id]`.
- Tighten the remaining operator-control gaps inside the client workspace now that operators can also filter by actionable queue states without scanning the whole table.
- Keep surfacing the next best lead to work from `/clients/[id]` so operators do not have to think before acting.
- Keep all changes deploy-safe if they might be merged later. No destructive schema or config changes.

## Next
- Extend the safer follow-up heartbeat runner beyond observe-only reporting without auto-sending anything yet.
- Add the next diagnostics subpage for client-specific queue and recent activity drill-down if the shared queue view stops being enough.
- Improve conversation workflows further with even fewer clicks and better thread-level operator controls.

## Blocked
- None yet.

## Do Not Touch
- Railway service config, healthcheck path, or domain routing.
- Secrets, API keys, or env var values.
- Destructive database operations or table drops.
- `/api/health` semantics unless fixing a real live blocker with a backward-compatible change.

## Deploy Notes
- `main` auto-deploys to Railway production.
- Overnight work stays on `dream/2026-04-21-overnight` until human review.
- Build and typecheck before each stable checkpoint.
- Push every stable checkpoint to `origin/dream/2026-04-21-overnight`.
