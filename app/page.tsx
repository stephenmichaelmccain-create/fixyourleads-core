import { LayoutShell } from './components/LayoutShell';
import { safeCountSummary } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const summary = await safeCountSummary();

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
        <div className="inline-actions">
          <a className="button-secondary" href="/companies">
            Companies
          </a>
          <a className="button-secondary" href="/leads">
            Leads
          </a>
          <a className="button-secondary" href="/conversations">
            Conversations
          </a>
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
