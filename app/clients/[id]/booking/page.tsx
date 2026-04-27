import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

type SearchParamShape = Promise<Record<string, string | undefined>>;

export default async function LegacyClientBookingPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: SearchParamShape;
}) {
  const { id } = await params;
  const query = (await searchParams) || {};
  const paramsOut = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value) {
      paramsOut.set(key, value);
    }
  }

  const search = paramsOut.toString();
  redirect(search ? `/clients/${id}/n8n?${search}` : `/clients/${id}/n8n`);
}
