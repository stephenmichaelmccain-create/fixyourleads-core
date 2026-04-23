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
          where: { eventType: 'client_signup_received' },
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
          where: { eventType: 'client_onboarding_received' },
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

    return {
      rowId: `prospect:${prospect.id}`,
      prospect,
      profile: mergedProfile,
      matchedCompany,
      stage,
      inboundNumbers: matchedCompany ? allInboundNumbers(matchedCompany) : [],
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
    const onboardingEvent = latestOnboardingByCompanyId.get(matchedCompany.id) || null;
    const stage = intakeStageDetails({
      hasWorkspace: true,
      hasRouting: hasInboundRouting(matchedCompany),
      hasNotificationEmail: Boolean(matchedCompany.notificationEmail),
      hasSignupReceived: true,
      hasOnboardingReceived: Boolean(onboardingEvent)
    });

    return [
      {
        rowId: `signup:${event.id}`,
        prospect: null,
        profile: {
          source: String(payload.source || 'website'),
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

  const blockedRows = allRows
    .filter((row) => row.stage.stage !== 'ready')
    .sort((left, right) => {
      const stageRank = {
        waiting_signup: 0,
        workspace_created: 1,
        setup_pending: 2,
        ready: 3
      } as const;

      if (stageRank[left.stage.stage] !== stageRank[right.stage.stage]) {
        return stageRank[left.stage.stage] - stageRank[right.stage.stage];
      }

      return String(right.signupReceivedAt || '').localeCompare(String(left.signupReceivedAt || ''));
    });

  const waitingCount = blockedRows.filter((row) => row.stage.stage === 'waiting_signup').length;
  const onboardingMissingCount = blockedRows.filter((row) => row.stage.stage === 'workspace_created').length;
  const setupPendingCount = blockedRows.filter((row) => row.stage.stage === 'setup_pending').length;
  const readyCount = allRows.filter((row) => row.stage.stage === 'ready').length;

  return (
    <LayoutShell title="Client Intake" section="clients">
      <section className="panel panel-stack">
        <div className="metric-label">Blocked before go-live</div>
        <h2 className="section-title">Clinics still waiting on signup, onboarding, or setup.</h2>
        <div className="prospect-stats-strip">
          <span><strong>{blockedRows.length}</strong> blocked</span>
          <span><strong>{waitingCount}</strong> waiting for signup</span>
          <span><strong>{onboardingMissingCount}</strong> onboarding not finished</span>
          <span><strong>{setupPendingCount}</strong> setup pending</span>
          <span><strong>{readyCount}</strong> ready</span>
        </div>
      </section>

      <section className="panel panel-stack">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Clinic</th>
                <th>Stage</th>
                <th>Signup</th>
                <th>Onboarding</th>
                <th>Next action</th>
              </tr>
            </thead>
            <tbody>
              {blockedRows.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">No clinics are currently blocked on signup, onboarding, or final setup.</div>
                  </td>
                </tr>
              ) : (
                blockedRows.map((row) => (
                  <tr key={row.rowId}>
                    <td>
                      <div className="record-stack">
                        <span className="inline-row">
                          <strong>{row.matchedCompany?.name || row.prospect?.name || 'Signup in flight'}</strong>
                          {isDemoLabel(row.matchedCompany?.name || row.prospect?.name || '') ? (
                            <span className="status-chip status-chip-muted">Demo</span>
                          ) : null}
                          {!row.prospect ? <span className="status-chip status-chip-muted">Direct signup</span> : null}
                        </span>
                        <span className="tiny-muted">
                          {row.profile.business_type || row.profile.clinic_type || 'Clinic'}
                          {row.prospect?.city ? ` · ${row.prospect.city}` : ''}
                        </span>
                        <span className="tiny-muted">
                          {row.matchedCompany
                            ? `${row.matchedCompany.name} · ${
                                row.inboundNumbers.length > 0
                                  ? `${row.inboundNumbers.length} number${row.inboundNumbers.length === 1 ? '' : 's'}`
                                  : 'No routing number yet'
                              }`
                            : 'No workspace yet'}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="record-stack">
                        <span className={`status-chip${row.stage.tone === 'ok' ? '' : ' status-chip-muted'}`}>{row.stage.label}</span>
                        <span className="tiny-muted">{row.stage.detail}</span>
                      </div>
                    </td>
                    <td>
                      <div className="record-stack">
                        <span>{row.signupReceivedAt ? formatDateTime(row.signupReceivedAt) : 'Not received yet'}</span>
                        <span className="tiny-muted">{humanizeIntakeSource(row.profile.source)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="record-stack">
                        <span>{row.onboardingReceivedAt ? formatDateTime(row.onboardingReceivedAt) : 'Not finished yet'}</span>
                        <span className="tiny-muted">{row.profile.campaign_use_case || 'Onboarding still needed'}</span>
                      </div>
                    </td>
                    <td>
                      <div className="record-stack">
                        <span className="tiny-muted">
                          {!row.matchedCompany
                            ? 'Create workspace'
                            : row.stage.stage === 'workspace_created'
                              ? 'Finish onboarding form'
                              : row.stage.stage === 'setup_pending'
                                ? 'Finish setup'
                                : 'Open workspace'}
                        </span>
                        <div className="inline-actions inline-actions-wrap">
                          {!row.matchedCompany && row.prospect ? (
                            <form action={createClientFromProspectAction}>
                              <input type="hidden" name="prospectId" value={row.prospect.id} />
                              <button type="submit" className="button-secondary">Create workspace</button>
                            </form>
                          ) : null}
                          {row.matchedCompany ? (
                            <a className="button-ghost" href={`/clients/${row.matchedCompany.id}#setup`}>
                              Open workspace
                            </a>
                          ) : null}
                          {row.prospect ? (
                            <a className="button-ghost" href={`/leads?prospectId=${row.prospect.id}`}>
                              Open lead
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
