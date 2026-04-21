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

  return (
    <LayoutShell
      title="Companies"
      description="Keep every clinic account, notification email, and workflow entry point inside the product instead of scattered shell commands."
      section="companies"
    >
      <p className="page-copy">
        These records anchor the whole system: lead ownership, notification targets, and the links your team uses to work each clinic.
      </p>

      <form
        action={createCompanyAction}
        className="panel panel-stack"
      >
        <div className="metric-label">Create company</div>
        <h2 className="form-title">Add a new clinic or client</h2>
        <input className="text-input" name="name" placeholder="Clinic or client name" />
        <input
          className="text-input"
          name="notificationEmail"
          placeholder="Client notification email (optional)"
        />
        <button type="submit" className="button">
          Create company
        </button>
      </form>

      <div className="record-grid">
        {companies.length === 0 && <div className="empty-state">No companies yet.</div>}

        {companies.map((company) => (
          <form
            key={company.id}
            action={updateCompanyAction}
            className="record-card"
          >
            <input type="hidden" name="companyId" value={company.id} />
            <div className="record-header">
              <div>
                <div className="metric-label">Client record</div>
                <h2 className="record-title">{company.name}</h2>
              </div>
              <div className="tiny-muted">Company ID: {company.id}</div>
            </div>
            <input className="text-input" name="name" defaultValue={company.name} />
            <input
              name="notificationEmail"
              defaultValue={company.notificationEmail || ''}
              placeholder="Client notification email"
              className="text-input"
            />
            <div className="inline-row text-muted">
              <span>Leads: {company._count.leads}</span>
              <span>Conversations: {company._count.conversations}</span>
              <span>Appointments: {company._count.appointments}</span>
            </div>
            <div className="record-links">
              <button type="submit" className="button">
                Save company
              </button>
              <a className="button-secondary" href={`/leads?companyId=${company.id}`}>
                Open leads
              </a>
              <a className="button-secondary" href={`/conversations?companyId=${company.id}`}>
                Open conversations
              </a>
              <a className="button-ghost" href={`/events?companyId=${company.id}`}>
                Open events
              </a>
            </div>
          </form>
        ))}
      </div>
    </LayoutShell>
  );
}
