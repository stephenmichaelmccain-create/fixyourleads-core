import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { importGoogleMapsLeads } from '@/services/leads';

const googleMapsImportSchema = z.object({
  companyId: z.string().min(1),
  query: z.string().trim().min(3),
  limit: z.coerce.number().int().min(1).max(20).optional()
});

export async function POST(request: NextRequest) {
  if (!requireApiKey(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = googleMapsImportSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  try {
    const result = await importGoogleMapsLeads(parsed.data);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'google_maps_api_key_missing') {
        return NextResponse.json({ error: 'google_maps_api_key_missing' }, { status: 503 });
      }

      if (error.message === 'google_maps_query_required') {
        return NextResponse.json({ error: 'google_maps_query_required' }, { status: 400 });
      }

      if (error.message.startsWith('google_maps_search_failed:')) {
        return NextResponse.json({ error: error.message }, { status: 502 });
      }
    }

    throw error;
  }
}
