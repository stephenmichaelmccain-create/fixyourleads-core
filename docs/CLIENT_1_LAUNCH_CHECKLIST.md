# Client 1 Launch Checklist

Last updated: 2026-04-24

This is the minimum checklist for safely onboarding the first paying client.
Do not call the product launched until every item in the "must pass" sections
below is true.

## Definition of launched

One real client can:

- submit a lead from a live website or ad form
- receive the first speed-to-lead text from the correct dedicated number
- reply by SMS and have the conversation land in the right client workspace
- move into booking without silent or fake auto-booking
- receive a confirmed appointment text only after an operator or trusted flow
  chooses the actual appointment time
- receive a booking notification email

## Must pass: infrastructure

- `app` is green in Railway production
- `worker` is green in Railway production
- `/api/health` returns `ready: true`
- Telnyx webhook signature verification is enabled
- Redis and Postgres checks are green
- Worker heartbeat is recent

## Must pass: messaging

- Telnyx messaging profile points inbound webhooks to:
  `https://app-production-9ba1.up.railway.app/api/webhooks/telnyx`
- Client has a dedicated inbound number assigned
- The number is saved on the client/company record in the app
- Outbound SMS sends from that same number
- Inbound SMS on that number lands on the right client thread
- STOP handling suppresses the lead
- START handling restores the lead

## Must pass: client setup

- Client record exists in `/clients`
- Client notification email is set
- Dedicated routing number is set
- Website is set on the client profile
- Primary contact fields are filled in
- The client intake workspace does not show routing or email gaps

## Must pass: compliance

- Client lead form includes SMS consent language
- Client lead form says reply STOP to opt out
- The form posts into the FixYourLeads intake endpoint
- 10DLC plan is decided for this client
- Quiet hours and outreach frequency are understood operationally

## Must pass: booking

- Generic booking replies do not create default fake appointments
- Booking intent moves the thread into booking workflow
- The system asks for a preferred day and time when the contact replies with
  generic intent
- An operator can book from the conversation or client workspace
- Booking creates an appointment record
- Booking marks the lead as booked
- Booking sends the contact a confirmation text
- Booking sends the client an email notification

## Must pass: notifications

- `SMTP_USER` is configured in Railway
- `SMTP_PASSWORD` is configured in Railway
- `NOTIFICATION_FROM_EMAIL` is configured in Railway
- A real test booking sends an email successfully

## Must pass: end-to-end smoke test

Run this with a real phone and a real client test form.

1. Submit a lead through the live client form.
2. Confirm the lead lands in the correct client workspace.
3. Confirm the first outbound text sends from the client number.
4. Reply with a normal human answer.
5. Confirm the reply lands on the same thread.
6. Reply with booking intent.
7. Confirm the system asks for scheduling details instead of auto-booking a
   fake slot.
8. Book the appointment from the operator surface.
9. Confirm the lead status becomes `BOOKED`.
10. Confirm the confirmation text sends.
11. Confirm the client email arrives.

## Current launch blockers

As of 2026-04-24, these are still the real blockers:

- SMTP is not configured in production yet
- Dedicated client-number assignment is still an ops/manual process
- The first real client smoke test has not been run end to end yet

## Current safe operating stance

The product is safe to keep hardening in production because:

- webhook verification is live
- inbound routing is live
- outbound messaging is live
- generic booking intent no longer creates silent default appointments

The product is not fully launched until notifications and the real smoke test
are complete.
