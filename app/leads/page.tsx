import { db } from '@/lib/db';
import { LayoutShell } from '@/app/components/LayoutShell';
import { CompanySelectorBar } from '@/app/components/CompanySelectorBar';
import { LeadStatusButton } from './LeadStatusButton';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

export default async function LeadsPage({ searchParams }: { searchParams?: Promise<{ companyId?: string }> }) {
  const params = (await searchParams) || {};
  const companyId = params.companyId || '';

  const leads = companyId
    ? await safeLoad(
        () =>
          db.lead.findMany({
            where: { companyId },
            include: { contact: true },
            orderBy: { createdAt: 'desc' },
            take: 100
          }),
        []
      )
    : [];

  return (
    <LayoutShell
      title="Leads"
      description="Work the top of the funnel without contacting the same clinic twice. Every lead here should map cleanly to one company, one contact, and one conversation path."
      companyId={companyId}
      section="leads"
    >
      <CompanySelectorBar action="/leads" initialCompanyId={companyId} />

      {!companyId && <div className="empty-state">Enter a company ID to load leads.</div>}

      {companyId && leads.length === 0 && (
        <div className="empty-state">No leads found yet, or the database is not ready for lead queries.</div>
      )}

      <div className="record-grid">
        {leads.map((lead) => (
          <section key={lead.id} className="record-card">
            <div className="record-header">
              <div>
                <div className="metric-label">Lead</div>
                <strong>
                  <a href={`/leads/${lead.id}`}>{lead.contact?.name || 'Unnamed contact'}</a>
                </strong>
              </div>
              <span className="status-chip">
                <strong>Status</strong> {lead.status}
              </span>
            </div>
            <div className="record-subtitle">{lead.contact?.phone || 'No phone'}</div>
            <div className="tiny-muted">Lead ID: {lead.id}</div>
            <div className="record-links">
              <a className="button-secondary" href={`/leads/${lead.id}`}>
                Open lead
              </a>
              <LeadStatusButton leadId={lead.id} companyId={lead.companyId} />
            </div>
          </section>
        ))}
      </div>
    </LayoutShell>
  );
}
