import { db } from '@/lib/db';
import { LayoutShell } from '@/app/components/LayoutShell';
import { LeadStatusButton } from '../LeadStatusButton';
import { safeLoad } from '@/lib/ui-data';

export default async function LeadDetailPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const lead = await safeLoad(
    () =>
      db.lead.findUnique({
        where: { id: leadId },
        include: { contact: true }
      }),
    null
  );

  if (!lead) {
    return (
      <LayoutShell title="Lead Detail">
        <p>Lead not found.</p>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell title={lead.contact?.name || 'Lead Detail'}>
      <p><strong>Lead ID:</strong> {lead.id}</p>
      <p><strong>Status:</strong> {lead.status}</p>
      <p><strong>Contact:</strong> {lead.contact?.name || 'Unnamed'}</p>
      <p><strong>Phone:</strong> {lead.contact?.phone}</p>
      <p><strong>Company ID:</strong> {lead.companyId}</p>
      {lead.source && <p><strong>Source:</strong> {lead.source}</p>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <LeadStatusButton leadId={lead.id} companyId={lead.companyId} />
        <LeadStatusButton leadId={lead.id} companyId={lead.companyId} status="SUPPRESSED" label="Suppress lead" />
      </div>

      <p style={{ color: '#666', marginTop: 16 }}>
        Next useful step: open the company conversation list and manage the text flow from there.
      </p>
    </LayoutShell>
  );
}
