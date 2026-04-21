import { db } from '@/lib/db';
import { LayoutShell } from '@/app/components/LayoutShell';

export default async function EventsPage({ searchParams }: { searchParams?: Promise<{ companyId?: string }> }) {
  const params = (await searchParams) || {};
  const companyId = params.companyId;

  const events = companyId
    ? await db.eventLog.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 200
      })
    : [];

  return (
    <LayoutShell title="Events">
      <p>Pass <code>?companyId=...</code> in the URL.</p>
      <ul>
        {events.map((event) => (
          <li key={event.id} style={{ marginBottom: 12 }}>
            <strong>{event.eventType}</strong><br />
            {new Date(event.createdAt).toLocaleString()}<br />
            <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(event.payload, null, 2)}</pre>
          </li>
        ))}
      </ul>
    </LayoutShell>
  );
}
