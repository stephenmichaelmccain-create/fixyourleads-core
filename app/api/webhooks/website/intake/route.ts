import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';
import { upsertProspectMetadata } from '@/lib/client-intake';
import { findMatchingClosedProspect, findMatchingCompany } from '@/lib/intake-matching';
import {
  readWebsitePayload,
  websiteIntakeSchema,
  type WebsitePayloadRecord,
  normalizeWebsiteIntakePayload
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
    source: 'website-intake-webhook',
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

  const normalizedPayload = normalizeWebsiteIntakePayload(payload || {});
  const payloadKeys = Object.keys(payload || {}).sort();
  const parsed = websiteIntakeSchema.safeParse(normalizedPayload);

  if (!parsed.success) {
    logWebsiteWebhook('warn', 'invalid_payload_schema', {
      contentType,
      payloadKeys,
      clinicNamePresent: Boolean(normalizedPayload.clinicName),
      emailPresent: Boolean(normalizedPayload.notificationEmail),
      phonePresent: Boolean(normalizedPayload.phone),
      websitePresent: Boolean(normalizedPayload.website),
      source: normalizedPayload.source || null
    });
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400, headers: corsHeaders(request) });
  }

  const signupReceivedAt = new Date().toISOString();
  const normalizedPhone = normalizePhone(parsed.data.phone || '');
  const [matchedProspect, matchedCompany] = await Promise.all([
    findMatchingClosedProspect({
      clinicName: parsed.data.clinicName,
      phone: normalizedPhone,
      website: parsed.data.website
    }),
    findMatchingCompany({
      clinicName: parsed.data.clinicName,
      notificationEmail: parsed.data.notificationEmail,
      website: parsed.data.website
    })
  ]);

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

  logWebsiteWebhook('info', 'accepted', {
    contentType,
    payloadKeys,
    companyId: company.id,
    matchedExistingCompany: Boolean(matchedCompany),
    matchedProspect: Boolean(matchedProspect),
    source: parsed.data.source || 'website',
    clinicName: parsed.data.clinicName
  });

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
