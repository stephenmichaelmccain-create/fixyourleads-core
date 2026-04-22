# Minimum Production Workflow

Last updated: 2026-04-21

## Product intent

FixYourLeads should stay narrow:

- source clinic leads
- avoid duplicate outreach
- contact leads by text and call
- handle inbound replies
- book appointments
- notify the client when an appointment is booked

The app should not depend on Codex or agent tooling at runtime. Codex is only
for building and debugging the product.

## Current production shape

The current Railway production shape is the current production topology:

- `app`
- `worker`
- `Postgres`
- `Redis`

Do not add more production services unless a real workload forces it.

## Minimum production workflow

1. Import or create a lead for a client company.
2. Normalize the lead identity so the same clinic/contact is not worked twice.
3. Create or reuse the company contact record and conversation thread.
4. Send the first outbound SMS or call via Telnyx.
5. Record all outbound and inbound events on the conversation.
6. When the lead wants to book, create an appointment record.
7. Notify the client by email from `fixyourleadsadmin@gmail.com`.
8. Keep an audit trail so operators can see what happened without guessing.

## Must-have product capabilities

### Lead sourcing

- ingest leads from Google Maps API and similar sources
- store source metadata so we know where a lead came from
- suppress duplicates before outreach starts

### CRM tracking

- track companies, contacts, leads, conversations, appointments, and events
- track latest outreach status per lead
- show whether a lead is new, contacted, replied, booked, or suppressed
- keep the client booking notification email on the company record

### Messaging and calling

- send SMS through Telnyx
- receive SMS webhooks from Telnyx
- support voice flows through Telnyx without changing the core CRM model
- keep the full message and event history on the record

### Booking

- capture a requested time
- create an appointment record
- mark the lead as booked
- notify the client by email

### Safety rails

- do not contact the same clinic/contact twice by accident
- use idempotency for inbound webhooks and internal actions
- keep enough event history to reconstruct failures
- honor stop/unsubscribe replies by suppressing the lead
- keep a real health surface and structured production error logs so deploys
  fail honestly and runtime issues are visible without guesswork

## Current schema coverage

The current schema already covers the backbone:

- `Company`
- `Contact`
- `Lead`
- `Conversation`
- `Message`
- `Appointment`
- `EventLog`
- `IdempotencyKey`

## Likely next schema additions

These should be added only when we implement the matching workflow:

- lead source fields such as `source`, `sourceExternalId`, `googlePlaceId`
- suppression or dedupe fields such as `normalizedPhone`, `normalizedName`,
  `lastContactedAt`, `suppressedAt`, `suppressionReason`
- appointment outcome fields such as `status`, `notes`, `bookedBy`
- client notification fields such as `notificationEmail` on `Company`
- optional campaign fields if outbound outreach becomes batch-driven

## Build order

1. Lead import + dedupe
2. First outbound SMS flow
3. Inbound SMS webhook handling
4. Booking creation flow
5. Client email notification
6. Voice workflow on top of the same CRM records

## Explicit non-goals for now

- bloated generic CRM features
- extra Railway services without a clear need
- agent-dependent runtime behavior
- low-code workflow tooling
- premature analytics or dashboards beyond operator basics

## Minimal observability stance

- keep Railway as the main deployment and log surface
- keep `/api/health` honest so infra can trust it
- keep structured runtime logs on by default
- add Sentry only as a thin optional layer, not as a large observability
  platform project
