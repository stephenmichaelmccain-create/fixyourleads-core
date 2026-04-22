## Now
- Fix any live blocker first. Current live app is up, so next priority is core operator workflow improvements on `/clients/[id]`.
- Strengthen the client workspace so it becomes the primary operator surface: keep the leads table clear, keep the conversation side panel useful, and make switching between companies easier.
- Keep all changes deploy-safe if they might be merged later. No destructive schema or config changes.

## Next
- Add a safer follow-up heartbeat runner on top of the existing BullMQ worker setup.
- Add diagnostics subpages for queue detail, failed jobs, and per-company health.
- Turn `/events` into a real searchable master event log instead of a redirect.
- Improve text conversation visibility with clearer message direction, timestamps, and delivery state.

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
