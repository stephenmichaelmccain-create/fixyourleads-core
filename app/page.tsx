import { LayoutShell } from './components/LayoutShell';
import { safeCountSummary } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const summary = await safeCountSummary();

  return (
    <LayoutShell title="Fix Your Leads Core">
      <p>Internal lead ops UI.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, margin: '20px 0' }}>
        <div style={{ border: '1px solid #ddd', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12, color: '#666' }}>Companies</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{summary.companies ?? '—'}</div>
        </div>
        <div style={{ border: '1px solid #ddd', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12, color: '#666' }}>Leads</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{summary.leads ?? '—'}</div>
        </div>
        <div style={{ border: '1px solid #ddd', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12, color: '#666' }}>Conversations</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{summary.conversations ?? '—'}</div>
        </div>
        <div style={{ border: '1px solid #ddd', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12, color: '#666' }}>Events</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{summary.events ?? '—'}</div>
        </div>
      </div>

      {!summary.ok && (
        <div style={{ border: '1px solid #f0c36d', background: '#fff7e6', borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <strong>Database not ready yet.</strong>
          <div style={{ marginTop: 6 }}>
            The UI is up, but live data queries are failing. Open <a href="/diagnostics">/diagnostics</a> to verify env state,
            then check <a href="/api/health">/api/health</a> for runtime readiness before finishing database setup.
          </div>
        </div>
      )}

      <p>Available pages:</p>
      <ul>
        <li><a href="/leads">Leads</a></li>
        <li><a href="/conversations">Conversations</a></li>
        <li><a href="/events">Events</a></li>
        <li><a href="/diagnostics">Diagnostics</a></li>
        <li><a href="/api/health">API Health</a></li>
      </ul>
    </LayoutShell>
  );
}
