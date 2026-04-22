import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function LegacyConversationsPage({
  searchParams
}: {
  searchParams?: Promise<{
    companyId?: string;
  }>;
}) {
  await searchParams;
  redirect('/messages');
}
