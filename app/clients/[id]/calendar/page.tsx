import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function LegacyClientCalendarPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ notice?: string }>;
}) {
  const { id } = await params;
  const query = (await searchParams) || {};
  const notice = query.notice ? `?notice=${encodeURIComponent(query.notice)}` : '';

  redirect(`/clients/${id}/booking${notice}`);
}
