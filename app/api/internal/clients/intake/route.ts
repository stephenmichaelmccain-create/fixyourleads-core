import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireApiKey } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';
import {
  normalizeClinicKey,
  normalizeWebsiteKey,
  upsertProspectMetadata
} from '@/lib/client-intake';

const intakeSchema = z.object({
  clinicName: z.string().trim().min(1),
  contactName: z.string().trim().min(1).optional(),
  notificationEmail: z.string().trim().email().optional(),
  phone: z.string().trim().min(7).optional(),
  website: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  sourceExternalId: z.string().trim().min(1).optional()
});

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

  const parsed = intakeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
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

  return NextResponse.json({
    ok: true,
    companyId: company.id,
    prospectId: matchedProspect?.id || null,
    matchedExistingCompany: Boolean(matchedCompany)
  });
}
