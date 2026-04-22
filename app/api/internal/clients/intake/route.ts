import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { resolveProvidedApiKey } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';
import {
  normalizeClinicKey,
  normalizeWebsiteKey,
  upsertProspectMetadata
} from '@/lib/client-intake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const intakeSchema = z.object({
  clinicName: z.string().trim().min(1),
  contactName: z.string().trim().min(1).optional(),
  notificationEmail: z.string().trim().email().optional(),
  phone: z.string().trim().min(7).optional(),
  website: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  sourceExternalId: z.string().trim().min(1).optional()
});

type IntakePayloadRecord = Record<string, string>;

const allowedOrigins = new Set(
  [process.env.APP_BASE_URL, process.env.PUBLIC_SITE_URL]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
);

function matchProspectByPriority(
  prospects: Array<{
    id: string;
    name: string;
    phone: string | null;
    website: string | null;
    notes: string | null;
  }>,
  input: {
    clinicKey: string;
    phone: string;
    websiteKey: string;
  }
) {
  return (
    prospects.find((prospect) => normalizeClinicKey(prospect.name) === input.clinicKey) ||
    (input.phone ? prospects.find((prospect) => normalizePhone(prospect.phone || '') === input.phone) : null) ||
    (input.websiteKey
      ? prospects.find((prospect) => normalizeWebsiteKey(prospect.website || '') === input.websiteKey)
      : null) ||
    null
  );
}

function corsHeaders(request: NextRequest) {
  const origin = request.headers.get('origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key'
  };

  if (origin && allowedOrigins.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }

  return headers;
}

function pickFirstValue(payload: IntakePayloadRecord, keys: string[]) {
  for (const key of keys) {
    const value = String(payload[key] || '').trim();

    if (value) {
      return value;
    }
  }

  return undefined;
}

async function readPayload(request: NextRequest): Promise<IntakePayloadRecord | null> {
  const contentType = String(request.headers.get('content-type') || '').toLowerCase();

  if (contentType.includes('application/json')) {
    const parsed = await request.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, value == null ? '' : String(value)])
      );
    }

    return null;
  }

  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    const formData = await request.formData();

    return Object.fromEntries(
      Array.from(formData.entries()).map(([key, value]) => [
        key,
        typeof value === 'string' ? value : value.name
      ])
    );
  }

  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, value == null ? '' : String(value)])
      );
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeIntakePayload(payload: IntakePayloadRecord) {
  return {
    clinicName: pickFirstValue(payload, [
      'clinicName',
      'clinic_name',
      'businessName',
      'business_name',
      'companyName',
      'company_name',
      'clinic',
      'name'
    ]),
    contactName: pickFirstValue(payload, [
      'contactName',
      'contact_name',
      'ownerName',
      'owner_name',
      'fullName',
      'full_name'
    ]),
    notificationEmail: pickFirstValue(payload, [
      'notificationEmail',
      'notification_email',
      'email',
      'contactEmail',
      'contact_email'
    ]),
    phone: pickFirstValue(payload, [
      'phone',
      'phoneNumber',
      'phone_number',
      'contactPhone',
      'contact_phone'
    ]),
    website: pickFirstValue(payload, [
      'website',
      'websiteUrl',
      'website_url',
      'site',
      'domain'
    ]),
    source: pickFirstValue(payload, ['source', 'formSource', 'form_source', 'channel']),
    sourceExternalId: pickFirstValue(payload, [
      'sourceExternalId',
      'source_external_id',
      'submissionId',
      'submission_id',
      'recordId',
      'record_id'
    ])
  };
}

function intakeApiKeyValid(request: NextRequest, payload: IntakePayloadRecord | null) {
  const expected = process.env.INTERNAL_API_KEY;

  if (!expected) {
    throw new Error('INTERNAL_API_KEY is not configured');
  }

  const provided =
    resolveProvidedApiKey(request) ||
    String(payload?.apiKey || payload?.api_key || payload?.token || '').trim();

  return Boolean(provided && provided === expected);
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request)
  });
}

export async function POST(request: NextRequest) {
  let payload: IntakePayloadRecord | null = null;

  try {
    payload = await readPayload(request);
  } catch {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400, headers: corsHeaders(request) });
  }

  if (!intakeApiKeyValid(request, payload)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders(request) });
  }

  const parsed = intakeSchema.safeParse(normalizeIntakePayload(payload || {}));

  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400, headers: corsHeaders(request) });
  }

  const signupReceivedAt = new Date().toISOString();
  const normalizedPhone = normalizePhone(parsed.data.phone || '');
  const clinicKey = normalizeClinicKey(parsed.data.clinicName);
  const websiteKey = normalizeWebsiteKey(parsed.data.website);

  const [soldProspects, companies] = await Promise.all([
    db.prospect.findMany({
      where: { status: 'CLOSED' },
      orderBy: { updatedAt: 'desc' },
      take: 500,
      select: {
        id: true,
        name: true,
        phone: true,
        website: true,
        notes: true
      }
    }),
    db.company.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true,
        name: true,
        notificationEmail: true
      }
    })
  ]);

  const matchedProspect = matchProspectByPriority(soldProspects, {
    clinicKey,
    phone: normalizedPhone,
    websiteKey
  });

  const matchedCompany =
    companies.find((company) => normalizeClinicKey(company.name) === clinicKey) || null;

  const company =
    matchedCompany ||
    (await db.company.create({
      data: {
        name: parsed.data.clinicName,
        notificationEmail: parsed.data.notificationEmail || null
      }
    }));

  if (parsed.data.notificationEmail && company.notificationEmail !== parsed.data.notificationEmail) {
    await db.company.update({
      where: { id: company.id },
      data: {
        notificationEmail: parsed.data.notificationEmail
      }
    });
  }

  if (matchedProspect) {
    await db.prospect.update({
      where: { id: matchedProspect.id },
      data: {
        notes: upsertProspectMetadata(matchedProspect.notes, {
          signup_received_at: signupReceivedAt,
          signup_source: parsed.data.source || 'website',
          signup_external_id: parsed.data.sourceExternalId,
          signup_contact_name: parsed.data.contactName,
          signup_notification_email: parsed.data.notificationEmail,
          signup_phone: normalizedPhone || null,
          signup_website: parsed.data.website
        })
      }
    });
  }

  await db.eventLog.create({
    data: {
      companyId: company.id,
      eventType: 'client_signup_received',
      payload: {
        companyId: company.id,
        prospectId: matchedProspect?.id || null,
        clinicName: parsed.data.clinicName,
        contactName: parsed.data.contactName || null,
        notificationEmail: parsed.data.notificationEmail || null,
        phone: normalizedPhone || null,
        website: parsed.data.website || null,
        source: parsed.data.source || 'website',
        sourceExternalId: parsed.data.sourceExternalId || null,
        signupReceivedAt
      }
    }
  });

  revalidatePath('/');
  revalidatePath('/clients');
  revalidatePath('/clients/intake');

  return NextResponse.json(
    {
      ok: true,
      companyId: company.id,
      prospectId: matchedProspect?.id || null,
      matchedExistingCompany: Boolean(matchedCompany)
    },
    { headers: corsHeaders(request) }
  );
}
