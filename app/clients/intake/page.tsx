import { ProspectStatus } from '@prisma/client';
import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { createClientFromProspectAction } from '@/app/clients/intake/actions';
import { isDemoLabel } from '@/lib/demo';
import { allInboundNumbers, hasInboundRouting } from '@/lib/inbound-numbers';
import {
  humanizeIntakeSource,
  intakeStageDetails,
  normalizeClinicKey,
  parseProspectMetadata
} from '@/lib/client-intake';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

function formatDateTime(value: Date | string | null | undefined) {
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
  const [soldProspects, companies, signupEvents, onboardingEvents] = await Promise.all([
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
    ),
    safeLoad(
      () =>
        db.eventLog.findMany({
          where: {
            eventType: 'client_signup_received'
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
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
          where: {
            eventType: 'client_onboarding_received'
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
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

  const companyByKey = new Map(companies.map((company) => [normalizeClinicKey(company.name), company]));
  const latestOnboardingByCompanyId = new Map(
    onboardingEvents.map((event) => {
      const payload =
        event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
          ? (event.payload as Record<string, unknown>)
          : {};

      return [
        event.companyId,
        {
          receivedAt:
            typeof payload.onboardingReceivedAt === 'string' ? payload.onboardingReceivedAt : event.createdAt.toISOString(),
          payload
        }
      ] as const;
    })
  );
  const intakeRows = soldProspects.map((prospect) => {
    const matchedCompany = companyByKey.get(normalizeClinicKey(prospect.name)) || null;
    const profile = parseProspectMetadata(prospect.notes);
    const onboardingEvent = matchedCompany ? latestOnboardingByCompanyId.get(matchedCompany.id) || null : null;
    const mergedProfile = {
      ...profile,
      onboarding_received_at: onboardingEvent?.receivedAt || profile.onboarding_received_at || '',
      business_type:
        typeof onboardingEvent?.payload.businessType === 'string'
          ? onboardingEvent.payload.businessType
          : profile.business_type || '',
      campaign_use_case:
        typeof onboardingEvent?.payload.campaignUseCase === 'string'
          ? onboardingEvent.payload.campaignUseCase
          : profile.campaign_use_case || ''
    } as Record<string, string>;
    const stage = intakeStageDetails({
      hasWorkspace: Boolean(matchedCompany),
      hasRouting: matchedCompany ? hasInboundRouting(matchedCompany) : false,
      hasNotificationEmail: Boolean(matchedCompany?.notificationEmail),
      hasSignupReceived: Boolean(profile.signup_received_at),
      hasOnboardingReceived: Boolean(onboardingEvent)
    });
    const inboundNumbers = matchedCompany ? allInboundNumbers(matchedCompany) : [];

    return {
      rowId: `prospect:${prospect.id}`,
      prospect,
      profile: mergedProfile,
      matchedCompany,
      stage,
      inboundNumbers,
      signupReceivedAt: mergedProfile.signup_received_at || null,
      onboardingReceivedAt: mergedProfile.onboarding_received_at || null
    };
  });

  const matchedCompanyIds = new Set(intakeRows.map((row) => row.matchedCompany?.id).filter(Boolean));
  const directSignupRows = signupEvents.flatMap((event) => {
    if (matchedCompanyIds.has(event.companyId)) {
      return [];
    }

    const matchedCompany = companies.find((company) => company.id === event.companyId) || null;

    if (!matchedCompany) {
      return [];
    }

    const payload =
      event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
        ? (event.payload as Record<string, unknown>)
        : {};

    const stage = intakeStageDetails({
      hasWorkspace: true,
      hasRouting: hasInboundRouting(matchedCompany),
      hasNotificationEmail: Boolean(matchedCompany.notificationEmail),
      hasSignupReceived: true,
      hasOnboardingReceived: Boolean(latestOnboardingByCompanyId.get(matchedCompany.id))
    });
    const onboardingEvent = latestOnboardingByCompanyId.get(matchedCompany.id) || null;

    return [
      {
        rowId: `signup:${event.id}`,
        prospect: null,
        profile: {
          source: String(payload.source || 'website'),
          clinic_type: '',
          predicted_revenue: '',
          import_batch: '',
          source_record: '',
          signup_contact_name: String(payload.contactName || ''),
          signup_notification_email: String(payload.notificationEmail || ''),
          signup_phone: String(payload.phone || ''),
          signup_website: String(payload.website || ''),
          onboarding_received_at: onboardingEvent?.receivedAt || '',
          business_type:
            typeof onboardingEvent?.payload.businessType === 'string'
              ? onboardingEvent.payload.businessType
              : '',
          campaign_use_case:
            typeof onboardingEvent?.payload.campaignUseCase === 'string'
              ? onboardingEvent.payload.campaignUseCase
              : ''
        } as Record<string, string>,
        matchedCompany,
        stage,
        inboundNumbers: allInboundNumbers(matchedCompany),
        signupReceivedAt:
          typeof payload.signupReceivedAt === 'string' ? payload.signupReceivedAt : event.createdAt.toISOString(),
        onboardingReceivedAt: onboardingEvent?.receivedAt || null
      }
    ];
  });
  const allRows = [...intakeRows, ...directSignupRows].sort((a, b) =>
    String(b.signupReceivedAt || '').localeCompare(String(a.signupReceivedAt || ''))
  );

  const waitingCount = allRows.filter((row) => row.stage.stage === 'waiting_signup').length;
  const setupPendingCount = allRows.filter((row) => row.stage.stage === 'setup_pending').length;
  const readyCount = allRows.filter((row) => row.stage.stage === 'ready').length;

  return (
    <LayoutShell
      title="Client Intake"
      description="Sold clinics waiting to sign up or finish onboarding."
      section="clients"
    >
      <div className="metric-grid">
        <section className="metric-card panel-stack">
          <div className="metric-label">Sold clinics</div>
          <div className="metric-value">{allRows.length}</div>
          <div className="metric-copy">Sold prospects and direct signups moving toward client onboarding.</div>
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
              This queue is the handoff from outbound sales into real client setup. It combines sold prospects with direct signup events so nothing disappears between the close and onboarding.
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
              {allRows.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">No sold prospects are waiting on signup or onboarding right now.</div>
                  </td>
                </tr>
              ) : (
                allRows.map((row) => (
                  <tr key={row.rowId}>
                    <td>
                      <div className="panel-stack" style={{ gap: 6 }}>
                        <span className="inline-row">
                          <strong>{row.matchedCompany?.name || row.prospect?.name || 'Signup in flight'}</strong>
                          {isDemoLabel(row.matchedCompany?.name || row.prospect?.name || '')
                            ? <span className="status-chip status-chip-muted">Demo</span>
                            : null}
                          {!row.prospect ? <span className="status-chip status-chip-muted">Direct signup</span> : null}
                        </span>
                        <span className="tiny-muted">
                          {row.profile.clinic_type || row.profile.business_type || 'Clinic type not set'}
                          {row.prospect?.city ? ` • ${row.prospect.city}` : ''}
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
                        <span>{humanizeIntakeSource(row.profile.source)}</span>
                        <span className="tiny-muted">
                          {row.onboardingReceivedAt
                            ? `Onboarding received ${formatDateTime(row.onboardingReceivedAt)}`
                            : row.signupReceivedAt
                              ? `Signup received ${formatDateTime(row.signupReceivedAt)}`
                            : row.profile.import_batch ||
                              row.profile.source_record ||
                              row.prospect?.lastCallOutcome ||
                              'No source batch'}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="panel-stack" style={{ gap: 6 }}>
                        <span>{formatDateTime(row.prospect?.nextActionAt || row.signupReceivedAt)}</span>
                        {row.profile.campaign_use_case ? (
                          <span className="tiny-muted">{row.profile.campaign_use_case}</span>
                        ) : null}
                        <div className="inline-actions">
                          {row.prospect ? (
                            <a
                              className="button-ghost"
                              href={`/our-leads?prospectId=${encodeURIComponent(row.prospect.id)}`}
                            >
                              Open lead
                            </a>
                          ) : (
                            <a className="button-ghost" href={`/clients/${row.matchedCompany?.id}#setup`}>
                              Open signup
                            </a>
                          )}
                          {row.matchedCompany ? (
                            <a className="button-ghost" href={`/clients/${row.matchedCompany.id}#setup`}>
                              Open setup
                            </a>
                          ) : (
                            <form action={createClientFromProspectAction}>
                              <input type="hidden" name="prospectId" value={row.prospect?.id || ''} />
                              <button type="submit" className="button-secondary">
                                Create workspace
                              </button>
                            </form>
                          )}
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
