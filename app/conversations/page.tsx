import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function LegacyConversationsPage({
  searchParams
}: {
  searchParams?: Promise<{
    companyId?: string;
  }>;
}) {
  const params = (await searchParams) || {};
  const companyId = String(params.companyId || '').trim();
  redirect(companyId ? `/clients/${companyId}/operator` : '/clients');
}
