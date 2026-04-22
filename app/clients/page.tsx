import { LayoutShell } from '@/app/components/LayoutShell';
import { createCompanyAction } from '@/app/companies/actions';
import { ProspectStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { isDemoLabel } from '@/lib/demo';
import { intakeStageDetails, normalizeClinicKey, parseProspectMetadata } from '@/lib/client-intake';
import { safeLoad } from '@/lib/ui-data';
import { allInboundNumbers, hasInboundRouting } from '@/lib/inbound-numbers';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

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

function formatRelativeTime(value: Date | null) {
  if (!value) {
    return 'No activity yet';
  }

  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
    Math.round((value.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    'day'
  );
}

export default async function ClientsPage({
  searchParams
}: {
  searchParams?: Promise<{
    notice?: string;
    clientId?: string;
  }>;
}) {
  const params = (await searchParams) || {};
  const notice = params.notice || '';

  if (params.clientId) {
    redirect(`/clients/${params.clientId}`);
  }

  const weekStart = startOfTrailingDays(7);
  const idleThreshold = new Date(Date.now() - 1000 * 60 * 60 * 48);

  const clients = await safeLoad(
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
          events: {
            select: { createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        }
      }),
    []
  );

  const clientIds = clients.map((client) => client.id);
  const [leadsThisWeekRows, bookingsThisWeekRows, soldProspects] = await Promise.all([
    clientIds.length > 0
      ? safeLoad(
          () =>
            db.lead.groupBy({
              by: ['companyId'],
              where: {
                companyId: { in: clientIds },
                createdAt: { gte: weekStart }
              },
              _count: { _all: true }
            }),
          []
        )
      : Promise.resolve([]),
    clientIds.length > 0
      ? safeLoad(
          () =>
            db.appointment.groupBy({
              by: ['companyId'],
              where: {
                companyId: { in: clientIds },
                createdAt: { gte: weekStart }
              },
              _count: { _all: true }
            }),
          []
        )
      : Promise.resolve([]),
    safeLoad(
      () =>
        db.prospect.findMany({
          where: { status: ProspectStatus.CLOSED },
          select: {
            id: true,
            name: true,
            notes: true,
            nextActionAt: true
          },
          orderBy: [{ nextActionAt: 'asc' }, { updatedAt: 'desc' }],
          take: 100
        }),
      []
    )
  ]);

  const leadsThisWeek = new Map(leadsThisWeekRows.map((row) => [row.companyId, row._count._all]));
  const bookingsThisWeek = new Map(bookingsThisWeekRows.map((row) => [row.companyId, row._count._all]));
  const companyByKey = new Map(clients.map((client) => [normalizeClinicKey(client.name), client]));
  const intakeRows = soldProspects.map((prospect) => {
    const matchedCompany = companyByKey.get(normalizeClinicKey(prospect.name)) || null;
    const profile = parseProspectMetadata(prospect.notes);
    const stage = intakeStageDetails({
      hasWorkspace: Boolean(matchedCompany),
      hasRouting: matchedCompany ? hasInboundRouting(matchedCompany) : false,
      hasNotificationEmail: Boolean(matchedCompany?.notificationEmail),
      hasSignupReceived: Boolean(profile.signup_received_at)
    });

    return { prospect, matchedCompany, stage };
  });
  const intakeCounts = {
    waiting: intakeRows.filter((row) => row.stage.stage === 'waiting_signup').length,
    setup: intakeRows.filter((row) => row.stage.stage === 'setup_pending' || row.stage.stage === 'workspace_created').length,
    ready: intakeRows.filter((row) => row.stage.stage === 'ready').length
  };

  const rows = clients.map((client) => {
    const missingSetup = [
      !hasInboundRouting(client) ? 'routing' : null,
      !client.notificationEmail ? 'email' : null
    ].filter(Boolean) as string[];
    const lastActivityAt = latestDate([
      client.events[0]?.createdAt,
      client.appointments[0]?.createdAt,
      client.leads[0]?.createdAt
    ]);
    const idle = !lastActivityAt || lastActivityAt < idleThreshold;
    const tone = missingSetup.length > 0 ? 'error' : idle ? 'warn' : 'ok';
    const inboundNumbers = allInboundNumbers(client);

    return {
      id: client.id,
      name: client.name,
      tone,
      leadsThisWeek: leadsThisWeek.get(client.id) || 0,
      bookingsThisWeek: bookingsThisWeek.get(client.id) || 0,
      lastActivityAt,
      setupSummary:
        missingSetup.length > 0
          ? `Missing ${missingSetup.join(' + ')}`
          : idle
            ? 'No activity in the last 48h'
            : `${inboundNumbers.length || 0} inbound number${inboundNumbers.length === 1 ? '' : 's'} connected`
    };
  });

  return (
    <LayoutShell
      title="Clients"
      description="Paying med spa workspaces, with setup health and weekly performance in one list."
      section="clients"
    >
      {notice && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className={`status-dot ${notice === 'duplicate_routing' ? 'warn' : 'ok'}`} />
            <strong>
              {notice === 'duplicate_routing'
                ? 'That inbound number is already assigned to another client.'
                : notice === 'created'
                  ? 'Client created.'
                  : 'Client updated.'}
            </strong>
          </div>
          <div className="text-muted">
            {notice === 'duplicate_routing'
              ? 'Every client needs unique Telnyx routing so replies land in the right workspace.'
              : 'The client workspace is ready for the new Clients navigation.'}
          </div>
        </section>
      )}

      <div className="panel-grid clients-page-grid">
        <section className="panel panel-stack">
          <div className="record-header">
            <div className="panel-stack">
              <div className="metric-label">Client workspaces</div>
              <h2 className="section-title">Delivery clients live here.</h2>
              <p className="page-copy">
                Each row is a paying client we run lead response and booking for. Open a client to work leads, transcripts, sequences, bookings, and setup in one place.
              </p>
            </div>
            <span className="status-chip status-chip-muted">
              <strong>Total</strong> {rows.length}
            </span>
          </div>

          <section className="context-alert is-compact">
            <div className="panel-stack">
              <div className="metric-label">Client intake bridge</div>
              <div>
                {intakeRows.length} sold clinic{intakeRows.length === 1 ? '' : 's'} moving from outbound into signup and onboarding
              </div>
              <div className="tiny-muted">
                {intakeCounts.waiting} waiting for signup • {intakeCounts.setup} setup pending • {intakeCounts.ready} ready
              </div>
            </div>
            <div className="inline-actions">
              <a className="button-secondary" href="/clients/intake">
                Open intake queue
              </a>
            </div>
          </section>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Leads this week</th>
                  <th>Bookings this week</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="empty-state">No clients yet. Add the first client workspace to get started.</div>
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} id={`client-${row.id}`}>
                      <td>
                        <div className="panel-stack" style={{ gap: 6 }}>
                          <a className="table-link" href={`/clients/${row.id}`}>
                            <span className="inline-row">
                              <strong>{row.name}</strong>
                              {isDemoLabel(row.name) ? <span className="status-chip status-chip-muted">Demo</span> : null}
                            </span>
                          </a>
                          <a className="tiny-muted" href={`/diagnostics/clients/${row.id}`}>
                            Open health view
                          </a>
                        </div>
                      </td>
                      <td>
                        <span className={`status-chip ${row.tone === 'error' ? 'status-chip-attention' : row.tone === 'warn' ? 'status-chip-muted' : ''}`}>
                          <span className={`status-dot ${row.tone === 'error' ? 'error' : row.tone === 'warn' ? 'warn' : 'ok'}`} />
                          {row.setupSummary}
                        </span>
                      </td>
                      <td>{row.leadsThisWeek}</td>
                      <td>{row.bookingsThisWeek}</td>
                      <td>{formatRelativeTime(row.lastActivityAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <form action={createCompanyAction} className="panel panel-stack">
          <div className="metric-label">Add client</div>
          <h2 className="section-title">Create a new paying client workspace.</h2>
          <div className="field-stack">
            <label className="key-value-label" htmlFor="client-name">
              Client name
            </label>
            <input id="client-name" className="text-input" name="name" placeholder="Denver South Hair Clinic" />
          </div>
          <div className="field-stack">
            <label className="key-value-label" htmlFor="client-email">
              Notification email
            </label>
            <input id="client-email" className="text-input" name="notificationEmail" placeholder="appointments@client.com" />
          </div>
          <div className="field-stack">
            <label className="key-value-label" htmlFor="client-routing">
              Telnyx inbound numbers
            </label>
            <textarea
              id="client-routing"
              className="text-area"
              name="telnyxInboundNumber"
              placeholder="+13125550001&#10;+13125550002"
              rows={3}
            />
          </div>
          <div className="inline-actions">
            <button type="submit" className="button" name="nextSurface" value="conversations">
              Save and open client
            </button>
            <button type="submit" className="button-secondary">
              Save
            </button>
          </div>
        </form>
      </div>
    </LayoutShell>
  );
}
