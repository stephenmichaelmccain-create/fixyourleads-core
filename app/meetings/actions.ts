"use server";

import { AppointmentStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import {
  composeMeetingFlowNotes,
  meetingFlowDefaultPurpose,
  meetingFlowNextStage,
  meetingFlowStageLabel,
  parseMeetingFlowStage,
  stageFromQueryValue
} from '@/lib/meeting-flow';
import {
  getMeetingTeamDefaults,
  normalizeMeetingEmail,
  saveMeetingTeamDefaults
} from '@/lib/meeting-team-defaults';
import {
  enqueueAppointmentCalendarSyncRetry,
  notifyCalendarSyncFailure,
  syncAppointmentToExternalCalendar
} from '@/services/calendar-sync';

function sanitizeReturnTo(value: string | null | undefined, fallback: string) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }

  if (value.startsWith('/meetings') || value.startsWith('/clients/')) {
    return value;
  }

  return fallback;
}

function addDays(date: Date, days: number) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
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

export async function addMeetingDefaultAttendeeAction(formData: FormData) {
  const email = normalizeMeetingEmail(String(formData.get('email') || ''));

  if (!email) {
    redirect('/meetings?notice=meeting_default_attendee_invalid');
  }

  const existing = await getMeetingTeamDefaults();
  if (existing.defaultAttendeeEmails.includes(email)) {
    redirect('/meetings?notice=meeting_default_attendee_exists');
  }

  await saveMeetingTeamDefaults([...existing.defaultAttendeeEmails, email]);
  revalidatePath('/meetings');
  redirect('/meetings?notice=meeting_default_attendee_added');
}

export async function removeMeetingDefaultAttendeeAction(formData: FormData) {
  const email = normalizeMeetingEmail(String(formData.get('email') || ''));

  if (!email) {
    redirect('/meetings?notice=meeting_default_attendee_invalid');
  }

  const existing = await getMeetingTeamDefaults();
  await saveMeetingTeamDefaults(existing.defaultAttendeeEmails.filter((value) => value !== email));
  revalidatePath('/meetings');
  redirect('/meetings?notice=meeting_default_attendee_removed');
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

export async function completeMeetingAndScheduleNextAction(formData: FormData) {
  const appointmentId = String(formData.get('appointmentId') || '').trim();
  const stageQuery = stageFromQueryValue(String(formData.get('stage') || '').trim());
  const returnTo = sanitizeReturnTo(String(formData.get('returnTo') || '').trim(), `/meetings?stage=${stageQuery}`);

  if (!appointmentId) {
    redirect(redirectPathWithValues(returnTo, { notice: 'meeting_stage_failed', detail: 'appointment_required' }));
  }

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      companyId: true,
      contactId: true,
      startTime: true,
      purpose: true,
      notes: true,
      meetingUrl: true,
      hostEmail: true,
      attendeeEmails: true,
      displayCompanyName: true,
      sourceProspectId: true
    }
  });

  if (!appointment) {
    redirect(redirectPathWithValues(returnTo, { notice: 'meeting_stage_failed', detail: 'appointment_not_found' }));
  }

  const currentStage = parseMeetingFlowStage({
    notes: appointment.notes,
    purpose: appointment.purpose
  });
  const nextStage = meetingFlowNextStage(currentStage);
  const completionTimestamp = new Date();

  await db.$transaction(async (tx) => {
    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        status: AppointmentStatus.COMPLETED,
        completedAt: completionTimestamp,
        notes: composeMeetingFlowNotes({
          stage: currentStage,
          notes: appointment.notes
        })
      }
    });

    if (!nextStage) {
      return;
    }

    const nextStartTime = addDays(appointment.startTime, nextStage.offsetDays);
    const nextPurpose = meetingFlowDefaultPurpose(nextStage.key);
    const nextNotes = composeMeetingFlowNotes({
      stage: nextStage.key,
      notes: appointment.notes,
      extraLines: [`Auto-scheduled after ${meetingFlowStageLabel(currentStage)} was completed.`]
    });

    await tx.appointment.create({
      data: {
        companyId: appointment.companyId,
        contactId: appointment.contactId,
        startTime: nextStartTime,
        status: AppointmentStatus.BOOKED,
        purpose: nextPurpose,
        meetingUrl: appointment.meetingUrl,
        hostEmail: appointment.hostEmail,
        attendeeEmails: appointment.attendeeEmails,
        displayCompanyName: appointment.displayCompanyName,
        sourceProspectId: appointment.sourceProspectId,
        notes: nextNotes
      }
    });
  });

  revalidatePath('/meetings');
  revalidatePath('/our-leads');
  revalidatePath('/events');
  revalidatePath(`/clients/${appointment.companyId}`);

  if (!nextStage) {
    redirect(redirectPathWithValues(returnTo, { notice: 'meeting_stage_complete' }));
  }

  redirect(
    redirectPathWithValues('/meetings', {
      stage: nextStage.key,
      notice: 'meeting_stage_advanced'
    })
  );
}
