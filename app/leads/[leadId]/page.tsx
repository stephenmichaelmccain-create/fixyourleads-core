import { db } from '@/lib/db';
import { LayoutShell } from '@/app/components/LayoutShell';
import { LeadStatusButton } from '../LeadStatusButton';

export default async function LeadDetailPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: { contact: true }
  });

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

      <LeadStatusButton leadId={lead.id} companyId={lead.companyId} />

      <p style={{ color: '#666', marginTop: 16 }}>
        Next useful step: add a server action for manual outbound follow-up messages using the existing contact + company model.
      </p>
    </LayoutShell>
  );
}
