import { LayoutShell } from '@/app/components/LayoutShell';
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
      <WebhookConnectionsFeed />
    </LayoutShell>
  );
}
