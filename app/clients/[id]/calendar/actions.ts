"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { calendarChecklistOrder } from '@/lib/client-calendar-setup';

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value || '').trim();
  return text || null;
}

export async function saveClientCalendarSetupAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();

  if (!companyId) {
    throw new Error('company_id_required');
  }

  const payload = {
    ...Object.fromEntries(calendarChecklistOrder.map((item) => [item.key, formData.get(item.key) === 'on'])),
    connectionMode: optionalText(formData.get('connectionMode')),
    googleAccountEmail: optionalText(formData.get('googleAccountEmail')),
    googleCalendarId: optionalText(formData.get('googleCalendarId')),
    sharedCalendarName: optionalText(formData.get('sharedCalendarName')),
    sharedCalendarShareEmail: optionalText(formData.get('sharedCalendarShareEmail')),
    externalPlatformName: optionalText(formData.get('externalPlatformName')),
    externalPlatformUrl: optionalText(formData.get('externalPlatformUrl')),
    externalCalendarId: optionalText(formData.get('externalCalendarId')),
    timezone: optionalText(formData.get('timezone')),
    defaultDurationMinutes: optionalText(formData.get('defaultDurationMinutes')),
    notes: optionalText(formData.get('notes')),
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
  revalidatePath(`/clients/${companyId}/operator`);
  revalidatePath(`/events?companyId=${companyId}`);
  revalidatePath(`/bookings?companyId=${companyId}`);

  redirect(`/clients/${companyId}/calendar?notice=updated`);
}
