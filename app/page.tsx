import { LayoutShell } from './components/LayoutShell';
import { getPersistedCompanyContext } from './components/company-context.server';
import { withCompanyContext } from './components/company-context.shared';
import { safeCountSummary, safeWorkspaceOverview } from '@/lib/ui-data';
import { notificationReadiness } from '@/lib/notifications';
import { isGoogleMapsConfigured } from '@/lib/google-maps';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const persistedCompany = await getPersistedCompanyContext();
  const summary = await safeCountSummary();
  const overview = await safeWorkspaceOverview();
  const notifications = notificationReadiness();
  const googleMapsConfigured = isGoogleMapsConfigured();
  const topWorkspaces = [...overview.workspaces]
    .sort((left, right) => {
      if (left.missingSetupCount !== right.missingSetupCount) {
        return right.missingSetupCount - left.missingSetupCount;
      }

      if (left.activityScore !== right.activityScore) {
        return right.activityScore - left.activityScore;
      }

      return left.name.localeCompare(right.name);
    })
    .slice(0, 4);
  const missingWorkspaceSetupCount = overview.workspaces.filter((workspace) => workspace.missingSetupCount > 0).length;
  const nextSetupWorkspace = topWorkspaces.find((workspace) => workspace.missingSetupCount > 0) || null;
  const dailyWorkspace =
    overview.workspaces.find((workspace) => workspace.missingSetupCount === 0) || overview.workspaces[0] || null;
  const launchChecklist = [
    {
      label: 'Company workspaces ready',
      ready: missingWorkspaceSetupCount === 0 && overview.workspaces.length > 0,
      detail:
        overview.workspaces.length === 0
          ? 'Add the first real client workspace.'
          : missingWorkspaceSetupCount === 0
            ? `${overview.workspaces.length} workspace${overview.workspaces.length === 1 ? '' : 's'} ready.`
            : `${missingWorkspaceSetupCount} workspace${missingWorkspaceSetupCount === 1 ? '' : 's'} still missing routing or notification setup.`
    },
    {
      label: 'Client email notifications',
      ready: notifications.smtpUserSet && notifications.smtpPasswordSet,
      detail:
        notifications.smtpUserSet && notifications.smtpPasswordSet
          ? 'SMTP is configured.'
          : 'SMTP is not connected yet, so clinic email notifications will stay manual.'
    },
    {
      label: 'Lead sourcing',
      ready: googleMapsConfigured,
      detail: googleMapsConfigured ? 'Google Maps import is configured.' : 'Google Maps import still needs a configured API key.'
    }
  ];
  const surfaces = [
    {
      href: '/companies',
      eyebrow: 'Clinic setup',
      title: 'Keep every clinic workspace ready.',
      body: 'Set inbound numbers, notification emails, and move straight into the right client workspace.'
    },
    {
      href: '/conversations',
      eyebrow: 'Primary queue',
      title: 'Reply where booked revenue starts.',
      body: 'Use conversations as the live queue for texting, routing, and booking without losing clinic context.'
    },
    {
      href: '/leads',
      eyebrow: 'Lead capture',
      title: 'Import and qualify leads without duplicate noise.',
      body: 'Source clinics, normalize phone numbers, and push only real prospects into live threads.'
    },
    {
      href: '/bookings',
      eyebrow: 'Booked revenue',
      title: 'Keep appointments visible once follow-up converts.',
      body: 'Track upcoming bookings, keep them tied to the right clinic, and catch notification gaps fast.'
    },
    {
      href: '/events',
      eyebrow: 'Live operator feed',
      title: 'Watch activity as it lands.',
      body: 'See replies, booking events, dedupe actions, and delivery outcomes update in one live feed.'
    }
  ];

  return (
    <LayoutShell
      title="Your ads are working. Your follow-up isn’t."
      description="Run the operating layer behind Fix Your Leads: lead response, conversation routing, booking, and clinic notifications."
      section="home"
    >
      <div className="panel-grid">
        <section className="panel panel-dark panel-stack">
          <div className="metric-label">Command center</div>
          <h2 className="section-title section-title-large">Run lead response, booking, and clinic routing from one place.</h2>
          <p className="metric-copy">
            Keep the product narrow: real clinics, real outreach, real bookings, and clear operator handoff with no CRM clutter.
          </p>
          <div className="inline-actions">
            <a className="button" href="/companies">
              Open companies
            </a>
            <a className="button-secondary" href={withCompanyContext('/conversations', persistedCompany?.companyId)}>
              {persistedCompany?.companyName ? `Resume ${persistedCompany.companyName}` : 'Work conversations'}
            </a>
            <a className="button-ghost" href="/events">
              Watch live feed
            </a>
          </div>
        </section>

        <section className="panel panel-stack">
          <div className="metric-label">Live workflow</div>
          <h2 className="section-title">Lead in. Reply fast. Book clean. Keep the clinic informed.</h2>
          <ol className="list-clean text-muted">
            <li>Source clinics and ingest leads without duplicating contacts.</li>
            <li>Reply instantly by text or voice and keep the conversation attached to the right company.</li>
            <li>Book the appointment and notify the client from the same operating system.</li>
          </ol>
          {persistedCompany && (
            <div className="text-muted">
              Last workspace stays sticky across the main surfaces, so the fastest path back into work is {persistedCompany.companyName || persistedCompany.companyId}.
            </div>
          )}
        </section>
      </div>

      <div className="panel-grid">
        <section className="panel panel-stack">
          <div className="metric-label">Launch readiness</div>
          <h2 className="section-title">Use the app to see what still blocks a real client rollout.</h2>
          <div className="status-list">
            {launchChecklist.map((item) => (
              <div key={item.label} className="status-item">
                <span className="status-label">
                  <span className={`status-dot ${item.ready ? 'ok' : 'warn'}`} />
                  {item.label}
                </span>
                <span>{item.detail}</span>
              </div>
            ))}
          </div>
          <div className="action-cluster">
            {nextSetupWorkspace ? (
              <a className="button" href={`/companies#company-${nextSetupWorkspace.id}`}>
                Finish {nextSetupWorkspace.name}
              </a>
            ) : (
              <a className="button" href="/companies">
                Review companies
              </a>
            )}
            {dailyWorkspace && (
              <a className="button-secondary" href={withCompanyContext(`/conversations?companyId=${dailyWorkspace.id}`, persistedCompany?.companyId || dailyWorkspace.id)}>
                Work {persistedCompany?.companyName || dailyWorkspace.name}
              </a>
            )}
            <a className="button-ghost" href="/bookings">
              Check bookings
            </a>
          </div>
        </section>

        <section className="panel panel-stack">
          <div className="metric-label">Workspaces that need attention</div>
          <h2 className="section-title">Fix setup gaps first, then hand the operator a clean queue.</h2>
          {topWorkspaces.length === 0 ? (
            <div className="empty-state">No workspaces yet. Start by creating the first client in Companies.</div>
          ) : (
            <div className="workspace-list">
      {topWorkspaces.map((workspace) => (
                <section key={workspace.id} className="workspace-list-item">
                  <div className="workspace-list-header">
                    <strong>{workspace.name}</strong>
                    <span className={`status-chip ${workspace.missingSetupCount === 0 ? '' : 'status-chip-muted'}`}>
                      <strong>Setup</strong> {workspace.missingSetupCount === 0 ? 'ready' : `${workspace.missingSetupCount} gap${workspace.missingSetupCount === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  <div className="inline-row text-muted">
                    <span>Leads: {workspace.leads}</span>
                    <span>Threads: {workspace.conversations}</span>
                    <span>Bookings: {workspace.appointments}</span>
                  </div>
                  <div className="tiny-muted">
                    {!workspace.telnyxInboundNumber && workspace.telnyxInboundCount === 0
                      ? 'Missing inbound routing number.'
                      : !workspace.notificationEmail
                        ? 'Missing client notification email.'
                        : 'Ready for live operator work.'}
                  </div>
                  <div className="workspace-list-actions">
                    {workspace.missingSetupCount > 0 ? (
                      <a className="button" href={`/companies#company-${workspace.id}`}>
                        Finish setup
                      </a>
                    ) : (
                      <a className="button" href={`/conversations?companyId=${workspace.id}`}>
                        Work conversations
                      </a>
                    )}
                    <a className="button-secondary" href={`/leads?companyId=${workspace.id}`}>
                      Leads
                    </a>
                    <a className="button-ghost" href={`/bookings?companyId=${workspace.id}`}>
                      Bookings
                    </a>
                  </div>
                </section>
              ))}
            </div>
          )}
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
          <h2 className="section-title">The app is live, but the stack still needs attention before full production traffic.</h2>
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
