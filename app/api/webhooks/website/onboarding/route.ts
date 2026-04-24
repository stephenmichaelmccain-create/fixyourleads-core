import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';
import { normalizeWebsiteKey } from '@/lib/client-intake';
import { findMatchingCompany } from '@/lib/intake-matching';
import {
  readWebsitePayload,
  websiteOnboardingSchema,
  type WebsitePayloadRecord,
  normalizeWebsiteOnboardingPayload
} from '@/lib/website-webhook-payload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function logWebsiteWebhook(
  level: 'info' | 'warn' | 'error',
  event: string,
  detail: Record<string, unknown>
) {
  const entry = JSON.stringify({
    level,
    event,
    source: 'website-onboarding-webhook',
    ...detail
  });

  if (level === 'error') {
    console.error(entry);
    return;
  }

  if (level === 'warn') {
    console.warn(entry);
    return;
  }

  console.info(entry);
}

function corsHeaders(request: NextRequest) {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
    'Access-Control-Allow-Origin': '*'
  };

  return headers;
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request)
  });
}

export async function POST(request: NextRequest) {
  let payload: WebsitePayloadRecord | null = null;
  const contentType = String(request.headers.get('content-type') || '').toLowerCase();

  try {
    payload = await readWebsitePayload(request);
  } catch {
    logWebsiteWebhook('warn', 'invalid_payload_read', {
      contentType,
      payloadPresent: false
    });
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400, headers: corsHeaders(request) });
  }

  const normalizedPayload = normalizeWebsiteOnboardingPayload(payload || {});
  const payloadKeys = Object.keys(payload || {}).sort();
  const parsed = websiteOnboardingSchema.safeParse(normalizedPayload);

  if (!parsed.success) {
    logWebsiteWebhook('warn', 'invalid_payload_schema', {
      contentType,
      payloadKeys,
      clinicNamePresent: Boolean(normalizedPayload.clinicName),
      emailPresent: Boolean(normalizedPayload.notificationEmail),
      phonePresent: Boolean(normalizedPayload.phone),
      websitePresent: Boolean(normalizedPayload.website),
      source: normalizedPayload.source || null,
      businessTypePresent: Boolean(normalizedPayload.businessType),
      campaignUseCasePresent: Boolean(normalizedPayload.campaignUseCase),
      telnyxBrandNamePresent: Boolean(normalizedPayload.telnyxBrandName),
      taxIdLast4Present: Boolean(normalizedPayload.taxIdLast4)
    });
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400, headers: corsHeaders(request) });
  }

  const normalizedPhone = normalizePhone(parsed.data.phone || '');
  const websiteKey = normalizeWebsiteKey(parsed.data.website);
  const matchedCompany = await findMatchingCompany({
    clinicName: parsed.data.clinicName,
    notificationEmail: parsed.data.notificationEmail,
    website: parsed.data.website
  });

  const company =
    matchedCompany ||
    (await db.company.create({
      data: {
        name: parsed.data.clinicName,
        notificationEmail: parsed.data.notificationEmail || null
      },
      select: { id: true, notificationEmail: true }
    }));

  if (parsed.data.notificationEmail && company.notificationEmail !== parsed.data.notificationEmail) {
    await db.company.update({
      where: { id: company.id },
      data: {
        notificationEmail: parsed.data.notificationEmail
      },
      select: { id: true }
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

  logWebsiteWebhook('info', 'accepted', {
    contentType,
    payloadKeys,
    companyId: company.id,
    matchedExistingCompany: Boolean(matchedCompany),
    source: parsed.data.source || 'website_onboarding',
    clinicName: parsed.data.clinicName,
    businessTypePresent: Boolean(parsed.data.businessType),
    campaignUseCasePresent: Boolean(parsed.data.campaignUseCase),
    telnyxBrandNamePresent: Boolean(parsed.data.telnyxBrandName),
    taxIdLast4Present: Boolean(parsed.data.taxIdLast4)
  });

  return NextResponse.json(
    {
      ok: true,
      companyId: company.id,
      matchedExistingCompany: Boolean(matchedCompany)
    },
    { headers: corsHeaders(request) }
  );
}
