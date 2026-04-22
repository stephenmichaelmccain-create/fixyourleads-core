import { LayoutShell } from './components/LayoutShell';
import { ProspectStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { intakeStageDetails, normalizeClinicKey, parseProspectMetadata } from '@/lib/client-intake';
import { isDemoLabel } from '@/lib/demo';
import { safeLoad } from '@/lib/ui-data';
import { hasInboundRouting } from '@/lib/inbound-numbers';

export const dynamic = 'force-dynamic';

const activeProspectStatuses: ProspectStatus[] = [
  ProspectStatus.NEW,
  ProspectStatus.NO_ANSWER,
  ProspectStatus.VM_LEFT,
  ProspectStatus.GATEKEEPER,
  ProspectStatus.BOOKED_DEMO
];

function formatRelativeTime(value: Date | string | null) {
  if (!value) {
    return 'No activity yet';
  }

  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffHours = Math.max(1, Math.round(diffMs / (1000 * 60 * 60)));

  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function startOfTrailingDays(days: number) {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() - (days - 1));
  return value;
}

function latestDate(values: Array<Date | null | undefined>) {
  const valid = values.filter((value): value is Date => Boolean(value));

  if (valid.length === 0) {
    return null;
  }

  return new Date(Math.max(...valid.map((value) => value.getTime())));
}

export default async function HomePage() {
  const weekStart = startOfTrailingDays(7);
  const idleThreshold = new Date(Date.now() - 1000 * 60 * 60 * 48);
  const [clients, leadsThisWeek, bookingsThisWeek, activeProspects, callsThisWeek, demosBookedThisWeek, soldProspects] = await Promise.all([
    safeLoad(
      () =>
        db.company.findMany({
          orderBy: { name: 'asc' },
          include: {
            telnyxInboundNumbers: {
              select: { number: true }
            },
            leads: {
              select: { createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 1
            },
            appointments: {
              select: { createdAt: true, startTime: true },
              orderBy: [{ createdAt: 'desc' }, { startTime: 'desc' }],
              take: 1
            },
            conversations: {
              select: { createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 1
            },
            events: {
              select: { createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 1
            },
            _count: {
              select: {
                leads: true,
                appointments: true
              }
            }
          }
        }),
      []
    ),
    safeLoad(
      () =>
        db.lead.count({
          where: {
            createdAt: {
              gte: weekStart
            }
          }
        }),
      0
    ),
    safeLoad(
      () =>
        db.appointment.count({
          where: {
            createdAt: {
              gte: weekStart
            }
          }
        }),
      0
    ),
    safeLoad(
      () =>
        db.prospect.count({
          where: {
            status: {
              in: activeProspectStatuses
            }
          }
        }),
      0
    ),
    safeLoad(
      () =>
        db.callLog.count({
          where: {
            createdAt: {
              gte: weekStart
            }
          }
        }),
      0
    ),
    safeLoad(
      () =>
        db.prospect.count({
          where: {
            status: ProspectStatus.BOOKED_DEMO
          }
        }),
      0
    ),
    safeLoad(
      () =>
        db.prospect.findMany({
          where: {
            status: ProspectStatus.CLOSED
          },
          select: {
            id: true,
            name: true,
            notes: true
          }
        }),
      []
    )
  ]);

  const companyByKey = new Map(clients.map((client) => [normalizeClinicKey(client.name), client]));
  const intakeCounts = soldProspects.reduce(
    (acc, prospect) => {
      const matchedCompany = companyByKey.get(normalizeClinicKey(prospect.name)) || null;
      const profile = parseProspectMetadata(prospect.notes);
      const stage = intakeStageDetails({
        hasWorkspace: Boolean(matchedCompany),
        hasRouting: matchedCompany ? hasInboundRouting(matchedCompany) : false,
        hasNotificationEmail: Boolean(matchedCompany?.notificationEmail),
        hasSignupReceived: Boolean(profile.signup_received_at)
      });
      acc.total += 1;
      if (stage.stage === 'waiting_signup') {
        acc.waiting += 1;
      } else if (stage.stage === 'setup_pending' || stage.stage === 'workspace_created') {
        acc.setup += 1;
      } else if (stage.stage === 'ready') {
        acc.ready += 1;
      }
      return acc;
    },
    { total: 0, waiting: 0, setup: 0, ready: 0 }
  );

  const needsAttention = clients
    .map((client) => {
      const lastActivityAt = latestDate([
        client.events[0]?.createdAt,
        client.conversations[0]?.createdAt,
        client.appointments[0]?.createdAt,
        client.leads[0]?.createdAt
      ]);
      const missingSetup = [
        !hasInboundRouting(client) ? 'Inbound routing' : null,
        !client.notificationEmail ? 'Notification email' : null
      ].filter(Boolean) as string[];
      const idle = !lastActivityAt || lastActivityAt < idleThreshold;

      return {
        id: client.id,
        name: client.name,
        leads: client._count.leads,
        bookings: client._count.appointments,
        lastActivityAt,
        missingSetup,
        idle
      };
    })
    .filter((client) => client.missingSetup.length > 0 || client.idle)
    .sort((left, right) => {
      if (left.missingSetup.length !== right.missingSetup.length) {
        return right.missingSetup.length - left.missingSetup.length;
      }

      const leftTime = left.lastActivityAt ? left.lastActivityAt.getTime() : 0;
      const rightTime = right.lastActivityAt ? right.lastActivityAt.getTime() : 0;
      return leftTime - rightTime;
    })
    .slice(0, 6);

  return (
    <LayoutShell
      title="Run delivery for clients and pipeline for Fix Your Leads in one place."
      description="Clients are the med spas we serve. Our Leads are the med spas we are selling to. Keep both sides visible without clutter."
      section="home"
    >
      <div className="metric-grid metric-grid-home">
        <section className="metric-card metric-card-dark">
          <div className="metric-label">Active clients</div>
          <div className="metric-value">{clients.length}</div>
          <div className="metric-copy">Paying workspaces actively running lead response and booking.</div>
        </section>
        <section className="metric-card">
          <div className="metric-label">Leads processed this week</div>
          <div className="metric-value">{leadsThisWeek}</div>
          <div className="metric-copy">Client-side lead records that entered the system in the last 7 days.</div>
        </section>
        <section className="metric-card">
          <div className="metric-label">Bookings created this week</div>
          <div className="metric-value">{bookingsThisWeek}</div>
          <div className="metric-copy">Appointments created for paying clients in the last 7 days.</div>
        </section>
        <section className="metric-card">
          <div className="metric-label">Active prospects</div>
          <div className="metric-value">{activeProspects}</div>
          <div className="metric-copy">Med spas still live in the Fix Your Leads sales pipeline.</div>
        </section>
        <section className="metric-card">
          <div className="metric-label">Calls made this week</div>
          <div className="metric-value">{callsThisWeek}</div>
          <div className="metric-copy">Logged outbound sales calls against our own prospects this week.</div>
        </section>
        <section className="metric-card">
          <div className="metric-label">Demos booked</div>
          <div className="metric-value">{demosBookedThisWeek}</div>
          <div className="metric-copy">Prospects currently marked as demo-booked in our pipeline.</div>
        </section>
        <section className="metric-card">
          <div className="metric-label">Sold waiting intake</div>
          <div className="metric-value">{intakeCounts.total}</div>
          <div className="metric-copy">
            {intakeCounts.waiting} waiting for signup • {intakeCounts.setup} setup pending • {intakeCounts.ready} ready
          </div>
        </section>
      </div>

      <div className="panel-grid">
        <section className="panel panel-dark panel-stack">
          <div className="metric-label">Two operating lanes</div>
          <h2 className="section-title section-title-large">Clients are delivery. Our Leads are growth.</h2>
          <p className="metric-copy">
            Keep the med spas we serve separate from the med spas we are selling to. The app should make that obvious on every screen.
          </p>
          <div className="inline-actions">
            <a className="button" href="/clients">
              Open clients
            </a>
            <a className="button-secondary" href="/our-leads">
              Open our leads
            </a>
            <a className="button-secondary" href="/clients/intake">
              Client intake
            </a>
            <a className="button-ghost" href="/diagnostics">
              Diagnostics
            </a>
          </div>
        </section>

        <section className="panel panel-stack">
          <div className="metric-label">Needs attention</div>
          <h2 className="section-title">Start with broken setup or clients that have gone quiet.</h2>
          {needsAttention.length === 0 ? (
            <div className="empty-state">No clients need attention right now.</div>
          ) : (
            <div className="workspace-list">
              {needsAttention.map((client) => (
                <a key={client.id} className="workspace-list-item" href={`/clients/${client.id}`}>
                  <div className="workspace-list-header">
                    <div className="inline-row">
                      <strong>{client.name}</strong>
                      {isDemoLabel(client.name) ? <span className="status-chip status-chip-muted">Demo</span> : null}
                    </div>
                    <span className={`status-chip ${client.missingSetup.length > 0 ? 'status-chip-attention' : 'status-chip-muted'}`}>
                      {client.missingSetup.length > 0 ? 'Setup gap' : 'Low activity'}
                    </span>
                  </div>
                  <div className="tiny-muted">
                    {client.missingSetup.length > 0
                      ? client.missingSetup.join(', ')
                      : `No activity in ${formatRelativeTime(client.lastActivityAt)}`}
                  </div>
                  <div className="inline-row text-muted">
                    <span>Leads: {client.leads}</span>
                    <span>Bookings: {client.bookings}</span>
                    <span>Last activity: {formatRelativeTime(client.lastActivityAt)}</span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>
      </div>
    </LayoutShell>
  );
}
