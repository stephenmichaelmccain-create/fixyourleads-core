import { LayoutShell } from '@/app/components/LayoutShell';
import Link from 'next/link';
import { WebhookConnectionsFeed } from './WebhookConnectionsFeed';

export const dynamic = 'force-dynamic';

export default async function AdminSystemPage() {
  return (
    <LayoutShell
      title="Webhooks"
      description="Live account hookup status by account."
      section="system"
      hidePageHeader
    >
      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Diagnostics</div>
            <h2 className="section-title">Production control surfaces</h2>
            <div className="record-subtitle">Open the operator views for queue health and voice failure handling.</div>
          </div>
        </div>
        <div className="action-cluster">
          <Link className="button-secondary" href="/diagnostics/queues">
            Queue diagnostics
          </Link>
          <Link className="button-secondary" href="/diagnostics/voice">
            Voice diagnostics
          </Link>
        </div>
      </section>

      <WebhookConnectionsFeed />
    </LayoutShell>
  );
}
