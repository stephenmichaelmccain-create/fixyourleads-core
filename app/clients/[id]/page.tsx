import { notFound, redirect } from 'next/navigation';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { ClientViewLinkActions } from '@/app/clients/[id]/ClientViewLinkActions';
import { LayoutShell } from '@/app/components/LayoutShell';
import { buildClientViewPath } from '@/lib/client-view-auth';
import { db } from '@/lib/db';
import { safeLoadDb } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

type SearchParamShape = Promise<{
  notice?: string;
  window?: string;
  status?: string;
  source?: string;
  q?: string;
  queue?: string;
  sort?: string;
  dir?: string;
  page?: string;
  conversationId?: string;
  leadId?: string;
  send?: string;
  detail?: string;
  booking?: string;
  notification?: string;
  notificationDetail?: string;
  confirmation?: string;
  confirmationDetail?: string;
  statusUpdated?: string;
}>;

function formatCompactDateTime(value: Date | string | null | undefined) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

function isLikelyOperatorDeepLink(query: Record<string, string | undefined>) {
  const keys: Array<keyof typeof query> = [
    'window',
    'status',
    'source',
    'q',
    'queue',
    'sort',
    'dir',
    'page',
    'conversationId',
    'leadId',
    'send',
    'detail',
    'booking',
    'notification',
    'notificationDetail',
    'confirmation',
    'confirmationDetail',
    'statusUpdated'
  ];

  return keys.some((key) => Boolean(query[key]));
}

function buildOperatorRedirect(companyId: string, query: Record<string, string | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (!value || key === 'notice') {
      continue;
    }

    params.set(key, value);
  }

  const search = params.toString();
  return search ? `/clients/${companyId}/operator?${search}` : `/clients/${companyId}/operator`;
}

export default async function ClientProfilePage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: SearchParamShape;
}) {
  const { id } = await params;
  const query = (await searchParams) || {};

  if (isLikelyOperatorDeepLink(query)) {
    redirect(buildOperatorRedirect(id, query));
  }

  const notice = query.notice || '';

  const companyBase = await safeLoadDb(
    () =>
      db.company.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          createdAt: true
        }
      }),
    null
  );

  if (!companyBase) {
    notFound();
  }
  const company = companyBase;

  const appBaseUrl = process.env.APP_BASE_URL?.trim() || null;
  const clientViewPath = buildClientViewPath(company.id);
  const clientViewUrl =
    clientViewPath && appBaseUrl ? `${appBaseUrl.replace(/\/$/, '')}${clientViewPath}` : clientViewPath;

  return (
    <LayoutShell
      title={company.name}
      companyId={company.id}
      companyName={company.name}
      section="clients"
      variant="workspace"
      hidePageHeader
    >
      <ClientWorkspaceTabs companyId={company.id} active="profile" />

      {notice === 'updated' && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot ok" />
            <strong>Client profile updated.</strong>
          </div>
          <div className="text-muted">Contact details, website info, and client context are now using the latest values.</div>
        </section>
      )}

      {notice === 'approved' && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot ok" />
            <strong>Client approved from website signup.</strong>
          </div>
          <div className="text-muted">The signup details were pushed into this client record so you can keep setup moving from here.</div>
        </section>
      )}

      <section className="panel client-record-hero">
        <div className="client-record-meta-strip">
          <div className="client-record-meta-item">
            <span className="key-value-label">Created</span>
            <strong>{formatCompactDateTime(company.createdAt)}</strong>
          </div>
          <ClientViewLinkActions clientViewUrl={clientViewUrl} variant="simple" />
        </div>
      </section>
    </LayoutShell>
  );
}
