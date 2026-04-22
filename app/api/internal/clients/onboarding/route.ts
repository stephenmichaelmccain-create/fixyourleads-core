import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { resolveProvidedApiKey } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';
import { normalizeClinicKey, normalizeWebsiteKey } from '@/lib/client-intake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const onboardingSchema = z.object({
  clinicName: z.string().trim().min(1),
  contactName: z.string().trim().min(1).optional(),
  notificationEmail: z.string().trim().email().optional(),
  phone: z.string().trim().min(7).optional(),
  website: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  sourceExternalId: z.string().trim().min(1).optional(),
  businessType: z.string().trim().min(1).optional(),
  campaignUseCase: z.string().trim().min(1).optional(),
  telnyxBrandName: z.string().trim().min(1).optional(),
  taxIdLast4: z.string().trim().min(4).max(4).optional()
});

type OnboardingPayloadRecord = Record<string, string>;

const allowedOrigins = new Set(
  [process.env.APP_BASE_URL, process.env.PUBLIC_SITE_URL]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
);

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

function pickFirstValue(payload: OnboardingPayloadRecord, keys: string[]) {
  for (const key of keys) {
    const value = String(payload[key] || '').trim();

    if (value) {
      return value;
    }
  }

  return undefined;
}

async function readPayload(request: NextRequest): Promise<OnboardingPayloadRecord | null> {
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

function normalizeOnboardingPayload(payload: OnboardingPayloadRecord) {
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
    ]),
    businessType: pickFirstValue(payload, ['businessType', 'business_type', 'clinicType', 'clinic_type']),
    campaignUseCase: pickFirstValue(payload, ['campaignUseCase', 'campaign_use_case', 'useCase', 'use_case']),
    telnyxBrandName: pickFirstValue(payload, ['telnyxBrandName', 'telnyx_brand_name', 'brandName', 'brand_name']),
    taxIdLast4: pickFirstValue(payload, ['taxIdLast4', 'tax_id_last4', 'einLast4', 'ein_last4'])
  };
}

function onboardingApiKeyValid(request: NextRequest, payload: OnboardingPayloadRecord | null) {
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
  let payload: OnboardingPayloadRecord | null = null;

  try {
    payload = await readPayload(request);
  } catch {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400, headers: corsHeaders(request) });
  }

  if (!onboardingApiKeyValid(request, payload)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: corsHeaders(request) });
  }

  const parsed = onboardingSchema.safeParse(normalizeOnboardingPayload(payload || {}));

  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400, headers: corsHeaders(request) });
  }

  const clinicKey = normalizeClinicKey(parsed.data.clinicName);
  const websiteKey = normalizeWebsiteKey(parsed.data.website);
  const normalizedPhone = normalizePhone(parsed.data.phone || '');

  const companies = await db.company.findMany({
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true,
      name: true,
      notificationEmail: true
    }
  });

  const matchedCompany =
    companies.find((company) => normalizeClinicKey(company.name) === clinicKey) ||
    companies.find(
      (company) =>
        parsed.data.notificationEmail &&
        String(company.notificationEmail || '').toLowerCase() === parsed.data.notificationEmail.toLowerCase()
    ) ||
    null;

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

  const onboardingReceivedAt = new Date().toISOString();

  await db.eventLog.create({
    data: {
      companyId: company.id,
      eventType: 'client_onboarding_received',
      payload: {
        companyId: company.id,
        clinicName: parsed.data.clinicName,
        contactName: parsed.data.contactName || null,
        notificationEmail: parsed.data.notificationEmail || null,
        phone: normalizedPhone || null,
        website: parsed.data.website || null,
        websiteKey: websiteKey || null,
        source: parsed.data.source || 'website_onboarding',
        sourceExternalId: parsed.data.sourceExternalId || null,
        businessType: parsed.data.businessType || null,
        campaignUseCase: parsed.data.campaignUseCase || null,
        telnyxBrandName: parsed.data.telnyxBrandName || null,
        taxIdLast4: parsed.data.taxIdLast4 || null,
        onboardingReceivedAt
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
      matchedExistingCompany: Boolean(matchedCompany)
    },
    { headers: corsHeaders(request) }
  );
}
