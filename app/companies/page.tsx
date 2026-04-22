import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { safeLoad } from '@/lib/ui-data';
import { formatInboundNumbersForInput, hasInboundRouting } from '@/lib/inbound-numbers';
import { createCompanyAction, updateCompanyAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function CompaniesPage({
  searchParams
}: {
  searchParams?: Promise<{
    notice?: string;
    companyId?: string;
  }>;
}) {
  const params = (await searchParams) || {};
  const notice = params.notice || '';
  const sharedSenderAvailable = Boolean(process.env.TELNYX_FROM_NUMBER?.trim());
  const companies = await safeLoad(
    () =>
      db.company.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          telnyxInboundNumbers: {
            select: { number: true },
            orderBy: { createdAt: 'asc' }
          },
          _count: {
            select: {
              leads: true,
              conversations: true,
              appointments: true
            }
          }
        }
      }),
    []
  );
  const rankedCompanies = [...companies].sort((left, right) => {
    const leftMissing = Number(!hasInboundRouting(left)) + Number(!left.notificationEmail);
    const rightMissing = Number(!hasInboundRouting(right)) + Number(!right.notificationEmail);

    if (leftMissing !== rightMissing) {
      return rightMissing - leftMissing;
    }

    return left.name.localeCompare(right.name);
  });
  const readyCompanies = companies.filter((company) => company.notificationEmail && hasInboundRouting(company)).length;
  const missingRouting = companies.filter((company) => !hasInboundRouting(company)).length;
  const missingNotifications = companies.filter((company) => !company.notificationEmail).length;
  const nextSetupWorkspace =
    rankedCompanies.find((company) => !hasInboundRouting(company) || !company.notificationEmail) || null;
  const firstReadyWorkspace =
    rankedCompanies.find((company) => company.notificationEmail && hasInboundRouting(company)) || null;
  const setupSprintCompanies = rankedCompanies
    .filter((company) => !hasInboundRouting(company) || !company.notificationEmail)
    .slice(0, 4);
  const companyIds = companies.map((company) => company.id);
  const readyLeadStatusRows = await safeLoad(
    () =>
      db.lead.groupBy({
        by: ['companyId', 'status'],
        where: {
          companyId: { in: companyIds },
          status: { in: ['NEW', 'CONTACTED', 'REPLIED', 'BOOKED', 'SUPPRESSED'] }
        },
        _count: { _all: true }
      }),
    []
  );
  const readyLeadsByCompany = companyIds.reduce(
    (acc, companyId) => {
      acc[companyId] = { NEW: 0, CONTACTED: 0, REPLIED: 0 };
      return acc;
    },
    {} as Record<string, { NEW: number; CONTACTED: number; REPLIED: number }>
  );
  for (const row of readyLeadStatusRows) {
    if (row.status === 'NEW' || row.status === 'CONTACTED' || row.status === 'REPLIED') {
      if (!readyLeadsByCompany[row.companyId]) {
        readyLeadsByCompany[row.companyId] = { NEW: 0, CONTACTED: 0, REPLIED: 0 };
      }
      readyLeadsByCompany[row.companyId][row.status] = row._count._all;
    }
  }
  const readyCallCount = Object.values(readyLeadsByCompany).reduce(
    (sum, stat) => sum + stat.NEW + stat.CONTACTED + stat.REPLIED,
    0
  );

  return (
    <LayoutShell
      title="Companies"
      description="Keep every clinic account, notification email, and routing path inside the product instead of scattered tabs and shell commands."
      section="companies"
    >
      {notice && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className={`status-dot ${notice === 'duplicate_routing' ? 'warn' : 'ok'}`} />
            <strong>
              {notice === 'duplicate_routing'
                ? 'That inbound number is already assigned to another workspace.'
                : notice === 'created'
                  ? 'Workspace created.'
                  : 'Workspace settings saved.'}
            </strong>
          </div>
          <div className="text-muted">
            {notice === 'duplicate_routing'
              ? 'Each client needs a unique Telnyx inbound number so replies route back to the right workspace.'
              : notice === 'created'
                ? 'Finish any missing setup fields, then move into live conversations, leads, or bookings.'
                : 'The latest workspace changes are live across leads, conversations, bookings, and events.'}
          </div>
        </section>
      )}

      <div className="panel-grid">
        <section className="panel panel-dark panel-stack">
          <div className="metric-label">Operator workspaces</div>
          <h2 className="section-title section-title-large">Each company should feel ready to work, not buried in setup fields.</h2>
          <p className="metric-copy">
            Keep the path obvious: clinic routing, notification target, and clean links into leads, conversations, and bookings.
          </p>
          <div className="company-summary-strip">
            <div className="company-summary-item">
              <span className="key-value-label">Companies</span>
              <strong>{companies.length}</strong>
            </div>
            <div className="company-summary-item">
              <span className="key-value-label">Ready leads</span>
              <strong>{readyCallCount}</strong>
            </div>
            <div className="company-summary-item">
              <span className="key-value-label">Ready</span>
              <strong>{readyCompanies}</strong>
            </div>
            <div className="company-summary-item">
              <span className="key-value-label">Need routing</span>
              <strong>{missingRouting}</strong>
            </div>
            <div className="company-summary-item">
              <span className="key-value-label">Need notification email</span>
              <strong>{missingNotifications}</strong>
            </div>
          </div>
          <div className="action-cluster">
            {nextSetupWorkspace ? (
              <a className="button" href={`#company-${nextSetupWorkspace.id}`}>
                Finish {nextSetupWorkspace.name}
              </a>
            ) : (
              <a className="button" href="/companies">
                Review workspaces
              </a>
            )}
            {firstReadyWorkspace && (
              <a className="button-secondary" href={`/conversations?companyId=${firstReadyWorkspace.id}`}>
                Work {firstReadyWorkspace.name}
              </a>
            )}
          </div>
        </section>

        <form
          action={createCompanyAction}
          className="panel panel-stack"
        >
          <div className="metric-label">Create company</div>
          <h2 className="form-title">Add a new clinic or client workspace</h2>
          <div className="field-stack">
            <label className="key-value-label" htmlFor="new-company-name">
              Company name
            </label>
            <input id="new-company-name" className="text-input" name="name" placeholder="Clinic or client name" />
          </div>
          <div className="field-stack">
            <label className="key-value-label" htmlFor="new-company-email">
              Client notification email
            </label>
            <input
              id="new-company-email"
              className="text-input"
              name="notificationEmail"
              placeholder="appointments@clinic.com"
            />
          </div>
          <div className="field-stack">
            <label className="key-value-label" htmlFor="new-company-number">
              Telnyx inbound numbers
            </label>
            <textarea
              id="new-company-number"
              className="text-area"
              name="telnyxInboundNumber"
              placeholder="+13125550001
+12125550002"
              rows={3}
            />
          </div>
          <div className="text-muted">
            Operators should be able to start from this workspace immediately after save.
          </div>
          <div className="inline-actions">
            <button type="submit" className="button" name="nextSurface" value="conversations">
              Save and open conversations
            </button>
            <button type="submit" className="button-secondary">
              Save clinic
            </button>
          </div>
        </form>
      </div>

      {missingRouting > 0 && (
        <section className="panel panel-stack">
          <div className="metric-label">Shared sender coverage</div>
          <h2 className="section-title">
            {sharedSenderAvailable
              ? 'Outbound SMS can run now, but some replies still share one sender lane.'
              : 'Some clinics are missing dedicated routing, and there is no shared sender fallback configured.'}
          </h2>
          <p className="text-muted">
            {sharedSenderAvailable
              ? `Right now ${missingRouting} workspace${missingRouting === 1 ? '' : 's'} will fall back to the shared TELNYX_FROM_NUMBER. Outbound can still work, but replies are not fully isolated until each clinic has its own inbound number.`
              : 'Before trusting live SMS work, either assign a Telnyx inbound number to each workspace or configure a shared TELNYX_FROM_NUMBER as the temporary sender lane.'}
          </p>
          <div className="workspace-readiness">
            <span className={`readiness-pill${sharedSenderAvailable ? ' is-ready' : ''}`}>
              {sharedSenderAvailable ? 'Shared sender fallback available' : 'Shared sender fallback missing'}
            </span>
            <span className="readiness-pill">
              {missingRouting} workspace{missingRouting === 1 ? '' : 's'} need dedicated routing
            </span>
          </div>
        </section>
      )}

      {setupSprintCompanies.length > 0 && (
        <section className="panel panel-stack">
          <div className="metric-label">Setup sprint</div>
          <h2 className="section-title">Clear the launch blockers in one pass.</h2>
          <p className="text-muted">
            These are the workspaces still missing routing or clinic notification setup. Finish them here, then move
            straight into conversations and bookings.
          </p>
          <div className="setup-sprint-list">
            {setupSprintCompanies.map((company) => (
              <div key={company.id} className="setup-sprint-item">
                <div className="setup-sprint-copy">
                  <div className="setup-sprint-header">
                    <strong>{company.name}</strong>
                    <div className="workspace-readiness">
                      <span className={`readiness-pill${hasInboundRouting(company) ? ' is-ready' : ''}`}>
                        {hasInboundRouting(company) ? 'Routing ready' : 'Need routing'}
                      </span>
                      <span className={`readiness-pill${company.notificationEmail ? ' is-ready' : ''}`}>
                        {company.notificationEmail ? 'Clinic email ready' : 'Need clinic email'}
                      </span>
                    </div>
                  </div>
                  <div className="text-muted">
                    {!hasInboundRouting(company)
                      ? 'Add at least one Telnyx inbound number so replies and booking follow-up route back to this client.'
                      : !company.notificationEmail
                        ? 'Add the clinic notification email so booked appointments can notify the client automatically.'
                        : 'Workspace is ready for next setup steps.'}
                  </div>
                </div>
                <div className="setup-sprint-actions">
                  <a className="button" href={`#company-${company.id}`}>
                    Fix workspace
                  </a>
                  <a className="button-ghost" href={`/conversations?companyId=${company.id}`}>
                    Open workspace
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {companies.length > 0 && (
        <section className="panel panel-stack">
          <div className="metric-label">Tonight&apos;s client launch</div>
          <div className="workspace-hub-grid">
            <section className="workspace-hub-card">
              <div className="metric-label">Next setup step</div>
              <h2 className="section-title">
                {nextSetupWorkspace
                  ? `${nextSetupWorkspace.name} is the next workspace to finish.`
                  : 'Every workspace already has the basics in place.'}
              </h2>
              <p className="text-muted">
                {nextSetupWorkspace
                  ? 'Get the inbound number and clinic notification email right, then the operator can trust replies and bookings.'
                  : 'You can treat Companies like a quick review screen instead of a blocking setup page tonight.'}
              </p>
              {nextSetupWorkspace && (
                <>
                  <div className="workspace-readiness">
                    <span className={`readiness-pill${hasInboundRouting(nextSetupWorkspace) ? ' is-ready' : ''}`}>
                      {hasInboundRouting(nextSetupWorkspace) ? 'Inbound routing ready' : 'Inbound routing missing'}
                    </span>
                    <span className={`readiness-pill${nextSetupWorkspace.notificationEmail ? ' is-ready' : ''}`}>
                      {nextSetupWorkspace.notificationEmail ? 'Clinic email ready' : 'Clinic email missing'}
                    </span>
                  </div>
                  <div className="action-cluster">
                    <a className="button" href={`#company-${nextSetupWorkspace.id}`}>
                      Jump to setup
                    </a>
                    <a className="button-ghost" href={`/leads?companyId=${nextSetupWorkspace.id}`}>
                      Preview leads
                    </a>
                  </div>
                </>
              )}
            </section>

            <section className="workspace-hub-card">
              <div className="metric-label">Daily operator start</div>
              <h2 className="section-title">
                {firstReadyWorkspace
                  ? `When setup is done, start the day inside ${firstReadyWorkspace.name}.`
                  : 'Once one workspace is ready, operators should live in conversations and bookings.'}
              </h2>
              <p className="text-muted">
                {firstReadyWorkspace
                  ? 'The best default path is conversations first, then leads and bookings without making the operator hunt for context.'
                  : 'You do not need more setup screens than this. Finish one workspace and move into live work.'}
              </p>
              {firstReadyWorkspace && (
                <div className="action-cluster">
                  <a className="button" href={`/conversations?companyId=${firstReadyWorkspace.id}`}>
                    Work conversations
                  </a>
                  <a className="button-secondary" href={`/bookings?companyId=${firstReadyWorkspace.id}`}>
                    View bookings
                  </a>
                  <a className="button-ghost" href={`/leads?companyId=${firstReadyWorkspace.id}`}>
                    Open leads
                  </a>
                </div>
              )}
            </section>
          </div>
        </section>
      )}

      <div className="record-grid">
        {companies.length === 0 && <div className="empty-state">No clinics yet. Add the first client workspace to start routing live conversations and bookings.</div>}

        {rankedCompanies.map((company) => {
          const hasRouting = hasInboundRouting(company);
          const nextStep = !hasRouting
            ? 'Assign the inbound number so replies land in the right workspace.'
            : !company.notificationEmail
              ? 'Add the client notification email before trusting bookings.'
              : 'Ready to work conversations, leads, and bookings.';

          return (
          <form
            key={company.id}
            id={`company-${company.id}`}
            action={updateCompanyAction}
            className="record-card"
          >
            <input type="hidden" name="companyId" value={company.id} />
            <div className="record-header">
              <div>
                <div className="metric-label">Client workspace</div>
                <h2 className="record-title">{company.name}</h2>
              </div>
              <div className="inline-row">
                <span className={`status-chip ${hasRouting ? '' : 'status-chip-muted'}`}>
                  <strong>Routing</strong> {hasRouting ? 'ready' : 'missing'}
                </span>
                {!hasRouting && sharedSenderAvailable && (
                  <span className="status-chip status-chip-attention">
                    <strong>SMS tonight</strong> shared sender
                  </span>
                )}
                <span className={`status-chip ${company.notificationEmail ? '' : 'status-chip-muted'}`}>
                  <strong>Email</strong> {company.notificationEmail ? 'ready' : 'missing'}
                </span>
              </div>
            </div>
            <div className="company-summary-strip">
              <div className="company-summary-item">
                <span className="key-value-label">Leads</span>
                <strong>{company._count.leads}</strong>
              </div>
              <div className="company-summary-item">
                <span className="key-value-label">Ready leads</span>
                <strong>
                  {readyLeadsByCompany[company.id].NEW +
                    readyLeadsByCompany[company.id].CONTACTED +
                    readyLeadsByCompany[company.id].REPLIED}
                </strong>
              </div>
              <div className="company-summary-item">
                <span className="key-value-label">Threads</span>
                <strong>{company._count.conversations}</strong>
              </div>
              <div className="company-summary-item">
                <span className="key-value-label">Bookings</span>
                <strong>{company._count.appointments}</strong>
              </div>
            </div>
            <div className="record-links">
              <a className="button" href={`/conversations?companyId=${company.id}`}>
                Work conversations
              </a>
              {readyLeadsByCompany[company.id].NEW + readyLeadsByCompany[company.id].CONTACTED + readyLeadsByCompany[company.id].REPLIED > 0 ? (
                <a className="button-secondary" href={`/leads?companyId=${company.id}&status=NEW`}>
                  Work ready leads
                </a>
              ) : (
                <a className="button-secondary" href={`/leads?companyId=${company.id}`}>
                  Work leads
                </a>
              )}
              <a className="button-ghost" href={`/leads?companyId=${company.id}&status=REPLIED`}>
                Replied only
              </a>
              <a className="button-ghost" href={`/bookings?companyId=${company.id}`}>
                Bookings
              </a>
            </div>
            <div className="record-subtitle">{nextStep}</div>
            <div className="company-config-grid">
              <div className="field-stack">
                <label className="key-value-label" htmlFor={`company-name-${company.id}`}>
                  Company name
                </label>
                <input id={`company-name-${company.id}`} className="text-input" name="name" defaultValue={company.name} />
              </div>
              <div className="field-stack">
                <label className="key-value-label" htmlFor={`company-email-${company.id}`}>
                  Client notification email
                </label>
                <input
                  id={`company-email-${company.id}`}
                  name="notificationEmail"
                  defaultValue={company.notificationEmail || ''}
                  placeholder="Client notification email"
                  className="text-input"
                />
              </div>
              <div className="field-stack">
                <label className="key-value-label" htmlFor={`company-numbers-${company.id}`}>
                  Telnyx inbound numbers
                </label>
                <textarea
                  id={`company-numbers-${company.id}`}
                  className="text-area"
                  name="telnyxInboundNumber"
                  defaultValue={formatInboundNumbersForInput(company)}
                  placeholder="+13125550001
+12125550002"
                  rows={3}
                />
              </div>
              <div className="field-stack">
                <span className="key-value-label">Company ID</span>
                <span className="tiny-muted">{company.id}</span>
              </div>
            </div>
            <button type="submit" className="button-secondary">
              {hasRouting && company.notificationEmail ? 'Save workspace settings' : 'Save and finish setup'}
            </button>
          </form>
          );
        })}
      </div>
    </LayoutShell>
  );
}
