import { db } from '@/lib/db';
import { LayoutShell } from '@/app/components/LayoutShell';
import { CompanySelectorBar } from '@/app/components/CompanySelectorBar';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

export default async function EventsPage({ searchParams }: { searchParams?: Promise<{ companyId?: string }> }) {
  const params = (await searchParams) || {};
  const companyId = params.companyId || '';

  const events = companyId
    ? await safeLoad(
        () =>
          db.eventLog.findMany({
            where: { companyId },
            orderBy: { createdAt: 'desc' },
            take: 200
          }),
        []
      )
    : [];

  return (
    <LayoutShell
      title="Events"
      description="Every lead touch, message, suppression, and booking should leave a trail. This page is the operating audit log."
      companyId={companyId}
      section="events"
    >
      <CompanySelectorBar action="/events" initialCompanyId={companyId} />

      {!companyId && <div className="empty-state">Enter a company ID to load events.</div>}

      {companyId && events.length === 0 && (
        <div className="empty-state">No events found yet, or the database is not ready for event queries.</div>
      )}

      <div className="record-grid">
        {events.map((event) => (
          <section key={event.id} className="record-card">
            <div className="record-header">
              <div>
                <div className="metric-label">Event</div>
                <strong>{event.eventType}</strong>
              </div>
              <div className="tiny-muted">{new Date(event.createdAt).toLocaleString()}</div>
            </div>
            <pre className="code-block">{JSON.stringify(event.payload, null, 2)}</pre>
          </section>
        ))}
      </div>
    </LayoutShell>
  );
}
