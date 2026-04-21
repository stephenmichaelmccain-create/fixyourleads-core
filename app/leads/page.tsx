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
    <LayoutShell title="Leads" companyId={companyId}>
      <CompanySelectorBar action="/leads" initialCompanyId={companyId} />

      {!companyId && <p>Enter a company ID to load leads.</p>}

      {companyId && leads.length === 0 && (
        <p style={{ color: '#666' }}>No leads found yet, or the database is not ready for lead queries.</p>
      )}

      <div style={{ marginTop: 20 }}>
        {leads.map((lead) => (
          <div
            key={lead.id}
            style={{
              border: '1px solid #ddd',
              padding: 12,
              marginBottom: 10,
              borderRadius: 8
            }}
          >
            <div>
              <strong>
                <a href={`/leads/${lead.id}`}>{lead.contact?.name || 'Unnamed contact'}</a>
              </strong>
            </div>
            <div>{lead.contact?.phone || 'No phone'}</div>
            <div>Status: {lead.status}</div>
            <div style={{ color: '#666', fontSize: 12 }}>Lead ID: {lead.id}</div>
            <LeadStatusButton leadId={lead.id} companyId={lead.companyId} />
          </div>
        ))}
      </div>
    </LayoutShell>
  );
}
