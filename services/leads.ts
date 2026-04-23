import { LeadStatus, WorkflowType } from '@prisma/client';
import { db } from '@/lib/db';
import { searchGoogleMapsClinics } from '@/lib/google-maps';
import { normalizePhone } from '@/lib/phone';
import { activateWorkflowRun, ensurePhoneChannelIdentities } from '@/lib/workflows';

type CreateLeadFlowInput = {
  companyId: string;
  phone: string;
  name?: string;
  source?: string;
  sourceExternalId?: string;
};

type LeadMatchReason = 'sourceExternalId' | 'contactPhone' | 'new';

type CreateLeadFlowResult = {
  contact: {
    id: string;
    companyId: string;
    name: string | null;
    phone: string;
    createdAt: Date;
  };
  lead: {
    id: string;
    companyId: string;
    contactId: string;
    status: LeadStatus;
    source: string | null;
    sourceExternalId: string | null;
    lastContactedAt: Date | null;
    lastRepliedAt: Date | null;
    suppressedAt: Date | null;
    suppressionReason: string | null;
    createdAt: Date;
  };
  conversation: {
    id: string;
    companyId: string;
    contactId: string;
    createdAt: Date;
  };
  duplicate: boolean;
  queueInitialOutreach: boolean;
  suppressed: boolean;
  matchedBy: LeadMatchReason;
  normalizedPhone: string;
};

type ImportGoogleMapsLeadsInput = {
  companyId: string;
  query: string;
  limit?: number;
};

type ImportedGoogleMapsLead = {
  placeId: string;
  name: string;
  phone: string | null;
  normalizedPhone: string;
  address: string | null;
  websiteUrl: string | null;
  googleMapsUrl: string | null;
  primaryType: string | null;
  status: 'imported' | 'duplicate' | 'suppressed' | 'skipped_no_phone';
  leadId: string | null;
  contactId: string | null;
  conversationId: string | null;
};

function cleanOptionalString(value?: string) {
  const cleaned = typeof value === 'string' ? value.trim() : '';
  return cleaned || undefined;
}

function buildDuplicatePayload({
  lead,
  contactId,
  conversationId,
  source,
  sourceExternalId,
  normalizedPhone,
  matchedBy
}: {
  lead: CreateLeadFlowResult['lead'];
  contactId: string;
  conversationId: string;
  source?: string;
  sourceExternalId?: string;
  normalizedPhone: string;
  matchedBy: Exclude<LeadMatchReason, 'new'>;
}) {
  return {
    leadId: lead.id,
    contactId,
    conversationId,
    source: source || null,
    sourceExternalId: sourceExternalId || null,
    normalizedPhone,
    matchedBy,
    suppressed: lead.status === LeadStatus.SUPPRESSED,
    leadStatus: lead.status
  };
}

export async function createLeadFlow({
  companyId,
  phone,
  name,
  source,
  sourceExternalId
}: CreateLeadFlowInput): Promise<CreateLeadFlowResult> {
  const normalizedPhone = normalizePhone(phone);
  const cleanedName = cleanOptionalString(name);
  const cleanedSource = cleanOptionalString(source);
  const cleanedSourceExternalId = cleanOptionalString(sourceExternalId);

  if (!companyId) {
    throw new Error('company_id_required');
  }

  if (!normalizedPhone) {
    throw new Error('invalid_phone');
  }

  const result: CreateLeadFlowResult = await db.$transaction(async (tx) => {
    const existingLeadBySource =
      cleanedSource && cleanedSourceExternalId
        ? await tx.lead.findFirst({
            where: {
              companyId,
              source: cleanedSource,
              sourceExternalId: cleanedSourceExternalId
            },
            include: { contact: true },
            orderBy: { createdAt: 'desc' }
          })
        : null;

    if (existingLeadBySource) {
      const contact =
        cleanedName && !existingLeadBySource.contact.name
          ? await tx.contact.update({
              where: { id: existingLeadBySource.contact.id },
              data: { name: cleanedName }
            })
          : existingLeadBySource.contact;

      const conversation = await tx.conversation.upsert({
        where: { companyId_contactId: { companyId, contactId: contact.id } },
        update: {},
        create: { companyId, contactId: contact.id }
      });

      const lead =
        !existingLeadBySource.source && cleanedSource
          ? await tx.lead.update({
              where: { id: existingLeadBySource.id },
              data: {
                source: cleanedSource,
                sourceExternalId: existingLeadBySource.sourceExternalId || cleanedSourceExternalId
              }
            })
          : existingLeadBySource;

      await tx.eventLog.create({
        data: {
          companyId,
          eventType: 'lead_reingested',
          payload: buildDuplicatePayload({
            lead,
            contactId: contact.id,
            conversationId: conversation.id,
            source: cleanedSource,
            sourceExternalId: cleanedSourceExternalId,
            normalizedPhone,
            matchedBy: 'sourceExternalId'
          })
        }
      });

      return {
        contact,
        lead,
        conversation,
        duplicate: true,
        queueInitialOutreach: false,
        suppressed: lead.status === LeadStatus.SUPPRESSED,
        matchedBy: 'sourceExternalId',
        normalizedPhone
      };
    }

    const contact = await tx.contact.upsert({
      where: { companyId_phone: { companyId, phone: normalizedPhone } },
      update: { name: cleanedName || undefined, phone: normalizedPhone },
      create: { companyId, phone: normalizedPhone, name: cleanedName }
    });

    const conversation = await tx.conversation.upsert({
      where: { companyId_contactId: { companyId, contactId: contact.id } },
      update: {},
      create: { companyId, contactId: contact.id }
    });

    const existingLead = await tx.lead.findFirst({
      where: { companyId, contactId: contact.id },
      orderBy: { createdAt: 'desc' }
    });

    if (existingLead) {
      const lead =
        (!existingLead.source && cleanedSource) || (!existingLead.sourceExternalId && cleanedSourceExternalId)
          ? await tx.lead.update({
              where: { id: existingLead.id },
              data: {
                source: existingLead.source || cleanedSource,
                sourceExternalId: existingLead.sourceExternalId || cleanedSourceExternalId
              }
            })
          : existingLead;

      await tx.eventLog.create({
        data: {
          companyId,
          eventType: 'lead_reingested',
          payload: buildDuplicatePayload({
            lead,
            contactId: contact.id,
            conversationId: conversation.id,
            source: cleanedSource,
            sourceExternalId: cleanedSourceExternalId,
            normalizedPhone,
            matchedBy: 'contactPhone'
          })
        }
      });

      return {
        contact,
        lead,
        conversation,
        duplicate: true,
        queueInitialOutreach: false,
        suppressed: lead.status === LeadStatus.SUPPRESSED,
        matchedBy: 'contactPhone',
        normalizedPhone
      };
    }

    const lead = await tx.lead.create({
      data: {
        companyId,
        contactId: contact.id,
        source: cleanedSource,
        sourceExternalId: cleanedSourceExternalId
      }
    });

    await tx.eventLog.create({
      data: {
        companyId,
        eventType: 'lead_created',
        payload: {
          leadId: lead.id,
          contactId: contact.id,
          conversationId: conversation.id,
          normalizedPhone,
          source: cleanedSource || null,
          sourceExternalId: cleanedSourceExternalId || null
        }
      }
    });

    return {
      contact,
      lead,
      conversation,
      duplicate: false,
      queueInitialOutreach: true,
      suppressed: false,
      matchedBy: 'new',
      normalizedPhone
    };
  });

  await ensurePhoneChannelIdentities(companyId, result.contact.id, normalizedPhone);

  if (!result.duplicate) {
    await activateWorkflowRun({
      companyId,
      contactId: result.contact.id,
      conversationId: result.conversation.id,
      leadId: result.lead.id,
      workflowType: WorkflowType.NEW_LEAD_FOLLOW_UP,
      reason: 'lead_created',
      payload: {
        source: result.lead.source,
        sourceExternalId: result.lead.sourceExternalId
      }
    });
  }

  return result;
}

export async function importGoogleMapsLeads({
  companyId,
  query,
  limit = 10
}: ImportGoogleMapsLeadsInput) {
  if (!companyId) {
    throw new Error('company_id_required');
  }

  const clinics = await searchGoogleMapsClinics({ query, limit });
  const importedLeads: ImportedGoogleMapsLead[] = [];

  let imported = 0;
  let duplicates = 0;
  let suppressedDuplicates = 0;
  let skippedNoPhone = 0;

  for (const clinic of clinics) {
    const normalizedPhone = normalizePhone(clinic.phone || '');

    if (!normalizedPhone) {
      skippedNoPhone += 1;
      importedLeads.push({
        placeId: clinic.placeId,
        name: clinic.name,
        phone: clinic.phone,
        normalizedPhone: '',
        address: clinic.address,
        websiteUrl: clinic.websiteUrl,
        googleMapsUrl: clinic.googleMapsUrl,
        primaryType: clinic.primaryType,
        status: 'skipped_no_phone',
        leadId: null,
        contactId: null,
        conversationId: null
      });
      continue;
    }

    const result = await createLeadFlow({
      companyId,
      phone: normalizedPhone,
      name: clinic.name,
      source: 'google_maps',
      sourceExternalId: clinic.placeId
    });

    if (result.duplicate) {
      duplicates += 1;

      if (result.suppressed) {
        suppressedDuplicates += 1;
      }
    } else {
      imported += 1;
    }

    importedLeads.push({
      placeId: clinic.placeId,
      name: clinic.name,
      phone: clinic.phone,
      normalizedPhone,
      address: clinic.address,
      websiteUrl: clinic.websiteUrl,
      googleMapsUrl: clinic.googleMapsUrl,
      primaryType: clinic.primaryType,
      status: result.suppressed ? 'suppressed' : result.duplicate ? 'duplicate' : 'imported',
      leadId: result.lead.id,
      contactId: result.contact.id,
      conversationId: result.conversation.id
    });
  }

  await db.eventLog.create({
    data: {
      companyId,
      eventType: 'google_maps_import_completed',
      payload: {
        query,
        imported,
        duplicates,
        suppressedDuplicates,
        skippedNoPhone,
        results: importedLeads.length
      }
    }
  });

  return {
    query,
    imported,
    duplicates,
    suppressedDuplicates,
    skippedNoPhone,
    results: importedLeads
  };
}
