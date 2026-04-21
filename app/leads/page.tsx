import { db } from '@/lib/db';

export default async function LeadsPage({ searchParams }: { searchParams?: Promise<{ companyId?: string }> }) {
  const params = (await searchParams) || {};
  const companyId = params.companyId;

  const leads = companyId
    ? await db.lead.findMany({
        where: { companyId },
        include: { contact: true },
        orderBy: { createdAt: 'desc' },
        take: 100
      })
    : [];

  return (
    <main style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1>Leads</h1>
      <p>Pass <code>?companyId=...</code> in the URL.</p>
      <ul>
        {leads.map((lead) => (
          <li key={lead.id} style={{ marginBottom: 12 }}>
            <strong>{lead.contact?.name || 'Unnamed contact'}</strong><br />
            {lead.contact?.phone}<br />
            status: {lead.status}<br />
            leadId: {lead.id}
          </li>
        ))}
      </ul>
    </main>
  );
}
