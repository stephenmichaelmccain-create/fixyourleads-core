"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { encryptJson } from '@/lib/encrypted-json';
import { calendarChecklistOrder } from '@/lib/client-calendar-setup';

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value || '').trim();
  return text || null;
}

function payloadText(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === 'string' ? value.trim() || null : null;
}

function payloadBoolean(payload: Record<string, unknown>, key: string) {
  return payload[key] === true;
}

function bookingPath(companyId: string, notice: string) {
  return `/clients/${companyId}/booking?notice=${notice}`;
}

export async function saveClientCalendarSetupAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();

  if (!companyId) {
    throw new Error('company_id_required');
  }

  const latestSetupEvent = await db.eventLog.findFirst({
    where: {
      companyId,
      eventType: 'client_calendar_setup_updated'
    },
    orderBy: { createdAt: 'desc' },
    select: {
      payload: true
    }
  });

  const existingPayload =
    latestSetupEvent?.payload && typeof latestSetupEvent.payload === 'object' && !Array.isArray(latestSetupEvent.payload)
      ? (latestSetupEvent.payload as Record<string, unknown>)
      : {};

  const existingEncryptedBookingCredentials =
    typeof existingPayload.externalPlatformCredentialsEncrypted === 'string'
      ? existingPayload.externalPlatformCredentialsEncrypted.trim()
      : '';

  let bookingCredentialsEncrypted = existingEncryptedBookingCredentials || null;

  try {
    const externalPlatformApiKey = optionalText(formData.get('externalPlatformApiKey'));
    const externalPlatformSecondaryKey = optionalText(formData.get('externalPlatformSecondaryKey'));

    if (externalPlatformApiKey || externalPlatformSecondaryKey) {
      bookingCredentialsEncrypted = encryptJson({
        apiKey: externalPlatformApiKey,
        secondaryKey: externalPlatformSecondaryKey
      });
    }
  } catch (error) {
    const notice = error instanceof Error && error.message === 'crm_encryption_key_missing'
      ? 'encryption_key_missing'
      : 'credentials_invalid';
    redirect(bookingPath(companyId, notice));
  }

  const payload = {
    ...existingPayload,
    ...Object.fromEntries(
      calendarChecklistOrder.map((item) => [
        item.key,
        formData.has(item.key) ? formData.get(item.key) === 'on' : payloadBoolean(existingPayload, item.key)
      ])
    ),
    connectionMode: formData.has('connectionMode')
      ? optionalText(formData.get('connectionMode'))
      : payloadText(existingPayload, 'connectionMode'),
    googleAccountEmail: formData.has('googleAccountEmail')
      ? optionalText(formData.get('googleAccountEmail'))
      : payloadText(existingPayload, 'googleAccountEmail'),
    googleCalendarId: formData.has('googleCalendarId')
      ? optionalText(formData.get('googleCalendarId'))
      : payloadText(existingPayload, 'googleCalendarId'),
    sharedCalendarName: formData.has('sharedCalendarName')
      ? optionalText(formData.get('sharedCalendarName'))
      : payloadText(existingPayload, 'sharedCalendarName'),
    sharedCalendarShareEmail: formData.has('sharedCalendarShareEmail')
      ? optionalText(formData.get('sharedCalendarShareEmail'))
      : payloadText(existingPayload, 'sharedCalendarShareEmail'),
    externalPlatformName: formData.has('externalPlatformName')
      ? optionalText(formData.get('externalPlatformName'))
      : payloadText(existingPayload, 'externalPlatformName'),
    externalPlatformUrl: formData.has('externalPlatformUrl')
      ? optionalText(formData.get('externalPlatformUrl'))
      : payloadText(existingPayload, 'externalPlatformUrl'),
    externalCalendarId: formData.has('externalCalendarId')
      ? optionalText(formData.get('externalCalendarId'))
      : payloadText(existingPayload, 'externalCalendarId'),
    externalPlatformCredentialsEncrypted: bookingCredentialsEncrypted,
    timezone: formData.has('timezone')
      ? optionalText(formData.get('timezone'))
      : payloadText(existingPayload, 'timezone'),
    defaultDurationMinutes: formData.has('defaultDurationMinutes')
      ? optionalText(formData.get('defaultDurationMinutes'))
      : payloadText(existingPayload, 'defaultDurationMinutes'),
    reviewAutomationEnabled: formData.has('reviewAutomationEnabled')
      ? formData.get('reviewAutomationEnabled') === 'on'
      : payloadBoolean(existingPayload, 'reviewAutomationEnabled'),
    reviewGoogleReviewUrl: formData.has('reviewGoogleReviewUrl')
      ? optionalText(formData.get('reviewGoogleReviewUrl'))
      : payloadText(existingPayload, 'reviewGoogleReviewUrl'),
    reviewOwnerAlertContact: formData.has('reviewOwnerAlertContact')
      ? optionalText(formData.get('reviewOwnerAlertContact'))
      : payloadText(existingPayload, 'reviewOwnerAlertContact'),
    reviewWebhookSecret: formData.has('reviewWebhookSecret')
      ? optionalText(formData.get('reviewWebhookSecret'))
      : payloadText(existingPayload, 'reviewWebhookSecret'),
    reviewDelayHours: formData.has('reviewDelayHours')
      ? optionalText(formData.get('reviewDelayHours'))
      : payloadText(existingPayload, 'reviewDelayHours'),
    notes: formData.has('notes') ? optionalText(formData.get('notes')) : payloadText(existingPayload, 'notes'),
    updatedAt: new Date().toISOString()
  };

  await db.eventLog.create({
    data: {
      companyId,
      eventType: 'client_calendar_setup_updated',
      payload
    }
  });

  revalidatePath(`/clients/${companyId}`);
  revalidatePath(`/clients/${companyId}/calendar`);
  revalidatePath(`/clients/${companyId}/booking`);
  revalidatePath(`/clients/${companyId}/operator`);
  revalidatePath(`/events?companyId=${companyId}`);
  revalidatePath(`/bookings?companyId=${companyId}`);

  redirect(`/clients/${companyId}/booking?notice=updated`);
}
