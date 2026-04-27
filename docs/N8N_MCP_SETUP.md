# n8n MCP Setup

This is the preferred voice-assistant setup when you want Telnyx to talk to one MCP server instead of 3 separate custom tools.

## Goal

Use:

- one shared n8n service on Railway
- one client-specific MCP workflow per client assistant
- Fix Your Leads as the source of truth for client config, booking evidence, and diagnostics

The mental model is:

1. caller talks to Telnyx
2. Telnyx calls one client MCP server
3. the MCP server exposes `check_availability`, `book_appointment`, and `cancel_appointment`
4. those tools call Fix Your Leads directly or call the real booking provider first and then write back into Fix Your Leads

## High-level shape

For each client assistant:

```text
Telnyx assistant
-> n8n MCP Server Trigger
-> check_availability
-> book_appointment
-> cancel_appointment
```

Each tool can either call Fix Your Leads directly or branch through a real booking provider before it writes the result back into Fix Your Leads.

## What stays shared

You do not need:

- one Railway project per client
- one n8n instance per client

You do want:

- one shared Railway n8n service
- one shared Postgres for n8n
- one client-specific MCP workflow per assistant inside that shared n8n

## Telnyx side

Inside the client assistant:

1. add one MCP server
2. point it at the client workflow's `MCP Server Trigger` URL
3. allow these 3 tools:
   - `check_availability`
   - `book_appointment`
   - `cancel_appointment`

This replaces the older pattern of creating 3 separate custom Telnyx tools by hand.

## n8n side

Inside the client workflow:

1. add `MCP Server Trigger`
2. expose these 3 tools
3. wire each tool to the right backing logic

Recommended backing logic:

### Tool 1: `check_availability`

Call Fix Your Leads directly:

- `POST /api/webhooks/voice/check-availability`

Use it when the assistant wants to confirm a slot before offering or booking it.

### Tool 2: `book_appointment`

Two valid patterns:

1. `Fix Your Leads is the booking source of truth`
   - post the booking straight into the app
2. `External provider is the booking source of truth`
   - create the booking in the real provider first
   - then write the confirmed result back into Fix Your Leads

The final app writeback URL is:

- `POST /api/internal/bookings/create`

### Tool 3: `cancel_appointment`

Call Fix Your Leads directly:

- `POST /api/webhooks/voice/cancel`

Use it when the caller wants to cancel or reschedule.

## Fix Your Leads endpoints

The current app already exposes the voice actions you need:

- availability:
  - `POST /api/webhooks/voice/check-availability`
- direct voice booking:
  - `POST /api/webhooks/voice/appointments`
- cancellation:
  - `POST /api/webhooks/voice/cancel`
- final booking writeback from automation:
  - `POST /api/internal/bookings/create`
- latest client config:
  - `GET /api/internal/automation/client-config?companyId=...`

## Shared auth

Keep one shared secret available to the n8n workflow when it calls Fix Your Leads.

The current app expects:

- header name: `X-Voice-Webhook-Secret`

And one of these env-backed values:

- `VOICE_BOOKING_WEBHOOK_SECRET`
- `VOICE_DEMO_WEBHOOK_SECRET`
- `INTERNAL_API_KEY`

## Per-client setup checklist

1. approve the client in Fix Your Leads
2. let the app provision the client workflow shell
3. open the client `Connections` page
4. open the client workflow in n8n
5. add `MCP Server Trigger`
6. expose:
   - `check_availability`
   - `book_appointment`
   - `cancel_appointment`
7. connect those tools to Fix Your Leads or the real provider plus Fix Your Leads writeback
8. paste the MCP server URL into the Telnyx assistant
9. run one real voice booking test

## When to add a real provider step

If the clinic wants live booking into its real system, add the provider step inside `book_appointment` before the final Fix Your Leads writeback.

The normal pattern is:

```text
book_appointment
-> fetch client config
-> create booking in real provider
-> write confirmed booking back into Fix Your Leads
```

For `check_availability` and `cancel_appointment`, you can often keep the logic inside Fix Your Leads until a provider-specific need appears.

## Recommended first rollout

Start with:

- MCP server in Telnyx
- 3 exposed tools in n8n
- Fix Your Leads-backed availability and cancellation
- provider-specific logic only inside `book_appointment`

That keeps the voice flow simple while still letting you branch into real booking systems client by client.
