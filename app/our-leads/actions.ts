"use server";

import { Prisma, ProspectDedupKeyType, ProspectStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { normalizeClinicKey, normalizeWebsiteKey } from '@/lib/client-intake';
import { db } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';
import { buildProspectNotes, parseProspectNotes } from '@/lib/prospect-metadata';

const INTERNAL_COMPANY_ID = 'fixyourleads';

function readText(formData: FormData, key: string) {
  return String(formData.get(key) || '').trim();
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
  view,
  status,
  city,
  nextActionDue,
  updated,
  added,
  bulkAdded,
  bulkSkipped,
  bulkSkippedDuplicates,
  bulkSkippedInvalid,
  bulkError,
  error,
  duplicateReason,
  duplicateCompanyId,
  draft
}: {
  prospectId?: string;
  q?: string;
  view?: string;
  status?: string;
  city?: string;
  nextActionDue?: string;
  updated?: string;
  added?: string;
  bulkAdded?: string;
  bulkSkipped?: string;
  bulkSkippedDuplicates?: string;
  bulkSkippedInvalid?: string;
  bulkError?: string;
  error?: string;
  duplicateReason?: string;
  duplicateCompanyId?: string;
  draft?: {
    name?: string;
    phone?: string;
    city?: string;
    ownerName?: string;
    website?: string;
    nextActionAt?: string;
    notes?: string;
  };
}) {
  const params = new URLSearchParams();

  if (prospectId) {
    params.set('prospectId', prospectId);
  }

  if (q) {
    params.set('q', q);
  }

  if (view) {
    params.set('view', view);
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

  if (added) {
    params.set('added', added);
  }

  if (bulkAdded) {
    params.set('bulkAdded', bulkAdded);
  }

  if (bulkSkipped) {
    params.set('bulkSkipped', bulkSkipped);
  }

  if (bulkSkippedDuplicates) {
    params.set('bulkSkippedDuplicates', bulkSkippedDuplicates);
  }

  if (bulkSkippedInvalid) {
    params.set('bulkSkippedInvalid', bulkSkippedInvalid);
  }

  if (bulkError) {
    params.set('bulkError', bulkError);
  }

  if (error) {
    params.set('error', error);
  }

  if (duplicateReason) {
    params.set('duplicateReason', duplicateReason);
  }

  if (duplicateCompanyId) {
    params.set('duplicateCompanyId', duplicateCompanyId);
  }

  if (draft?.name) {
    params.set('draftName', draft.name);
  }

  if (draft?.phone) {
    params.set('draftPhone', draft.phone);
  }

  if (draft?.city) {
    params.set('draftCity', draft.city);
  }

  if (draft?.ownerName) {
    params.set('draftOwnerName', draft.ownerName);
  }

  if (draft?.website) {
    params.set('draftWebsite', draft.website);
  }

  if (draft?.nextActionAt) {
    params.set('draftNextActionAt', draft.nextActionAt);
  }

  if (draft?.notes) {
    params.set('draftNotes', draft.notes);
  }

  const query = params.toString();
  return query ? `/leads?${query}` : '/leads';
}

function readLeadDraft(formData: FormData) {
  return {
    name: readText(formData, 'name'),
    phone: readText(formData, 'phone'),
    city: readText(formData, 'city'),
    ownerName: readText(formData, 'ownerName'),
    website: readText(formData, 'website'),
    nextActionAt: readText(formData, 'nextActionAt'),
    notes: readText(formData, 'notes')
  };
}

function splitBulkRow(row: string) {
  if (row.includes('\t')) {
    return row.split('\t').map((part) => part.trim());
  }

  if (row.includes('|')) {
    return row.split('|').map((part) => part.trim());
  }

  return row.split(',').map((part) => part.trim());
}

function normalizeOptionalPhone(raw: string | null | undefined) {
  const normalized = normalizePhone(String(raw || '').trim());
  return normalized ? normalized : null;
}

function normalizeOptionalWebsiteKey(raw: string | null | undefined) {
  const key = normalizeWebsiteKey(String(raw || ''));
  return key ? key : null;
}

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function loadContactedCompanies() {
  return db.company.findMany({
    select: {
      id: true,
      name: true,
      contacts: {
        select: {
          phone: true
        }
      }
    }
  });
}

function findContactedCompanyDuplicate(
  contactedCompanies: Awaited<ReturnType<typeof loadContactedCompanies>>,
  {
    clinicKey,
    normalizedPhone
  }: {
    clinicKey: string;
    normalizedPhone: string | null;
  }
) {
  return (
    contactedCompanies.find((company) => normalizeClinicKey(company.name) === clinicKey) ||
    (normalizedPhone
      ? contactedCompanies.find((company) =>
          company.contacts.some((contact) => normalizePhone(contact.phone || '') === normalizedPhone)
        )
      : null) ||
    null
  );
}

async function findProspectDuplicateByKeys(options: {
  companyId: string;
  clinicKey: string;
  phoneKey: string | null;
  websiteKey: string | null;
}): Promise<{ prospectId: string; duplicateReason: 'clinic_name' | 'phone' | 'website' } | null> {
  const { companyId, clinicKey, phoneKey, websiteKey } = options;

  if (phoneKey) {
    const existing = await db.prospectDedupEntry.findFirst({
      where: {
        companyId,
        keyType: ProspectDedupKeyType.PHONE,
        keyValue: phoneKey
      },
      select: {
        prospectId: true
      }
    });

    if (existing) {
      return { prospectId: existing.prospectId, duplicateReason: 'phone' };
    }
  }

  if (websiteKey) {
    const existing = await db.prospectDedupEntry.findFirst({
      where: {
        companyId,
        keyType: ProspectDedupKeyType.WEBSITE,
        keyValue: websiteKey
      },
      select: {
        prospectId: true
      }
    });

    if (existing) {
      return { prospectId: existing.prospectId, duplicateReason: 'website' };
    }
  }

  const existing = await db.prospectDedupEntry.findFirst({
    where: {
      companyId,
      keyType: ProspectDedupKeyType.CLINIC,
      keyValue: clinicKey
    },
    select: {
      prospectId: true
    }
  });

  if (existing) {
    return { prospectId: existing.prospectId, duplicateReason: 'clinic_name' };
  }

  return null;
}

async function createProspectDedupEntries(
  tx: Prisma.TransactionClient,
  options: {
    companyId: string;
    prospectId: string;
    clinicKey: string;
    phoneKey: string | null;
    websiteKey: string | null;
  }
) {
  const { companyId, prospectId, clinicKey, phoneKey, websiteKey } = options;

  await tx.prospectDedupEntry.create({
    data: {
      companyId,
      prospectId,
      keyType: ProspectDedupKeyType.CLINIC,
      keyValue: clinicKey
    }
  });

  if (phoneKey) {
    await tx.prospectDedupEntry.create({
      data: {
        companyId,
        prospectId,
        keyType: ProspectDedupKeyType.PHONE,
        keyValue: phoneKey
      }
    });
  }

  if (websiteKey) {
    await tx.prospectDedupEntry.create({
      data: {
        companyId,
        prospectId,
        keyType: ProspectDedupKeyType.WEBSITE,
        keyValue: websiteKey
      }
    });
  }
}

function readCurrentView(formData: FormData) {
  return {
    q: readText(formData, 'viewQ'),
    view: readText(formData, 'viewMode'),
    status: readText(formData, 'viewStatus'),
    city: readText(formData, 'viewCity'),
    nextActionDue: readText(formData, 'viewNextActionDue')
  };
}

function formatHistoryDateTime(date: Date) {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

export async function createProspectAction(formData: FormData) {
  const currentView = readCurrentView(formData);
  const draft = readLeadDraft(formData);
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
    redirect(`${buildOurLeadsHref({ ...currentView, error: 'name_required', draft })}#add-prospect`);
  }

  const status = Object.values(ProspectStatus).includes(requestedStatus as ProspectStatus)
    ? (requestedStatus as ProspectStatus)
    : ProspectStatus.NEW;
  const clinicKey = normalizeClinicKey(name);
  const normalizedPhone = rawPhone ? normalizeOptionalPhone(rawPhone) : null;
  const websiteKey = normalizeOptionalWebsiteKey(website);
  const nextActionAt = nextActionRaw ? new Date(nextActionRaw) : null;

  if (rawPhone && !normalizedPhone) {
    redirect(`${buildOurLeadsHref({ ...currentView, error: 'invalid_phone', draft })}#add-prospect`);
  }

  if (!clinicKey) {
    redirect(`${buildOurLeadsHref({ ...currentView, error: 'name_required', draft })}#add-prospect`);
  }

  if (nextActionAt && Number.isNaN(nextActionAt.getTime())) {
    redirect(`${buildOurLeadsHref({ ...currentView, error: 'invalid_next_action', draft })}#add-prospect`);
  }

  const prospectDuplicate = await findProspectDuplicateByKeys({
    companyId: INTERNAL_COMPANY_ID,
    clinicKey,
    phoneKey: normalizedPhone,
    websiteKey
  });

  if (prospectDuplicate) {
    redirect(
      `${buildOurLeadsHref({
        ...currentView,
        prospectId: prospectDuplicate.prospectId,
        error: 'duplicate',
        duplicateReason: prospectDuplicate.duplicateReason,
        draft
      })}#selected-lead`
    );
  }

  const contactedCompanies = await loadContactedCompanies();
  const contactedCompanyDuplicate = findContactedCompanyDuplicate(contactedCompanies, {
    clinicKey,
    normalizedPhone
  });

  if (contactedCompanyDuplicate) {
    const duplicateReason =
      normalizedPhone &&
      contactedCompanyDuplicate.contacts.some((contact) => normalizePhone(contact.phone || '') === normalizedPhone)
        ? 'master_phone'
        : 'master_name';

    redirect(
      buildOurLeadsHref({
        ...currentView,
        error: 'duplicate',
        duplicateReason,
        duplicateCompanyId: contactedCompanyDuplicate.id,
        draft
      })
    );
  }

  let prospectId: string | null = null;

  try {
    const created = await db.$transaction(async (tx) => {
      const prospect = await tx.prospect.create({
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
        },
        select: {
          id: true
        }
      });

      await createProspectDedupEntries(tx, {
        companyId: INTERNAL_COMPANY_ID,
        prospectId: prospect.id,
        clinicKey,
        phoneKey: normalizedPhone,
        websiteKey
      });

      return prospect;
    });

    prospectId = created.id;
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const duplicate = await findProspectDuplicateByKeys({
      companyId: INTERNAL_COMPANY_ID,
      clinicKey,
      phoneKey: normalizedPhone,
      websiteKey
    });

    if (duplicate) {
      redirect(
        `${buildOurLeadsHref({
          ...currentView,
          prospectId: duplicate.prospectId,
          error: 'duplicate',
          duplicateReason: duplicate.duplicateReason,
          draft
        })}#selected-lead`
      );
    }

    redirect(`${buildOurLeadsHref({ ...currentView, error: 'duplicate', draft })}#add-prospect`);
  }

  revalidatePath('/our-leads');
  revalidatePath('/leads');
  redirect(
    buildOurLeadsHref({
      ...currentView,
      prospectId: prospectId ?? undefined,
      added: '1'
    })
  );
}

export async function bulkCreateProspectsAction(formData: FormData) {
  const currentView = readCurrentView(formData);
  const rowsRaw = readText(formData, 'rows');

  if (!rowsRaw) {
    redirect(buildOurLeadsHref({ ...currentView, bulkError: 'bulk_required' }));
  }

  const contactedCompanies = await loadContactedCompanies();
  const rows = rowsRaw
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  let addedCount = 0;
  let duplicateSkippedCount = 0;
  let invalidSkippedCount = 0;

  for (const row of rows) {
    const [nameRaw, phoneRaw = '', cityRaw = '', ownerNameRaw = '', websiteRaw = '', nextActionRaw = '', notesRaw = ''] =
      splitBulkRow(row);
    const name = nameRaw?.trim();

    if (!name) {
      invalidSkippedCount += 1;
      continue;
    }

    const clinicKey = normalizeClinicKey(name);
    const normalizedPhone = phoneRaw ? normalizeOptionalPhone(phoneRaw) : null;
    const websiteKey = normalizeOptionalWebsiteKey(websiteRaw);
    const nextActionAt = nextActionRaw ? new Date(nextActionRaw) : null;

    if (!clinicKey) {
      invalidSkippedCount += 1;
      continue;
    }

    if (phoneRaw && !normalizedPhone) {
      invalidSkippedCount += 1;
      continue;
    }

    if (nextActionAt && Number.isNaN(nextActionAt.getTime())) {
      invalidSkippedCount += 1;
      continue;
    }

    const contactedCompanyDuplicate = findContactedCompanyDuplicate(contactedCompanies, {
      clinicKey,
      normalizedPhone
    });

    if (contactedCompanyDuplicate) {
      duplicateSkippedCount += 1;
      continue;
    }

    try {
      await db.$transaction(async (tx) => {
        const created = await tx.prospect.create({
          data: {
            companyId: INTERNAL_COMPANY_ID,
            name,
            phone: normalizedPhone,
            city: cityRaw || null,
            website: websiteRaw || null,
            ownerName: ownerNameRaw || null,
            status: ProspectStatus.NEW,
            nextActionAt,
            notes: buildProspectNotes({
              plainNotes: notesRaw || null
            })
          },
          select: {
            id: true
          }
        });

        await createProspectDedupEntries(tx, {
          companyId: INTERNAL_COMPANY_ID,
          prospectId: created.id,
          clinicKey,
          phoneKey: normalizedPhone,
          websiteKey
        });
      });

      addedCount += 1;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        duplicateSkippedCount += 1;
        continue;
      }

      throw error;
    }
  }

  revalidatePath('/our-leads');
  revalidatePath('/leads');
  redirect(
    buildOurLeadsHref({
      ...currentView,
      bulkAdded: String(addedCount),
      bulkSkippedDuplicates: String(duplicateSkippedCount),
      bulkSkippedInvalid: String(invalidSkippedCount)
    })
  );
}

export async function updateProspectOutcomeAction(formData: FormData) {
  const prospectId = readText(formData, 'prospectId');
  const nextProspectId = readText(formData, 'nextProspectId');
  const outcome = readText(formData, 'outcome');
  const q = readText(formData, 'q');
  const view = readText(formData, 'view');
  const status = readText(formData, 'status');
  const city = readText(formData, 'city');
  const nextActionDue = readText(formData, 'nextActionDue');

  if (!prospectId) {
    redirect(buildOurLeadsHref({ q, view, status, city, nextActionDue }));
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
    redirect(buildOurLeadsHref({ prospectId, q, view, status, city, nextActionDue }));
  }

  const existing = await db.prospect.findUnique({
    where: { id: prospectId },
    select: {
      id: true,
      notes: true
    }
  });

  if (!existing) {
    redirect(buildOurLeadsHref({ q, view, status, city, nextActionDue }));
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
      prospectId: nextProspectId || prospectId,
      q,
      view,
      status,
      city,
      nextActionDue,
      updated: outcome
    })
  );
}

export async function scheduleProspectCallbackAction(formData: FormData) {
  const prospectId = readText(formData, 'prospectId');
  const nextProspectId = readText(formData, 'nextProspectId');
  const preset = readText(formData, 'preset');
  const q = readText(formData, 'q');
  const view = readText(formData, 'view');
  const status = readText(formData, 'status');
  const city = readText(formData, 'city');
  const nextActionDue = readText(formData, 'nextActionDue');

  if (!prospectId) {
    redirect(buildOurLeadsHref({ q, view, status, city, nextActionDue }));
  }

  const callbackPlan = readCallbackPreset(preset);

  if (!callbackPlan) {
    redirect(buildOurLeadsHref({ prospectId, q, view, status, city, nextActionDue }));
  }

  const existing = await db.prospect.findUnique({
    where: { id: prospectId },
    select: {
      id: true
    }
  });

  if (!existing) {
    redirect(buildOurLeadsHref({ q, view, status, city, nextActionDue }));
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
      prospectId: nextProspectId || prospectId,
      q,
      view,
      status,
      city,
      nextActionDue,
      updated: 'callback'
    })
  );
}

export async function updateProspectDetailsAction(formData: FormData) {
  const prospectId = readText(formData, 'prospectId');
  const q = readText(formData, 'q');
  const view = readText(formData, 'view');
  const status = readText(formData, 'status');
  const city = readText(formData, 'city');
  const nextActionDue = readText(formData, 'nextActionDue');
  const notes = readText(formData, 'notes');
  const nextActionRaw = readText(formData, 'nextActionAt');

  if (!prospectId) {
    redirect(buildOurLeadsHref({ q, view, status, city, nextActionDue }));
  }

  const nextActionAt = nextActionRaw ? new Date(nextActionRaw) : null;

  if (nextActionAt && Number.isNaN(nextActionAt.getTime())) {
    redirect(
      buildOurLeadsHref({
        prospectId,
        q,
        view,
        status,
        city,
        nextActionDue,
        updated: 'invalid_details'
      })
    );
  }

  const existing = await db.prospect.findUnique({
    where: { id: prospectId },
    select: {
      id: true,
      notes: true,
      nextActionAt: true
    }
  });

  if (!existing) {
    redirect(buildOurLeadsHref({ q, view, status, city, nextActionDue }));
  }

  const parsed = parseProspectNotes(existing.notes);
  const previousPlainNotes = parsed.plainNotes.trim();
  const previousNextAction = existing.nextActionAt?.toISOString() || '';
  const noteChanged = previousPlainNotes !== notes;
  const nextActionChanged = previousNextAction !== (nextActionAt?.toISOString() || '');

  await db.$transaction(async (tx) => {
    await tx.prospect.update({
      where: { id: prospectId },
      data: {
        nextActionAt,
        notes: buildProspectNotes({
          plainNotes: notes,
          clinicType: parsed.profile.clinicType,
          zipCode: parsed.profile.zipCode,
          predictedRevenue: parsed.profile.predictedRevenue,
          sourceLabel: parsed.profile.source,
          importBatch: parsed.profile.importBatch,
          sourceRecord: parsed.profile.sourceRecord,
          logoUrl: parsed.profile.logoUrl
        })
      }
    });

    if (noteChanged || nextActionChanged) {
      const historyParts: string[] = [];
      let outcome = 'Updated contact details';

      if (noteChanged && nextActionChanged) {
        outcome = nextActionAt ? 'Updated note and follow-up date' : 'Updated note and cleared follow-up date';
      } else if (noteChanged) {
        outcome = notes ? 'Updated note' : 'Cleared note';
      } else if (nextActionChanged) {
        outcome = nextActionAt ? 'Updated follow-up date' : 'Cleared follow-up date';
      }

      if (noteChanged) {
        historyParts.push(notes ? 'Note updated.' : 'Note cleared.');
      }

      if (nextActionChanged) {
        historyParts.push(
          nextActionAt ? `Next action set for ${formatHistoryDateTime(nextActionAt)}.` : 'Next action date removed.'
        );
      }

      await tx.callLog.create({
        data: {
          prospectId,
          outcome,
          notes: historyParts.join(' ')
        }
      });
    }
  });

  revalidatePath('/our-leads');
  revalidatePath('/leads');
  redirect(
    buildOurLeadsHref({
      prospectId,
      q,
      view,
      status,
      city,
      nextActionDue,
      updated: 'details'
    })
  );
}
