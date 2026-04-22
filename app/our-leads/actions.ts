"use server";

import { ProspectStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';

const INTERNAL_COMPANY_ID = 'fixyourleads';
const PROSPECT_META_PREFIX = 'fyl:';

function normalizeWebsiteHost(website: string) {
  const trimmed = String(website || '').trim();

  if (!trimmed) {
    return '';
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(candidate).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return trimmed
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0]
      .toLowerCase();
  }
}

function readText(formData: FormData, key: string) {
  return String(formData.get(key) || '').trim();
}

function buildProspectNotes({
  plainNotes,
  clinicType,
  zipCode,
  predictedRevenue,
  sourceLabel,
  importBatch,
  sourceRecord,
  logoUrl
}: {
  plainNotes?: string | null;
  clinicType?: string | null;
  zipCode?: string | null;
  predictedRevenue?: string | null;
  sourceLabel?: string | null;
  importBatch?: string | null;
  sourceRecord?: string | null;
  logoUrl?: string | null;
}) {
  const metadataEntries = [
    ['clinic_type', clinicType],
    ['zip_code', zipCode],
    ['predicted_revenue', predictedRevenue],
    ['source', sourceLabel],
    ['import_batch', importBatch],
    ['source_record', sourceRecord],
    ['logo_url', logoUrl]
  ].filter((entry): entry is [string, string] => Boolean(entry[1] && String(entry[1]).trim()));

  const metadataLines = metadataEntries.map(([key, value]) => `${PROSPECT_META_PREFIX}${key}=${String(value).trim()}`);
  const cleanNotes = String(plainNotes || '').trim();

  return [...metadataLines, cleanNotes].filter(Boolean).join('\n');
}

function addDaysFromNow(days: number, hour: number) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  value.setHours(hour, 0, 0, 0);
  return value;
}

function readCallbackPreset(preset: string) {
  switch (preset) {
    case 'tomorrow':
      return { label: 'Tomorrow', nextActionAt: addDaysFromNow(1, 9) };
    case '3_days':
      return { label: '3 days', nextActionAt: addDaysFromNow(3, 10) };
    case '1_week':
      return { label: '1 week', nextActionAt: addDaysFromNow(7, 10) };
    case '1_month':
      return { label: '1 month', nextActionAt: addDaysFromNow(30, 10) };
    default:
      return null;
  }
}

function buildOurLeadsHref({
  prospectId,
  q,
  status,
  city,
  nextActionDue,
  updated
}: {
  prospectId?: string;
  q?: string;
  status?: string;
  city?: string;
  nextActionDue?: string;
  updated?: string;
}) {
  const params = new URLSearchParams();

  if (prospectId) {
    params.set('prospectId', prospectId);
  }

  if (q) {
    params.set('q', q);
  }

  if (status) {
    params.set('status', status);
  }

  if (city) {
    params.set('city', city);
  }

  if (nextActionDue) {
    params.set('nextActionDue', nextActionDue);
  }

  if (updated) {
    params.set('updated', updated);
  }

  const query = params.toString();
  return query ? `/leads?${query}` : '/leads';
}

export async function createProspectAction(formData: FormData) {
  const name = readText(formData, 'name');
  const rawPhone = readText(formData, 'phone');
  const city = readText(formData, 'city') || null;
  const website = readText(formData, 'website') || null;
  const ownerName = readText(formData, 'ownerName') || null;
  const notes = readText(formData, 'notes') || null;
  const clinicType = readText(formData, 'clinicType') || null;
  const zipCode = readText(formData, 'zipCode') || null;
  const predictedRevenue = readText(formData, 'predictedRevenue') || null;
  const sourceLabel = readText(formData, 'sourceLabel') || null;
  const importBatch = readText(formData, 'importBatch') || null;
  const sourceRecord = readText(formData, 'sourceRecord') || null;
  const logoUrl = readText(formData, 'logoUrl') || null;
  const requestedStatus = readText(formData, 'status');
  const nextActionRaw = readText(formData, 'nextActionAt');

  if (!name) {
    redirect('/leads?error=name_required#add-prospect');
  }

  const status = Object.values(ProspectStatus).includes(requestedStatus as ProspectStatus)
    ? (requestedStatus as ProspectStatus)
    : ProspectStatus.NEW;
  const normalizedPhone = rawPhone ? normalizePhone(rawPhone) || rawPhone : null;
  const normalizedHost = normalizeWebsiteHost(website || '');
  const normalizedName = name.trim().toLowerCase();
  const normalizedCity = (city || '').trim().toLowerCase();
  const nextActionAt = nextActionRaw ? new Date(nextActionRaw) : null;

  if (nextActionAt && Number.isNaN(nextActionAt.getTime())) {
    redirect('/leads?error=invalid_next_action#add-prospect');
  }

  const existingProspects = await db.prospect.findMany({
    where: {
      companyId: INTERNAL_COMPANY_ID
    },
    select: {
      id: true,
      name: true,
      city: true,
      website: true,
      phone: true
    }
  });

  const duplicate =
    (normalizedHost
      ? existingProspects.find((prospect) => normalizeWebsiteHost(prospect.website || '') === normalizedHost)
      : null) ||
    (normalizedPhone
      ? existingProspects.find((prospect) => normalizePhone(prospect.phone || '') === normalizedPhone)
      : null) ||
    existingProspects.find(
      (prospect) =>
        prospect.name.trim().toLowerCase() === normalizedName &&
        String(prospect.city || '')
          .trim()
          .toLowerCase() === normalizedCity
    );

  if (duplicate) {
    let duplicateReason = 'clinic';

    if (normalizedHost && normalizeWebsiteHost(duplicate.website || '') === normalizedHost) {
      duplicateReason = 'website';
    } else if (normalizedPhone && normalizePhone(duplicate.phone || '') === normalizedPhone) {
      duplicateReason = 'phone';
    } else {
      duplicateReason = 'name_city';
    }

    redirect(
      `/leads?error=duplicate&prospectId=${encodeURIComponent(duplicate.id)}&duplicateReason=${encodeURIComponent(
        duplicateReason
      )}#add-prospect`
    );
  }

  const prospect = await db.prospect.create({
    data: {
      companyId: INTERNAL_COMPANY_ID,
      name,
      phone: normalizedPhone,
      city,
      website,
      ownerName,
      status,
      nextActionAt,
      notes: buildProspectNotes({
        plainNotes: notes,
        clinicType,
        zipCode,
        predictedRevenue,
        sourceLabel,
        importBatch,
        sourceRecord,
        logoUrl
      })
    }
  });

  revalidatePath('/our-leads');
  revalidatePath('/leads');
  redirect(`/leads?prospectId=${encodeURIComponent(prospect.id)}&added=1`);
}

export async function updateProspectOutcomeAction(formData: FormData) {
  const prospectId = readText(formData, 'prospectId');
  const outcome = readText(formData, 'outcome');
  const q = readText(formData, 'q');
  const status = readText(formData, 'status');
  const city = readText(formData, 'city');
  const nextActionDue = readText(formData, 'nextActionDue');

  if (!prospectId) {
    redirect(buildOurLeadsHref({ q, status, city, nextActionDue }));
  }

  const outcomeMap: Record<
    string,
    {
      status: ProspectStatus;
      lastCallOutcome: string;
      nextActionAt: Date | null;
      notesSuffix?: string;
    }
  > = {
    no_answer: {
      status: ProspectStatus.NO_ANSWER,
      lastCallOutcome: 'No answer',
      nextActionAt: addDaysFromNow(1, 9)
    },
    voicemail: {
      status: ProspectStatus.VM_LEFT,
      lastCallOutcome: 'Left voicemail',
      nextActionAt: addDaysFromNow(1, 11)
    },
    not_interested: {
      status: ProspectStatus.GATEKEEPER,
      lastCallOutcome: 'Not interested - retry later',
      nextActionAt: addDaysFromNow(45, 10)
    },
    do_not_contact: {
      status: ProspectStatus.DEAD,
      lastCallOutcome: 'Do not contact',
      nextActionAt: null,
      notesSuffix: 'Marked as do not contact.'
    },
    booked: {
      status: ProspectStatus.BOOKED_DEMO,
      lastCallOutcome: 'Booked demo',
      nextActionAt: addDaysFromNow(1, 9),
      notesSuffix: 'Booked and needs meeting follow-up.'
    },
    sold: {
      status: ProspectStatus.CLOSED,
      lastCallOutcome: 'Sold - waiting for signup',
      nextActionAt: addDaysFromNow(2, 9),
      notesSuffix: 'Sold and should move into waiting-for-signup.'
    }
  };

  const selection = outcomeMap[outcome];

  if (!selection) {
    redirect(buildOurLeadsHref({ prospectId, q, status, city, nextActionDue }));
  }

  const existing = await db.prospect.findUnique({
    where: { id: prospectId },
    select: {
      id: true,
      notes: true
    }
  });

  if (!existing) {
    redirect(buildOurLeadsHref({ q, status, city, nextActionDue }));
  }

  await db.$transaction(async (tx) => {
    await tx.prospect.update({
      where: { id: prospectId },
      data: {
        status: selection.status,
        lastCallAt: new Date(),
        lastCallOutcome: selection.lastCallOutcome,
        nextActionAt: selection.nextActionAt,
        notes: selection.notesSuffix
          ? [existing.notes, selection.notesSuffix].filter(Boolean).join('\n')
          : existing.notes
      }
    });

    await tx.callLog.create({
      data: {
        prospectId,
        outcome: selection.lastCallOutcome,
        notes: selection.notesSuffix || undefined
      }
    });
  });

  revalidatePath('/our-leads');
  revalidatePath('/leads');
  redirect(
    buildOurLeadsHref({
      prospectId,
      q,
      status,
      city,
      nextActionDue,
      updated: outcome
    })
  );
}

export async function scheduleProspectCallbackAction(formData: FormData) {
  const prospectId = readText(formData, 'prospectId');
  const preset = readText(formData, 'preset');
  const q = readText(formData, 'q');
  const status = readText(formData, 'status');
  const city = readText(formData, 'city');
  const nextActionDue = readText(formData, 'nextActionDue');

  if (!prospectId) {
    redirect(buildOurLeadsHref({ q, status, city, nextActionDue }));
  }

  const callbackPlan = readCallbackPreset(preset);

  if (!callbackPlan) {
    redirect(buildOurLeadsHref({ prospectId, q, status, city, nextActionDue }));
  }

  const existing = await db.prospect.findUnique({
    where: { id: prospectId },
    select: {
      id: true
    }
  });

  if (!existing) {
    redirect(buildOurLeadsHref({ q, status, city, nextActionDue }));
  }

  await db.$transaction(async (tx) => {
    await tx.prospect.update({
      where: { id: prospectId },
      data: {
        status: ProspectStatus.GATEKEEPER,
        nextActionAt: callbackPlan.nextActionAt,
        lastCallOutcome: `Call back later - ${callbackPlan.label}`
      }
    });

    await tx.callLog.create({
      data: {
        prospectId,
        outcome: `Scheduled callback - ${callbackPlan.label}`,
        notes: `Callback preset chosen: ${callbackPlan.label}.`
      }
    });
  });

  revalidatePath('/our-leads');
  revalidatePath('/leads');
  redirect(
    buildOurLeadsHref({
      prospectId,
      q,
      status,
      city,
      nextActionDue,
      updated: 'callback'
    })
  );
}
