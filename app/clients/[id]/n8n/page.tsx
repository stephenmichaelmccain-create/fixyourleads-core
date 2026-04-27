import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

type SearchParamShape = Promise<{
  notice?: string;
}>;

export default async function ClientN8nPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: SearchParamShape;
}) {
  const { id } = await params;
  const query = (await searchParams) || {};
  const nextSearchParams = new URLSearchParams();

  if (query.notice) {
    nextSearchParams.set('notice', query.notice);
  }

  const search = nextSearchParams.toString();
  redirect(search ? `/clients/${id}/connections?${search}` : `/clients/${id}/connections`);
}
