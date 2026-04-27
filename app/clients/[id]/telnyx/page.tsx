import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function LegacyClientTelnyxPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/clients/${id}/connections`);
}
