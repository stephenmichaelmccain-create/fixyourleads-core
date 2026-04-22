import { z } from 'zod';

export type WebsitePayloadRecord = Record<string, string>;

export const websiteIntakeSchema = z.object({
  clinicName: z.string().trim().min(1),
  contactName: z.string().trim().min(1).optional(),
  notificationEmail: z.string().trim().email().optional(),
  phone: z.string().trim().min(7).optional(),
  website: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  sourceExternalId: z.string().trim().min(1).optional()
});

export const websiteOnboardingSchema = z.object({
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

function pickFirstValue(payload: WebsitePayloadRecord, keys: string[]) {
  for (const key of keys) {
    const value = String(payload[key] || '').trim();

    if (value) {
      return value;
    }
  }

  return undefined;
}

function pickTaxIdLast4(payload: WebsitePayloadRecord) {
  const direct = pickFirstValue(payload, ['taxIdLast4', 'tax_id_last4', 'einLast4', 'ein_last4']);
  if (direct) {
    return direct.slice(-4);
  }

  const rawEin = pickFirstValue(payload, ['ein', 'tax_id', 'taxId']);
  if (!rawEin) {
    return undefined;
  }

  const digitsOnly = rawEin.replace(/\D/g, '');
  return digitsOnly.length >= 4 ? digitsOnly.slice(-4) : undefined;
}

export async function readWebsitePayload(request: Request): Promise<WebsitePayloadRecord | null> {
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

export function normalizeWebsiteIntakePayload(payload: WebsitePayloadRecord) {
  return {
    clinicName: pickFirstValue(payload, [
      'clinicName',
      'clinic_name',
      'business',
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
      'name',
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
      'page_url',
      'site',
      'domain'
    ]),
    source: pickFirstValue(payload, ['source', 'form_type', 'formSource', 'form_source', 'channel']),
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

export function normalizeWebsiteOnboardingPayload(payload: WebsitePayloadRecord) {
  return {
    clinicName: pickFirstValue(payload, [
      'clinicName',
      'clinic_name',
      'dba_name',
      'legal_name',
      'business',
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
      'rep_name',
      'name',
      'ownerName',
      'owner_name',
      'fullName',
      'full_name'
    ]),
    notificationEmail: pickFirstValue(payload, [
      'notificationEmail',
      'notification_email',
      'rep_email',
      'notify_email',
      'email',
      'contactEmail',
      'contact_email'
    ]),
    phone: pickFirstValue(payload, [
      'phone',
      'phoneNumber',
      'phone_number',
      'rep_phone',
      'contactPhone',
      'contact_phone'
    ]),
    website: pickFirstValue(payload, [
      'website',
      'websiteUrl',
      'website_url',
      'page_url',
      'site',
      'domain'
    ]),
    source: pickFirstValue(payload, ['source', 'form_type', 'formSource', 'form_source', 'channel']),
    sourceExternalId: pickFirstValue(payload, [
      'sourceExternalId',
      'source_external_id',
      'submissionId',
      'submission_id',
      'recordId',
      'record_id'
    ]),
    businessType: pickFirstValue(payload, [
      'businessType',
      'business_type',
      'clinicType',
      'clinic_type',
      'vertical',
      'legal_form',
      'entity_type'
    ]),
    campaignUseCase: pickFirstValue(payload, [
      'campaignUseCase',
      'campaign_use_case',
      'useCase',
      'use_case',
      'campaign_description',
      'opt_in_method'
    ]),
    telnyxBrandName: pickFirstValue(payload, [
      'telnyxBrandName',
      'telnyx_brand_name',
      'brandName',
      'brand_name',
      'dba_name',
      'legal_name'
    ]),
    taxIdLast4: pickTaxIdLast4(payload)
  };
}
