"use server";

import { AppointmentStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import {
  composeMeetingFlowNotes,
  defaultMeetingFlowStage,
  isMeetingFlowStageKey,
  meetingFlowDefaultPurpose,
  meetingFlowNextStage,
  meetingFlowStageLabel,
  parseMeetingFlowStage,
  stageFromQueryValue,
  type MeetingFlowStageKey
} from '@/lib/meeting-flow';
import {
  INTERNAL_COMPANY_ID,
  ensureInternalCompany,
  getMeetingTeamDefaults,
  normalizeMeetingEmail,
  saveMeetingTeamDefaults
} from '@/lib/meeting-team-defaults';
import { normalizePhone } from '@/lib/phone';
import {
  enqueueAppointmentCalendarSyncRetry,
  notifyCalendarSyncFailure,
  syncAppointmentToExternalCalendar
} from '@/services/calendar-sync';
import { resolveAppointmentStartTime } from '@/services/booking';

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

function parseLocalDateTime(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
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

function redirectMeetingsManualBooking(values: Record<string, string | null | undefined>) {
  redirect(redirectPathWithValues('/meetings', values));
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

export async function createManualMeetingAppointmentAction(formData: FormData) {
  const companyName = String(formData.get('companyName') || '').trim();
  const contactName = String(formData.get('contactName') || '').trim();
  const contactPhoneRaw = String(formData.get('contactPhone') || '').trim();
  const contactEmail = String(formData.get('contactEmail') || '').trim();
  const meetingAtRaw = String(formData.get('meetingAt') || '').trim();
  const purposeRaw = String(formData.get('purpose') || '').trim();
  const meetingUrl = String(formData.get('meetingUrl') || '').trim();
  const hostEmailRaw = String(formData.get('hostEmail') || '').trim();
  const notes = String(formData.get('notes') || '').trim();
  const stageRaw = String(formData.get('meetingStage') || '').trim();
  const meetingStage: MeetingFlowStageKey = isMeetingFlowStageKey(stageRaw) ? stageRaw : defaultMeetingFlowStage();
  const purpose = purposeRaw || meetingFlowDefaultPurpose(meetingStage);
  const draftValues = {
    stage: meetingStage,
    manualBook: '1',
    manualBookingCompanyName: companyName,
    manualBookingContactName: contactName,
    manualBookingContactPhone: contactPhoneRaw,
    manualBookingContactEmail: contactEmail,
    manualBookingMeetingAt: meetingAtRaw,
    manualBookingPurpose: purpose,
    manualBookingMeetingUrl: meetingUrl,
    manualBookingHostEmail: hostEmailRaw,
    manualBookingNotes: notes
  };

  if (!companyName) {
    redirectMeetingsManualBooking({
      ...draftValues,
      meetingError: 'company_required'
    });
  }

  const normalizedPhone = normalizePhone(contactPhoneRaw);
  if (!normalizedPhone) {
    redirectMeetingsManualBooking({
      ...draftValues,
      meetingError: 'phone_required'
    });
  }

  if (!meetingAtRaw) {
    redirectMeetingsManualBooking({
      ...draftValues,
      meetingError: 'meetingAt_required'
    });
  }

  if (!purpose) {
    redirectMeetingsManualBooking({
      ...draftValues,
      meetingError: 'purpose_required'
    });
  }

  let normalizedMeetingUrl: string | null = null;
  if (meetingUrl) {
    let parsedMeetingUrl: URL | null = null;
    try {
      parsedMeetingUrl = new URL(meetingUrl);
    } catch {
      redirectMeetingsManualBooking({
        ...draftValues,
        meetingError: 'meetingUrl_invalid'
      });
    }

    if (!parsedMeetingUrl || !['http:', 'https:'].includes(parsedMeetingUrl.protocol)) {
      redirectMeetingsManualBooking({
        ...draftValues,
        meetingError: 'meetingUrl_invalid'
      });
    }

    normalizedMeetingUrl = parsedMeetingUrl ? parsedMeetingUrl.toString() : null;
  }

  let appointmentTime: Date;
  try {
    appointmentTime = resolveAppointmentStartTime(new Date(meetingAtRaw));
  } catch (error) {
    redirectMeetingsManualBooking({
      ...draftValues,
      meetingError: error instanceof Error ? error.message : 'meetingAt_invalid'
    });
  }

  await ensureInternalCompany();
  const meetingDefaults = await getMeetingTeamDefaults(INTERNAL_COMPANY_ID);
  const normalizedHostEmail = normalizeMeetingEmail(hostEmailRaw);

  if (hostEmailRaw && !normalizedHostEmail) {
    redirectMeetingsManualBooking({
      ...draftValues,
      meetingError: 'host_invalid'
    });
  }

  if (normalizedHostEmail && !meetingDefaults.defaultAttendeeEmails.includes(normalizedHostEmail)) {
    redirectMeetingsManualBooking({
      ...draftValues,
      meetingError: 'host_invalid'
    });
  }

  const stagedNotes = composeMeetingFlowNotes({
    stage: meetingStage,
    notes
  });

  let appointmentId = '';

  await db.$transaction(async (tx) => {
    const contact = await tx.contact.upsert({
      where: {
        companyId_phone: {
          companyId: INTERNAL_COMPANY_ID,
          phone: normalizedPhone
        }
      },
      update: {
        name: contactName || undefined,
        email: contactEmail || null
      },
      create: {
        companyId: INTERNAL_COMPANY_ID,
        name: contactName || null,
        phone: normalizedPhone,
        email: contactEmail || null
      }
    });

    await tx.conversation.upsert({
      where: {
        companyId_contactId: {
          companyId: INTERNAL_COMPANY_ID,
          contactId: contact.id
        }
      },
      update: {},
      create: {
        companyId: INTERNAL_COMPANY_ID,
        contactId: contact.id
      }
    });

    const existingAppointment = await tx.appointment.findFirst({
      where: {
        companyId: INTERNAL_COMPANY_ID,
        contactId: contact.id,
        startTime: appointmentTime
      },
      select: { id: true }
    });

    const payload = {
      companyId: INTERNAL_COMPANY_ID,
      contactId: contact.id,
      startTime: appointmentTime,
      status: AppointmentStatus.BOOKED,
      purpose,
      meetingUrl: normalizedMeetingUrl,
      hostEmail: normalizedHostEmail,
      attendeeEmails: meetingDefaults.defaultAttendeeEmails,
      displayCompanyName: companyName,
      notes: stagedNotes
    };

    if (existingAppointment) {
      await tx.appointment.update({
        where: { id: existingAppointment.id },
        data: payload
      });
      appointmentId = existingAppointment.id;
    } else {
      const createdAppointment = await tx.appointment.create({
        data: payload
      });
      appointmentId = createdAppointment.id;
    }

    await tx.eventLog.create({
      data: {
        companyId: INTERNAL_COMPANY_ID,
        eventType: 'meeting_manual_booked',
        payload: {
          appointmentId,
          stage: meetingStage,
          displayCompanyName: companyName,
          contactName: contactName || null,
          contactPhone: normalizedPhone,
          contactEmail: contactEmail || null,
          purpose,
          meetingUrl: normalizedMeetingUrl,
          hostEmail: normalizedHostEmail,
          attendeeEmails: meetingDefaults.defaultAttendeeEmails,
          startTime: appointmentTime.toISOString()
        }
      }
    });
  });

  if (appointmentId) {
    await syncAppointmentToExternalCalendar(appointmentId, 'manual_meeting_book');
  }

  revalidatePath('/meetings');
  revalidatePath('/events');
  redirectMeetingsManualBooking({
    stage: meetingStage,
    notice: 'meeting_manual_booked'
  });
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
  const nextStartTimeRaw = String(formData.get('nextStartTime') || '').trim();

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
  const selectedNextStartTime = parseLocalDateTime(nextStartTimeRaw);

  if (nextStage && nextStartTimeRaw && !selectedNextStartTime) {
    redirect(redirectPathWithValues(returnTo, { notice: 'meeting_stage_failed', detail: 'invalid_next_start_time' }));
  }

  if (nextStage && selectedNextStartTime && selectedNextStartTime.getTime() <= completionTimestamp.getTime()) {
    redirect(redirectPathWithValues(returnTo, { notice: 'meeting_stage_failed', detail: 'next_start_time_in_past' }));
  }

  let nextAppointmentId: string | null = null;

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

    const nextStartTime = selectedNextStartTime || addDays(appointment.startTime, nextStage.offsetDays);
    const nextPurpose = meetingFlowDefaultPurpose(nextStage.key);
    const nextNotes = composeMeetingFlowNotes({
      stage: nextStage.key,
      notes: appointment.notes,
      extraLines: [`Auto-scheduled after ${meetingFlowStageLabel(currentStage)} was completed.`]
    });

    const createdNext = await tx.appointment.create({
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
    nextAppointmentId = createdNext.id;
  });

  if (nextAppointmentId) {
    await syncAppointmentToExternalCalendar(nextAppointmentId, 'meeting_stage_advance');
  }

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
