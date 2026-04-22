import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function LegacyCompanyTextSequencesPage({
  params
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  redirect(`/clients/${companyId}#sequences`);
}
