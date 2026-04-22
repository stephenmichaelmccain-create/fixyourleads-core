## Now
- Keep `Leads` moving toward a real outbound calling surface: stronger follow-up queues, safer duplicate handling, and clearer sold-to-signup flow.
- Keep `/clients/[id]` and `/conversations/[conversationId]` as the primary operator surfaces for active client work: fewer clicks, faster replies, clearer booking state, and stronger thread-level controls.
- Keep all changes deploy-safe on `main`. No destructive schema or config changes without review.

## Next
- Wire the real website form into `/api/internal/clients/intake` now that the route accepts flexible payloads and direct signups surface in `/clients/intake`.
- Turn the new `/clients/intake` bridge into a fuller signup/onboarding pipeline once website form data starts landing.
- Tighten diagnostics around queues, events, and client health only where they speed up debugging.
- Improve conversation workflows further with even fewer clicks and better thread-level operator controls.
- Make multi-number client routing fully explicit per conversation/message, not just per client.

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
