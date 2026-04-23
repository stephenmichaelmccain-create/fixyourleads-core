import { LayoutShell } from '@/app/components/LayoutShell';

const systemLayers = [
  {
    name: 'Next.js app',
    role: 'Contact and workflow brain: operator UI, internal APIs, public webhooks, and runtime diagnostics.'
  },
  {
    name: 'Worker processes',
    role: 'BullMQ workers that apply business rules after intake, outreach, inbound replies, and booking events.'
  },
  {
    name: 'Postgres',
    role: 'Stores companies, contacts, channel identities, workflow runs, leads, conversations, messages, appointments, events, and idempotency keys.'
  },
  {
    name: 'Redis + BullMQ',
    role: 'Moves async work between inbound events, auto-follow-up, and booking execution.'
  },
  {
    name: 'Telnyx',
    role: 'Communications execution layer for SMS, voice, delivery events, scheduling, and number routing.'
  },
  {
    name: 'Google Maps API',
    role: 'Supplies clinic lead search results for import into the CRM.'
  },
  {
    name: 'SMTP / Gmail',
    role: 'Optional booking notification path to the clinic or client email address.'
  },
  {
    name: 'Railway',
    role: 'Runs the app, workers, Postgres, and Redis, and hosts live diagnostics and health checks.'
  }
];

const workflows = [
  {
    title: 'Lead intake and dedupe',
    summary: 'This is the front door for new clinics. It creates or reuses the contact, lead, and conversation, then maps channel identity so the same clinic is not worked twice.',
    trigger: 'Operator quick add, webhook-based lead intake, or Google Maps import.',
    paths: [
      '/api/internal/leads/create',
      '/api/webhooks/lead',
      '/api/internal/leads/import/google-maps'
    ],
    services: [
      'services/leads.ts',
      'lib/google-maps.ts',
      'lib/phone.ts'
    ],
    systems: ['Next.js app', 'Google Maps API', 'Postgres', 'Redis lead_queue'],
    records: ['Company', 'Contact', 'ContactChannelIdentity', 'Lead', 'Conversation', 'WorkflowRun', 'EventLog'],
    stages: [
      'Normalize phone and source identifiers.',
      'Reuse existing contact and conversation when the clinic already exists.',
      'Create the lead only when it is truly net new.',
      'Map the normalized phone to the contact as both SMS and voice identity.',
      'Activate the first workflow owner for the contact.',
      'Write an event so operators can see whether it was imported, duplicated, or suppressed.',
      'Queue first-touch outreach when the flow says the lead is ready.'
    ]
  },
  {
    title: 'Outbound outreach',
    summary: 'This is how the system starts or continues contact with a clinic by text. The app decides workflow ownership and sender context, then Telnyx executes the message.',
    trigger: 'Conversation operator send action or queued new lead outreach.',
    paths: [
      '/api/internal/messages/send',
      'workers/process_new_lead.ts'
    ],
    services: [
      'services/messaging.ts',
      'lib/telnyx.ts',
      'lib/inbound-numbers.ts'
    ],
    systems: ['Next.js app', 'Worker processes', 'Telnyx', 'Postgres', 'Redis lead_queue', 'Redis workflow_queue'],
    records: ['Lead', 'Conversation', 'Message', 'WorkflowRun', 'EventLog'],
    stages: [
      'Pick the company sender number from the clinic routing setup.',
      'Send the message through Telnyx.',
      'Persist the outbound message on the conversation.',
      'Move lead status to contacted, keep the workflow owner current, and log the event.',
      'Schedule the next delayed follow-up step when the workflow still owns the contact.'
    ]
  },
  {
    title: 'Inbound reply routing',
    summary: 'Every incoming Telnyx webhook lands here first. Telnyx delivers the event; the app validates it, finds the right clinic by inbound number, stores the message, and hands the text to the worker layer.',
    trigger: 'Telnyx message webhook.',
    paths: [
      '/api/webhooks/telnyx'
    ],
    services: [
      'services/messaging.ts',
      'lib/security.ts',
      'lib/inbound-numbers.ts',
      'lib/queue.ts'
    ],
    systems: ['Next.js app', 'Telnyx', 'Postgres', 'Redis message_queue'],
    records: ['IdempotencyKey', 'Company', 'Contact', 'ContactChannelIdentity', 'Conversation', 'Message', 'WorkflowRun', 'EventLog'],
    stages: [
      'Verify webhook signature when strict mode is enabled.',
      'Reject duplicates with a company-scoped idempotency key.',
      'Resolve the clinic, contact, and conversation owner from the inbound number.',
      'Store the inbound message and mark the lead as replied.',
      'Promote the contact into an active conversation workflow.',
      'Queue the message text for interpretation.'
    ]
  },
  {
    title: 'Reply interpretation and suppression',
    summary: 'This is app-side business logic. The message worker decides whether an inbound reply means stop, restart, help, booking intent, or a workflow state change.',
    trigger: 'Queued inbound message from the Telnyx webhook.',
    paths: [
      'workers/handle_incoming_message.ts'
    ],
    services: [
      'workers/handle_incoming_message.ts',
      'lib/queue.ts'
    ],
    systems: ['Worker processes', 'Postgres', 'Redis message_queue', 'Redis booking_queue', 'Redis workflow_queue'],
    records: ['Lead', 'WorkflowRun', 'EventLog'],
    stages: [
      'Normalize the inbound text.',
      'Suppress the lead on stop or wrong-number language.',
      'Restore the lead on start or unstop language.',
      'Log help requests without changing booking state.',
      'Queue a booking job when the reply looks like booking intent.',
      'Pause or cancel lower-priority workflows when the contact changes state.'
    ]
  },
  {
    title: 'Delayed workflow follow-up',
    summary: 'This is the first explicit workflow runner. The app owns the timeline and state; BullMQ wakes the job up when a follow-up step is due.',
    trigger: 'A workflow run has a due nextRunAt and a queued workflow job.',
    paths: [
      'workers/workflows.ts'
    ],
    services: [
      'lib/workflows.ts',
      'lib/workflow-jobs.ts',
      'workers/workflows.ts',
      'services/messaging.ts'
    ],
    systems: ['Worker processes', 'Postgres', 'Redis workflow_queue', 'Telnyx'],
    records: ['WorkflowRun', 'Lead', 'Conversation', 'Message', 'EventLog'],
    stages: [
      'Wake up the due workflow step from BullMQ.',
      'Confirm the workflow still owns the contact and is still active.',
      'Send the next message only when the lead is neither booked nor suppressed.',
      'Advance or complete the workflow run based on the number of touches sent.',
      'Write a workflow execution event so operators can audit what happened.'
    ]
  },
  {
    title: 'Booking creation and confirmation',
    summary: 'This flow creates the appointment, marks the lead as booked, asks Telnyx to send the confirmation text, and optionally emails the clinic or client.',
    trigger: 'Operator booking action or booking worker job.',
    paths: [
      '/api/internal/bookings/create',
      'workers/booking.ts'
    ],
    services: [
      'services/booking.ts',
      'lib/notifications.ts',
      'lib/telnyx.ts',
      'lib/inbound-numbers.ts'
    ],
    systems: ['Next.js app', 'Worker processes', 'Telnyx', 'SMTP / Gmail', 'Postgres', 'Redis booking_queue'],
    records: ['Appointment', 'Lead', 'Message', 'WorkflowRun', 'EventLog'],
    stages: [
      'Resolve the requested appointment time.',
      'Prevent duplicate bookings for the same contact and slot.',
      'Create the appointment and mark the lead as booked.',
      'Send a confirmation text from the clinic routing number.',
      'Send the booking notification email when SMTP is configured.',
      'Promote booking as the active workflow owner and complete lower-priority lead follow-up state.',
      'Keep booking state and audit history in the app.'
    ]
  },
  {
    title: 'Operations, audit, and health',
    summary: 'This is the operator truth surface for live deployments. It shows whether the stack is wired, which provider owns which responsibility, and what the latest workflow events look like.',
    trigger: 'Operator checks, Railway health checks, or internal admin reads.',
    paths: [
      '/diagnostics',
      '/diagnostics/workflows',
      '/api/health',
      '/api/internal/health',
      '/clients',
      '/clients/[id]',
      '/leads',
      '/messages',
      '/admin/system',
      '/'
    ],
    services: [
      'lib/health.ts',
      'lib/notifications.ts',
      'lib/telnyx.ts',
      'lib/runtime-safe.ts',
      'app/events/page.tsx'
    ],
    systems: ['Next.js app', 'Railway', 'Telnyx', 'Postgres', 'Redis'],
    records: ['Company', 'Contact', 'ContactChannelIdentity', 'WorkflowRun', 'Lead', 'Conversation', 'Message', 'Appointment', 'EventLog'],
    stages: [
      'Probe the app, database, Redis, and external providers.',
      'Expose queue health and recent failed jobs.',
      'Show routing gaps, clinic email gaps, and connectivity issues.',
      'Let operators inspect recent conversations and event history without touching secrets.'
    ]
  }
];

const operatorSurfaces = [
  { href: '/clients', title: 'Clients', body: 'Paying client workspaces with health, lead tables, messages, appointments, and profile updates.' },
  { href: '/leads', title: 'Leads', body: 'The outbound prospecting pipeline for clinics we are trying to sell.' },
  { href: '/messages', title: 'Messages', body: 'Unified inbox across clients for the conversations that need a human.' },
  { href: '/admin/system', title: 'System Status', body: 'Runtime truth, env readiness, queue health, and deployment checks.' },
  { href: '/', title: 'Activity Log', body: 'A durable operator feed for workflow history, worker outcomes, and live system actions.' }
];

export default function WorkflowDiagnosticsPage() {
  return (
    <LayoutShell
      title="Workflow Map"
      description="See how the live system is wired: which routes fire, which workers pick up the job, which providers execute communications, and where each workflow writes data."
      section="diagnostics"
    >
      <section className="panel panel-stack panel-dark">
        <div className="metric-label">System view</div>
        <h2 className="section-title section-title-large">What is actually running</h2>
        <p className="page-copy page-copy-inverse">
          This page is the technical map for the live product. Telnyx executes communications, while the app keeps contact ownership, workflow
          state, and operator truth. The paths below show how a lead moves from intake to outreach to booking.
        </p>
        <div className="workflow-chip-grid">
          {systemLayers.map((layer) => (
            <div key={layer.name} className="workflow-chip">
              <strong>{layer.name}</strong>
              <span>{layer.role}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel panel-stack">
        <div className="metric-label">Main surfaces</div>
        <div className="surface-link-grid">
          {operatorSurfaces.map((surface) => (
            <a key={surface.href} className="surface-link-card" href={surface.href}>
              <span className="metric-label">Workspace</span>
              <strong className="section-title">{surface.title}</strong>
              <span className="text-muted">{surface.body}</span>
            </a>
          ))}
        </div>
      </section>

      <div className="workflow-grid">
        {workflows.map((workflow) => (
          <section key={workflow.title} className="panel panel-stack workflow-card">
            <div className="metric-label">Workflow</div>
            <h2 className="section-title section-title-large">{workflow.title}</h2>
            <p className="page-copy">{workflow.summary}</p>

            <div className="workflow-meta-grid">
              <div className="key-value-card">
                <span className="key-value-label">Trigger</span>
                {workflow.trigger}
              </div>
              <div className="key-value-card">
                <span className="key-value-label">Systems touched</span>
                {workflow.systems.join(' · ')}
              </div>
              <div className="key-value-card">
                <span className="key-value-label">Records touched</span>
                {workflow.records.join(' · ')}
              </div>
            </div>

            <div className="workflow-columns">
              <div className="workflow-column">
                <div className="metric-label">Path</div>
                <ol className="workflow-stage-list">
                  {workflow.stages.map((stage) => (
                    <li key={stage}>{stage}</li>
                  ))}
                </ol>
              </div>

              <div className="workflow-column">
                <div className="metric-label">Routes and jobs</div>
                <div className="workflow-code-list">
                  {workflow.paths.map((path) => (
                    <code key={path} className="workflow-code-pill">
                      {path}
                    </code>
                  ))}
                </div>

                <div className="metric-label">Service files</div>
                <div className="workflow-code-list">
                  {workflow.services.map((service) => (
                    <code key={service} className="workflow-code-pill">
                      {service}
                    </code>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>
    </LayoutShell>
  );
}
