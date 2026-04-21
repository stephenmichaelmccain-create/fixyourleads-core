import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { safeLoad } from '@/lib/ui-data';
import { createCompanyAction, updateCompanyAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function CompaniesPage() {
  const companies = await safeLoad(
    () =>
      db.company.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
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
    const leftMissing = Number(!left.telnyxInboundNumber) + Number(!left.notificationEmail);
    const rightMissing = Number(!right.telnyxInboundNumber) + Number(!right.notificationEmail);

    if (leftMissing !== rightMissing) {
      return rightMissing - leftMissing;
    }

    return left.name.localeCompare(right.name);
  });
  const readyCompanies = companies.filter((company) => company.notificationEmail && company.telnyxInboundNumber).length;
  const missingRouting = companies.filter((company) => !company.telnyxInboundNumber).length;
  const missingNotifications = companies.filter((company) => !company.notificationEmail).length;

  return (
    <LayoutShell
      title="Companies"
      description="Keep every clinic account, notification email, and workflow entry point inside the product instead of scattered shell commands."
      section="companies"
    >
      <div className="panel-grid">
        <section className="panel panel-dark panel-stack">
          <div className="metric-label">Operator workspaces</div>
          <h2 className="section-title section-title-large">Each company should feel ready to work, not buried in setup fields.</h2>
          <p className="metric-copy">
            Keep the operator path obvious: one workspace, one inbound number, one notification target, and clean links into leads,
            conversations, and events.
          </p>
          <div className="company-summary-strip">
            <div className="company-summary-item">
              <span className="key-value-label">Companies</span>
              <strong>{companies.length}</strong>
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
              Telnyx inbound number
            </label>
            <input
              id="new-company-number"
              className="text-input"
              name="telnyxInboundNumber"
              placeholder="+13125550001"
            />
          </div>
          <div className="text-muted">
            Operators should be able to start from this workspace immediately after save.
          </div>
          <button type="submit" className="button">
            Create workspace
          </button>
        </form>
      </div>

      <div className="record-grid">
        {companies.length === 0 && <div className="empty-state">No companies yet.</div>}

        {rankedCompanies.map((company) => {
          const nextStep = !company.telnyxInboundNumber
            ? 'Assign the inbound number so replies land in the right workspace.'
            : !company.notificationEmail
              ? 'Add the client notification email before trusting bookings.'
              : 'Ready to work conversations, leads, and bookings.';

          return (
          <form
            key={company.id}
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
                <span className={`status-chip ${company.telnyxInboundNumber ? '' : 'status-chip-muted'}`}>
                  <strong>Routing</strong> {company.telnyxInboundNumber ? 'ready' : 'missing'}
                </span>
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
              <a className="button-secondary" href={`/leads?companyId=${company.id}`}>
                Work leads
              </a>
              <a className="button-ghost" href={`/events?companyId=${company.id}`}>
                Audit trail
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
                <label className="key-value-label" htmlFor={`company-number-${company.id}`}>
                  Telnyx inbound number
                </label>
                <input
                  id={`company-number-${company.id}`}
                  name="telnyxInboundNumber"
                  defaultValue={company.telnyxInboundNumber || ''}
                  placeholder="Inbound routing number"
                  className="text-input"
                />
              </div>
              <div className="field-stack">
                <span className="key-value-label">Company ID</span>
                <span className="tiny-muted">{company.id}</span>
              </div>
            </div>
            <button type="submit" className="button-secondary">
              Save workspace settings
            </button>
          </form>
          );
        })}
      </div>
    </LayoutShell>
  );
}
