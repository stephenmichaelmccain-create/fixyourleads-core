import { LayoutShell } from './components/LayoutShell';
import { safeCountSummary } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const summary = await safeCountSummary();
  const surfaces = [
    {
      href: '/companies',
      eyebrow: 'Workspace setup',
      title: 'Keep each clinic ready to work.',
      body: 'Set inbound numbers, notification emails, and jump straight into the right company workspace.'
    },
    {
      href: '/conversations',
      eyebrow: 'Primary queue',
      title: 'Reply where revenue is already waiting.',
      body: 'Treat conversations like the real work queue: reply fast, book clean, and keep context attached.'
    },
    {
      href: '/leads',
      eyebrow: 'Top of funnel',
      title: 'Import and sort leads without duplicate mess.',
      body: 'Source clinics, normalize phone numbers, and move only the right people into live threads.'
    },
    {
      href: '/bookings',
      eyebrow: 'Booked revenue',
      title: 'Keep appointments visible once the work pays off.',
      body: 'See upcoming bookings, confirm they stay attached to the right clinic, and catch notification gaps fast.'
    }
  ];

  return (
    <LayoutShell
      title="Your ads are working. Your follow-up isn’t."
      description="This is the internal control room for the systems behind Fix Your Leads: speed-to-lead, conversation management, booking, and clinic notifications."
      section="home"
    >
      <div className="panel-grid">
        <section className="panel panel-dark panel-stack">
          <div className="metric-label">Control room</div>
          <h2 className="section-title section-title-large">Run the entire front desk replacement from one place.</h2>
          <p className="metric-copy">
            Keep the product narrow: track clinics, avoid duplicate outreach, work conversations, and move people into booked
            appointments without turning this into a bloated CRM.
          </p>
          <div className="inline-actions">
            <a className="button" href="/companies">
              Open companies
            </a>
            <a className="button-secondary" href="/conversations">
              Work conversations
            </a>
          </div>
        </section>

        <section className="panel panel-stack">
          <div className="metric-label">Minimum workflow</div>
          <h2 className="section-title">Lead in. Text fast. Book clean. Notify the clinic.</h2>
          <ol className="list-clean text-muted">
            <li>Source clinics and ingest leads without duplicating contacts.</li>
            <li>Reply instantly by text or voice and keep the conversation attached to the right company.</li>
            <li>Book the appointment and notify the client from the same operating system.</li>
          </ol>
        </section>
      </div>

      <div className="metric-grid">
        <section className="metric-card">
          <div className="metric-label">Companies</div>
          <div className="metric-value">{summary.companies ?? '—'}</div>
          <div className="metric-copy">Client accounts managed inside the system.</div>
        </section>
        <section className="metric-card">
          <div className="metric-label">Leads</div>
          <div className="metric-value">{summary.leads ?? '—'}</div>
          <div className="metric-copy">Deduped lead records tied to real contacts.</div>
        </section>
        <section className="metric-card">
          <div className="metric-label">Conversations</div>
          <div className="metric-value">{summary.conversations ?? '—'}</div>
          <div className="metric-copy">Text threads ready for follow-up, booking, and recovery.</div>
        </section>
        <section className="metric-card">
          <div className="metric-label">Bookings</div>
          <div className="metric-value">{summary.appointments ?? '—'}</div>
          <div className="metric-copy">Appointments already attached to real contacts and client workspaces.</div>
        </section>
        <section className="metric-card">
          <div className="metric-label">Events</div>
          <div className="metric-value">{summary.events ?? '—'}</div>
          <div className="metric-copy">Audit trail for outreach, replies, and appointments.</div>
        </section>
      </div>

      {!summary.ok && (
        <section className="panel panel-stack">
          <div className="metric-label">Readiness</div>
          <h2 className="section-title">The app is up, but the data layer still needs attention.</h2>
          <p className="page-copy">
            Open <a href="/diagnostics">Diagnostics</a> to verify env state, then check <a href="/api/health">API Health</a> before
            you trust live workflow counts.
          </p>
        </section>
      )}

      <section className="panel panel-stack">
        <div className="metric-label">Working surfaces</div>
        <div className="surface-link-grid">
          {surfaces.map((surface) => (
            <a key={surface.href} className="surface-link-card" href={surface.href}>
              <span className="metric-label">{surface.eyebrow}</span>
              <strong className="section-title">{surface.title}</strong>
              <span className="text-muted">{surface.body}</span>
            </a>
          ))}
        </div>
        <div className="inline-actions">
          <a className="button-secondary" href="/events">
            Events
          </a>
          <a className="button-ghost" href="/diagnostics">
            Diagnostics
          </a>
          <a className="button-ghost" href="/api/health">
            API health
          </a>
        </div>
      </section>
    </LayoutShell>
  );
}
