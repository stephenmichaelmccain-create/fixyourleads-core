"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import {
  enqueueAppointmentCalendarSyncRetry,
  notifyCalendarSyncFailure,
  syncAppointmentToExternalCalendar
} from '@/services/calendar-sync';

function sanitizeReturnTo(value: string | null | undefined, fallback: string) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }

  if (value === '/meetings' || value.startsWith('/clients/')) {
    return value;
  }

  return fallback;
}

function redirectPathWithValues(path: string, values: Record<string, string | null | undefined>) {
  const url = new URL(path, 'http://localhost');

  Object.entries(values).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    }
  });

  const search = url.searchParams.toString();
  return search ? `${url.pathname}?${search}` : url.pathname;
}

export async function retryMeetingCalendarSyncAction(formData: FormData) {
  const appointmentId = String(formData.get('appointmentId') || '').trim();
  const returnTo = sanitizeReturnTo(String(formData.get('returnTo') || '').trim(), '/meetings');

  if (!appointmentId) {
    redirect(redirectPathWithValues(returnTo, { notice: 'calendar_sync_retry_failed', detail: 'appointment_required' }));
  }

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      companyId: true,
      startTime: true,
      company: {
        select: {
          name: true,
          notificationEmail: true
        }
      },
      contact: {
        select: {
          name: true,
          phone: true
        }
      }
    }
  });

  if (!appointment) {
    redirect(redirectPathWithValues(returnTo, { notice: 'calendar_sync_retry_failed', detail: 'appointment_not_found' }));
  }

  const result = await syncAppointmentToExternalCalendar(appointment.id, 'manual_retry');

  if (result.success) {
    revalidatePath('/meetings');
    revalidatePath(`/clients/${appointment.companyId}`);
    revalidatePath(`/events?companyId=${appointment.companyId}`);
    redirect(redirectPathWithValues(returnTo, { notice: 'calendar_sync_synced' }));
  }

  const retryQueued = result.retryable
    ? await enqueueAppointmentCalendarSyncRetry(appointment.id, 'manual_retry')
    : { queued: false };

  if (!retryQueued.queued) {
    await notifyCalendarSyncFailure({
      appointmentId: appointment.id,
      companyId: appointment.companyId,
      companyName: appointment.company.name,
      notificationEmail: appointment.company.notificationEmail,
      contactName: appointment.contact.name,
      contactPhone: appointment.contact.phone,
      appointmentTime: appointment.startTime,
      provider: result.provider,
      error: result.error || 'calendar_sync_failed'
    });
  }

  revalidatePath('/meetings');
  revalidatePath(`/clients/${appointment.companyId}`);
  revalidatePath(`/events?companyId=${appointment.companyId}`);

  redirect(
    redirectPathWithValues(returnTo, {
      notice: retryQueued.queued ? 'calendar_sync_retry_queued' : 'calendar_sync_retry_failed',
      detail: result.error || 'calendar_sync_failed'
    })
  );
}
