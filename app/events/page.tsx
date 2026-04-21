import { db } from '@/lib/db';
import { LayoutShell } from '@/app/components/LayoutShell';
import { CompanySelectorBar } from '@/app/components/CompanySelectorBar';

export default async function EventsPage({ searchParams }: { searchParams?: Promise<{ companyId?: string }> }) {
  const params = (await searchParams) || {};
  const companyId = params.companyId || '';

  const events = companyId
    ? await db.eventLog.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 200
      })
    : [];

  return (
    <LayoutShell title="Events" companyId={companyId}>
      <CompanySelectorBar action="/events" initialCompanyId={companyId} />

      {!companyId && <p>Enter a company ID to load events.</p>}

      <div style={{ display: 'grid', gap: 12 }}>
        {events.map((event) => (
          <section key={event.id} style={{ padding: 14, border: '1px solid #ddd', borderRadius: 10 }}>
            <strong>{event.eventType}</strong>
            <div style={{ color: '#666', margin: '6px 0 10px' }}>{new Date(event.createdAt).toLocaleString()}</div>
            <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12 }}>{JSON.stringify(event.payload, null, 2)}</pre>
          </section>
        ))}
      </div>
    </LayoutShell>
  );
}
