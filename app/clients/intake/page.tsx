import { LayoutShell } from '@/app/components/LayoutShell';
import { approveSignupSubmissionAction } from '@/app/clients/intake/actions';
import { db } from '@/lib/db';
import { humanizeIntakeSource } from '@/lib/client-intake';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

function readPayloadRecord(payload: unknown) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

function payloadString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === 'string' ? value.trim() : '';
}

export default async function ClientIntakePage() {
  const [companies, signupEvents, approvedEvents] = await Promise.all([
    safeLoad(
      () =>
        db.company.findMany({
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            notificationEmail: true,
            createdAt: true
          }
        }),
      []
    ),
    safeLoad(
      () =>
        db.eventLog.findMany({
          where: { eventType: 'client_signup_received' },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: {
            id: true,
            companyId: true,
            createdAt: true,
            payload: true
          }
        }),
      []
    ),
    safeLoad(
      () =>
        db.eventLog.findMany({
          where: { eventType: 'client_signup_approved' },
          orderBy: { createdAt: 'desc' },
          take: 200,
          select: {
            id: true,
            companyId: true,
            createdAt: true,
            payload: true
          }
        }),
      []
    )
  ]);

  const companyById = new Map(companies.map((company) => [company.id, company]));
  const approvedEventByCompanyId = new Map<string, { id: string; createdAt: Date }>();

  for (const event of approvedEvents) {
    if (!approvedEventByCompanyId.has(event.companyId)) {
      approvedEventByCompanyId.set(event.companyId, { id: event.id, createdAt: event.createdAt });
    }
  }

  const signupRows = signupEvents.map((event) => {
    const payload = readPayloadRecord(event.payload);
    const company = companyById.get(event.companyId) || null;
    const approval = approvedEventByCompanyId.get(event.companyId) || null;

    return {
      id: event.id,
      companyId: event.companyId,
      clinicName: payloadString(payload, 'clinicName') || company?.name || 'Signup',
      contactName: payloadString(payload, 'contactName'),
      notificationEmail: payloadString(payload, 'notificationEmail') || company?.notificationEmail || '',
      phone: payloadString(payload, 'phone'),
      website: payloadString(payload, 'website'),
      source: payloadString(payload, 'source') || 'website',
      receivedAt: payloadString(payload, 'signupReceivedAt') || event.createdAt.toISOString(),
      approvedAt: approval?.createdAt || null
    };
  });
  const approvedRows = signupRows.filter((row) => row.approvedAt);

  return (
    <LayoutShell title="Client Intake" section="clients" hidePageHeader>
      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Website</div>
            <h2 className="section-title">Signup submissions</h2>
          </div>
          <span className="status-chip">
            <strong>{signupRows.length}</strong> signups
          </span>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Clinic</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Website</th>
                <th>Received</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {signupRows.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">No website signup submissions yet.</div>
                  </td>
                </tr>
              ) : (
                signupRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="record-stack" style={{ gap: 6 }}>
                        <div className="inline-row inline-actions-wrap">
                          <strong>{row.clinicName}</strong>
                          {row.approvedAt ? (
                            <span className="status-chip status-chip-muted">
                              <strong>Approved</strong>
                            </span>
                          ) : (
                            <form action={approveSignupSubmissionAction}>
                              <input type="hidden" name="companyId" value={row.companyId} />
                              <input type="hidden" name="signupEventId" value={row.id} />
                              <button type="submit" className="button-secondary">
                                Approve
                              </button>
                            </form>
                          )}
                        </div>
                        <span className="tiny-muted">{humanizeIntakeSource(row.source)}</span>
                      </div>
                    </td>
                    <td>{row.contactName || '—'}</td>
                    <td>{row.notificationEmail || '—'}</td>
                    <td>{row.phone || '—'}</td>
                    <td>{row.website || '—'}</td>
                    <td className="tiny-muted">{formatDateTime(row.receivedAt)}</td>
                    <td>
                      <a className="button-ghost" href={`/clients/${row.companyId}#setup`}>
                        Open workspace
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Website</div>
            <h2 className="section-title">Approved signups</h2>
          </div>
          <span className="status-chip">
            <strong>{approvedRows.length}</strong> approved
          </span>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Clinic</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Website</th>
                <th>Approved</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {approvedRows.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">No approved signup clients yet.</div>
                  </td>
                </tr>
              ) : (
                approvedRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="record-stack" style={{ gap: 6 }}>
                        <strong>{row.clinicName}</strong>
                        <span className="tiny-muted">{humanizeIntakeSource(row.source)}</span>
                      </div>
                    </td>
                    <td>{row.contactName || '—'}</td>
                    <td>{row.notificationEmail || '—'}</td>
                    <td>{row.phone || '—'}</td>
                    <td>{row.website || '—'}</td>
                    <td className="tiny-muted">{formatDateTime(row.approvedAt)}</td>
                    <td>
                      <a className="button-ghost" href={`/clients/${row.companyId}#setup`}>
                        Open workspace
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </LayoutShell>
  );
}
