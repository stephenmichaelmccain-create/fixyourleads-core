"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { telnyxChecklistOrder } from '@/lib/client-telnyx-setup';

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value || '').trim();
  return text || null;
}

export async function saveClientTelnyxSetupAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();

  if (!companyId) {
    throw new Error('company_id_required');
  }

  const payload = {
    ...Object.fromEntries(telnyxChecklistOrder.map((item) => [item.key, formData.get(item.key) === 'on'])),
    legalBusinessName: optionalText(formData.get('legalBusinessName')),
    ein: optionalText(formData.get('ein')),
    businessAddress: optionalText(formData.get('businessAddress')),
    businessEmail: optionalText(formData.get('businessEmail')),
    businessPhone: optionalText(formData.get('businessPhone')),
    website: optionalText(formData.get('website')),
    brandId: optionalText(formData.get('brandId')),
    brandStatus: optionalText(formData.get('brandStatus')),
    campaignId: optionalText(formData.get('campaignId')),
    campaignStatus: optionalText(formData.get('campaignStatus')),
    messagingProfileId: optionalText(formData.get('messagingProfileId')),
    messagingProfileStatus: optionalText(formData.get('messagingProfileStatus')),
    phoneNumber: optionalText(formData.get('phoneNumber')),
    webhookUrl: optionalText(formData.get('webhookUrl')),
    automationUrl: optionalText(formData.get('automationUrl')),
    intakeFormUrl: optionalText(formData.get('intakeFormUrl')),
    documentationUrl: optionalText(formData.get('documentationUrl')),
    sampleMessage: optionalText(formData.get('sampleMessage')),
    monthlyVolume: optionalText(formData.get('monthlyVolume')),
    complianceNotes: optionalText(formData.get('complianceNotes')),
    notes: optionalText(formData.get('notes')),
    updatedAt: new Date().toISOString()
  };

  await db.eventLog.create({
    data: {
      companyId,
      eventType: 'client_telnyx_setup_updated',
      payload
    }
  });

  revalidatePath(`/clients/${companyId}`);
  revalidatePath(`/clients/${companyId}/operator`);
  revalidatePath(`/clients/${companyId}/telnyx`);
  revalidatePath(`/events?companyId=${companyId}`);

  redirect(`/clients/${companyId}/telnyx?notice=updated`);
}
