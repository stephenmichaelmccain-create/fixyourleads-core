"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { emptyTelnyxSetupState, parseTelnyxSetupPayload } from '@/lib/client-telnyx-setup';

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value || '').trim();
  return text || null;
}

export async function saveClientTelnyxSetupAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();

  if (!companyId) {
    throw new Error('company_id_required');
  }

  const latestSetupEvent = await db.eventLog.findFirst({
    where: { companyId, eventType: 'client_telnyx_setup_updated' },
    orderBy: { createdAt: 'desc' },
    select: { payload: true }
  });

  const existing = latestSetupEvent ? parseTelnyxSetupPayload(latestSetupEvent.payload) : emptyTelnyxSetupState;
  const payload = {
    ...existing,
    clientInfoCollected: formData.has('clientInfoCollected') ? formData.get('clientInfoCollected') === 'on' : existing.clientInfoCollected,
    webhookConfigured: formData.has('webhookConfigured') ? formData.get('webhookConfigured') === 'on' : existing.webhookConfigured,
    launchApproved: formData.has('launchApproved') ? formData.get('launchApproved') === 'on' : existing.launchApproved,
    legalBusinessName: formData.has('legalBusinessName') ? optionalText(formData.get('legalBusinessName')) : existing.legalBusinessName,
    businessEmail: formData.has('businessEmail') ? optionalText(formData.get('businessEmail')) : existing.businessEmail,
    businessPhone: formData.has('businessPhone') ? optionalText(formData.get('businessPhone')) : existing.businessPhone,
    website: formData.has('website') ? optionalText(formData.get('website')) : existing.website,
    phoneNumber: formData.has('phoneNumber') ? optionalText(formData.get('phoneNumber')) : existing.phoneNumber,
    webhookUrl: formData.has('webhookUrl') ? optionalText(formData.get('webhookUrl')) : existing.webhookUrl,
    automationUrl: formData.has('automationUrl') ? optionalText(formData.get('automationUrl')) : existing.automationUrl,
    documentationUrl: formData.has('documentationUrl') ? optionalText(formData.get('documentationUrl')) : existing.documentationUrl,
    notes: formData.has('notes') ? optionalText(formData.get('notes')) : existing.notes,
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
