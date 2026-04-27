# n8n Automation Setup

This is the minimum setup needed to make the new shared n8n provisioning path work in production.

## Goal

Use one shared n8n service on Railway.

When a client is approved in Fix Your Leads:

1. the app clones one reusable n8n workflow template
2. the app assigns a unique webhook path for that client
3. the app stores the workflow status, editor link, and last error
4. the client workflow page shows whether the automation is actually ready

## App env vars

Set these in the `fixyourleads-core` Railway app service:

- `N8N_BASE_URL`
- `N8N_API_KEY`
- `N8N_TEMPLATE_BOOKING_WORKFLOW_ID`
- `AUTOMATION_SHARED_SECRET`

Optional if they differ from the main n8n URL:

- `N8N_EDITOR_BASE_URL`
- `N8N_WEBHOOK_BASE_URL`
- `N8N_API_BASE_URL`

The app already uses these existing envs too:

- `APP_BASE_URL`
- `INTERNAL_API_KEY`
- `VOICE_BOOKING_WEBHOOK_SECRET` or `VOICE_DEMO_WEBHOOK_SECRET`

## Recommended Railway shape

Use one separate Railway service for n8n with:

- persistent volume
- Postgres
- a public domain
- n8n API enabled

You do not need one n8n instance per client.

## Import the template

Import this file into n8n once:

- [docs/n8n/fyl-shared-booking-template.json](/Users/stephenmccain/Documents/Codex/2026-04-26/you-re-taking-over-work-on-2/fixyourleads-core/docs/n8n/fyl-shared-booking-template.json)

That imported workflow is the template that Fix Your Leads clones for each approved client.

After import:

1. leave the template in n8n
2. copy its workflow ID
3. set that ID as `N8N_TEMPLATE_BOOKING_WORKFLOW_ID` in the app

The template itself does not need to be live for customer traffic. It only needs to exist so the app can clone it.

## What the template does

The template flow is intentionally simple:

1. receive a booking payload on a webhook
2. fetch the latest client config from Fix Your Leads
3. post the normalized payload into `POST /api/webhooks/voice/appointments`

That app route already handles:

- company resolution
- caller/contact resolution
- lead creation or reuse
- appointment creation or reuse
- call evidence fields like `callId`, `recordingUrl`, `transcriptUrl`, `transcriptText`

## Placeholder tokens in the template

The app replaces these when it clones the template:

- `__FYL_CONFIG_URL__`
- `__FYL_AUTOMATION_SECRET__`
- `__FYL_APP_BASE_URL__`
- `__FYL_BOOKING_CREATE_URL__`
- `__FYL_COMPANY_ID__`
- `__FYL_COMPANY_NAME__`
- `__FYL_CALLED_NUMBER__`
- `__FYL_TELNYX_ASSISTANT_ID__`
- `__FYL_NOTIFICATION_EMAIL__`
- `__FYL_EXTERNAL_BOOKING_PLATFORM__`
- `__FYL_EXTERNAL_CALENDAR_ID__`
- `__FYL_INTERNAL_API_KEY__`

The webhook path is also overwritten automatically per client.

## After app deploy

Once the env vars are set and the template exists:

1. approve a new intake client
2. open that client’s workflow page
3. confirm you see:
   - `Ready` or a clear blocker
   - workflow ID
   - workflow editor link
   - unique webhook path

If the env is incomplete, the page will show `Action required` instead of failing silently.

## What to plug into providers

Use the client-specific webhook URL shown on the workflow page after provisioning.

That is the webhook each booking system or automation source should hit for that client.

Do not point all providers at the shared template webhook.

## Expected auth behavior

The n8n workflow fetches client config from:

- `GET /api/internal/automation/client-config?companyId=...`

using:

- header `x-automation-secret: AUTOMATION_SHARED_SECRET`

The n8n workflow then posts the normalized result into:

- `POST /api/webhooks/voice/appointments`

using:

- header `x-voice-webhook-secret: VOICE_BOOKING_WEBHOOK_SECRET`

## First live test

Send a test payload into the client-specific n8n webhook with:

- `phone`
- `startTime`
- `fullName`
- `email`
- `purpose`
- `notes`
- `calledNumber`
- `callId`

The app should:

1. resolve the client
2. create or reuse the lead/contact
3. create the appointment
4. show the result in meetings, activity, and the live log

## Current limitation

This first version provisions the workflow shell and routes finalized payloads into the app.

It does not yet auto-build provider-specific booking logic for every external calendar or booking platform.

That is the next layer:

- Google Calendar variant
- Calendly variant
- Boulevard variant
- Vagaro variant
- custom provider branches
