## Now
- Keep `Our Leads` moving toward a real outbound calling surface: stronger filters, richer clinic fields, and safer next-action handling.
- Keep `/clients/[id]` as the primary operator surface for active client work: fewer clicks, faster replies, clearer booking state.
- Keep all changes deploy-safe on `main`. No destructive schema or config changes without review.

## Next
- Add richer clinic/import fields to `Our Leads` so each row feels like a real prospecting record.
- Build the website-signup waiting pipeline more clearly off sold leads.
- Tighten diagnostics around queues, events, and client health only where they speed up debugging.
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
- Build and typecheck before each stable checkpoint.
- Push every stable checkpoint to `origin/main` only after it is deploy-safe.
