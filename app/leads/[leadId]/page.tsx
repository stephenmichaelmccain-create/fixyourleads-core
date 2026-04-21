import { db } from '@/lib/db';

export default async function LeadDetailPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: { contact: true }
  });

  if (!lead) {
    return <main style={{ fontFamily: 'sans-serif', padding: 24 }}>Lead not found.</main>;
  }

  return (
    <main style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1>Lead Detail</h1>
      <p><strong>Lead ID:</strong> {lead.id}</p>
      <p><strong>Status:</strong> {lead.status}</p>
      <p><strong>Contact:</strong> {lead.contact?.name || 'Unnamed'}</p>
      <p><strong>Phone:</strong> {lead.contact?.phone}</p>
      <p><strong>Company ID:</strong> {lead.companyId}</p>
    </main>
  );
}
