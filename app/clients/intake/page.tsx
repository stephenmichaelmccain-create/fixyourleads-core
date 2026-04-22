import { ProspectStatus } from '@prisma/client';
import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { isDemoLabel } from '@/lib/demo';
import { allInboundNumbers, hasInboundRouting } from '@/lib/inbound-numbers';
import { intakeStageDetails, normalizeClinicKey } from '@/lib/client-intake';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

const PROSPECT_META_PREFIX = 'fyl:';

function parseProspectNotes(notes?: string | null) {
  const meta: Record<string, string> = {};

  for (const line of String(notes || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(PROSPECT_META_PREFIX)) {
      continue;
    }

    const [key, ...parts] = trimmed.slice(PROSPECT_META_PREFIX.length).split('=');
    const value = parts.join('=').trim();
    if (key && value) {
      meta[key.trim()] = value;
    }
  }

  return meta;
}

function formatDateTime(value: Date | null | undefined) {
  if (!value) {
    return 'Not set';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

export default async function ClientIntakePage() {
  const [soldProspects, companies] = await Promise.all([
    safeLoad(
      () =>
        db.prospect.findMany({
          where: { status: ProspectStatus.CLOSED },
          orderBy: [{ nextActionAt: 'asc' }, { updatedAt: 'desc' }],
          take: 100
        }),
      []
    ),
    safeLoad(
      () =>
        db.company.findMany({
          orderBy: { name: 'asc' },
          include: {
            telnyxInboundNumbers: {
              select: { number: true }
            }
          }
        }),
      []
    )
  ]);

  const companyByKey = new Map(companies.map((company) => [normalizeClinicKey(company.name), company]));
  const intakeRows = soldProspects.map((prospect) => {
    const matchedCompany = companyByKey.get(normalizeClinicKey(prospect.name)) || null;
    const stage = intakeStageDetails({
      hasWorkspace: Boolean(matchedCompany),
      hasRouting: matchedCompany ? hasInboundRouting(matchedCompany) : false,
      hasNotificationEmail: Boolean(matchedCompany?.notificationEmail)
    });
    const profile = parseProspectNotes(prospect.notes);
    const inboundNumbers = matchedCompany ? allInboundNumbers(matchedCompany) : [];

    return {
      prospect,
      profile,
      matchedCompany,
      stage,
      inboundNumbers
    };
  });

  const waitingCount = intakeRows.filter((row) => row.stage.stage === 'waiting_signup').length;
  const setupPendingCount = intakeRows.filter((row) => row.stage.stage === 'setup_pending').length;
  const readyCount = intakeRows.filter((row) => row.stage.stage === 'ready').length;

  return (
    <LayoutShell
      title="Client Intake"
      description="Sold clinics waiting to sign up or finish onboarding."
      section="clients"
    >
      <div className="metric-grid">
        <section className="metric-card panel-stack">
          <div className="metric-label">Sold clinics</div>
          <div className="metric-value">{intakeRows.length}</div>
          <div className="metric-copy">Prospects already marked sold and moving toward client onboarding.</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Waiting for signup</div>
          <div className="metric-value">{waitingCount}</div>
          <div className="metric-copy">No matching client workspace has been created yet.</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Setup pending</div>
          <div className="metric-value">{setupPendingCount}</div>
          <div className="metric-copy">Workspace exists, but routing or notification email is still missing.</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Ready</div>
          <div className="metric-value">{readyCount}</div>
          <div className="metric-copy">Sold clinics already have a usable client workspace.</div>
        </section>
      </div>

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Sold to signup bridge</div>
            <h2 className="section-title">Keep sold clinics from disappearing between the call and the website signup.</h2>
            <p className="page-copy">
              This queue is the handoff from outbound sales into real client setup. It is built from sold prospects and matched against existing client workspaces.
            </p>
          </div>
          <div className="inline-actions">
            <a className="button-secondary" href="/our-leads">
              Back to Our Leads
            </a>
            <a className="button" href="/clients">
              Client workspaces
            </a>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Clinic</th>
                <th>Stage</th>
                <th>Matched workspace</th>
                <th>Source</th>
                <th>Next action</th>
              </tr>
            </thead>
            <tbody>
              {intakeRows.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">No sold prospects are waiting on signup or onboarding right now.</div>
                  </td>
                </tr>
              ) : (
                intakeRows.map((row) => (
                  <tr key={row.prospect.id}>
                    <td>
                      <div className="panel-stack" style={{ gap: 6 }}>
                        <span className="inline-row">
                          <strong>{row.prospect.name}</strong>
                          {isDemoLabel(row.prospect.name) ? <span className="status-chip status-chip-muted">Demo</span> : null}
                        </span>
                        <span className="tiny-muted">
                          {row.profile.clinic_type || 'Clinic type not set'}
                          {row.prospect.city ? ` • ${row.prospect.city}` : ''}
                          {row.profile.predicted_revenue ? ` • ${row.profile.predicted_revenue}` : ''}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="panel-stack" style={{ gap: 6 }}>
                        <span
                          className={`status-chip ${
                            row.stage.tone === 'error'
                              ? 'status-chip-attention'
                              : row.stage.tone === 'warn' || row.stage.tone === 'muted'
                                ? 'status-chip-muted'
                                : ''
                          }`}
                        >
                          {row.stage.label}
                        </span>
                        <span className="tiny-muted">{row.stage.detail}</span>
                      </div>
                    </td>
                    <td>
                      {row.matchedCompany ? (
                        <div className="panel-stack" style={{ gap: 6 }}>
                          <a className="table-link" href={`/clients/${row.matchedCompany.id}`}>
                            {row.matchedCompany.name}
                          </a>
                          <span className="tiny-muted">
                            {row.inboundNumbers.length > 0
                              ? `${row.inboundNumbers.length} routing number${row.inboundNumbers.length === 1 ? '' : 's'}`
                              : 'No routing number yet'}
                          </span>
                        </div>
                      ) : (
                        <span className="tiny-muted">No workspace yet</span>
                      )}
                    </td>
                    <td>
                      <div className="panel-stack" style={{ gap: 6 }}>
                        <span>{row.profile.source || 'Manual add'}</span>
                        <span className="tiny-muted">
                          {row.profile.import_batch || row.profile.source_record || row.prospect.lastCallOutcome || 'No source batch'}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="panel-stack" style={{ gap: 6 }}>
                        <span>{formatDateTime(row.prospect.nextActionAt)}</span>
                        <div className="inline-actions">
                          <a className="button-ghost" href={`/our-leads?prospectId=${encodeURIComponent(row.prospect.id)}`}>
                            Open lead
                          </a>
                          {row.matchedCompany ? (
                            <a className="button-ghost" href={`/clients/${row.matchedCompany.id}#setup`}>
                              Open setup
                            </a>
                          ) : null}
                        </div>
                      </div>
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
