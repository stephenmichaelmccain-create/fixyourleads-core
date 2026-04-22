## Now
- Fix any live blocker first. Current live app is up, so next priority is core operator workflow improvements on `/clients/[id]`.
- Strengthen the client workspace so it becomes the primary operator surface: keep the leads table clear and the full conversation view honest about delivery state.
- Keep switching between companies fast now that the workspace switcher and client health page are in place.
- Keep all changes deploy-safe if they might be merged later. No destructive schema or config changes.

## Next
- Extend the safer follow-up heartbeat runner beyond observe-only reporting without auto-sending anything yet.
- Add the next diagnostics subpage for client-specific queue and recent activity drill-down if the shared queue view stops being enough.
- Improve conversation workflows further with better reply handling and fewer operator clicks.

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
