import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function LegacyLeadsPage({
  searchParams
}: {
  searchParams?: Promise<{
    companyId?: string;
  }>;
}) {
  const params = (await searchParams) || {};
  const companyId = params.companyId || '';

  if (companyId) {
    redirect(`/clients/${companyId}#leads`);
  }

  redirect('/our-leads');
}
