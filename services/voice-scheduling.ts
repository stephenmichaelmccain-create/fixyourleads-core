import { AppointmentExternalSyncStatus, AppointmentStatus, type Company } from '@prisma/client';
import { db } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';

type VoiceCompanyLocatorInput = {
  companyId?: string;
  telnyxAssistantId?: string;
  calledNumber?: string;
};

type CheckVoiceAvailabilityInput = VoiceCompanyLocatorInput & {
  startTime: string | Date;
  durationMinutes?: number;
};

type CheckVoiceAvailabilityResult = {
  success: true;
  companyId: string;
  requestedStartTime: string;
  durationMinutes: number;
  available: boolean;
  conflictingAppointmentId: string | null;
  suggestedSlots: string[];
};

type CancelVoiceAppointmentInput = VoiceCompanyLocatorInput & {
  appointmentId?: string;
  phone?: string;
  startTime?: string | Date;
  reason?: string;
  cancelledBy?: string;
  rawPayload?: unknown;
};

type CancelVoiceAppointmentResult = {
  success: true;
  companyId: string;
  appointmentId: string;
  appointmentTime: string;
  status: 'canceled' | 'already_canceled';
};

function clean(value?: string | null) {
  const trimmed = String(value || '').trim();
  return trimmed || undefined;
}

function activeAppointmentStatuses() {
  return [AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED, AppointmentStatus.RESCHEDULED] as const;
}

function parseRequestedDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error('invalid_startTime');
  }

  return date;
}

function normalizeDurationMinutes(value?: number) {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return 60;
  }

  return Math.max(15, Math.min(180, Math.round(value / 15) * 15));
}

async function findConflictingAppointment(input: {
  companyId: string;
  startTime: Date;
  durationMinutes: number;
}) {
  const endTime = new Date(input.startTime.getTime() + input.durationMinutes * 60_000);

  return db.appointment.findFirst({
    where: {
      companyId: input.companyId,
      status: {
        in: [...activeAppointmentStatuses()]
      },
      startTime: {
        gte: input.startTime,
        lt: endTime
      }
    },
    orderBy: { startTime: 'asc' },
    select: {
      id: true,
      startTime: true
    }
  });
}

async function suggestNextOpenSlots(input: {
  companyId: string;
  startTime: Date;
  durationMinutes: number;
}) {
  const suggestions: string[] = [];
  let cursor = new Date(input.startTime.getTime() + input.durationMinutes * 60_000);
  let attempts = 0;

  while (suggestions.length < 3 && attempts < 24) {
    const conflict = await findConflictingAppointment({
      companyId: input.companyId,
      startTime: cursor,
      durationMinutes: input.durationMinutes
    });

    if (!conflict) {
      suggestions.push(cursor.toISOString());
    }

    cursor = new Date(cursor.getTime() + input.durationMinutes * 60_000);
    attempts += 1;
  }

  return suggestions;
}

export async function resolveVoiceSchedulingCompany(
  input: VoiceCompanyLocatorInput
): Promise<Pick<Company, 'id' | 'name' | 'telnyxAssistantId' | 'telnyxInboundNumber'> | null> {
  const directCompanyId = clean(input.companyId);

  if (directCompanyId) {
    const company = await db.company.findUnique({
      where: { id: directCompanyId },
      select: {
        id: true,
        name: true,
        telnyxAssistantId: true,
        telnyxInboundNumber: true
      }
    });

    if (company) {
      return company;
    }
  }

  const assistantId = clean(input.telnyxAssistantId);

  if (assistantId) {
    const company = await db.company.findUnique({
      where: { telnyxAssistantId: assistantId },
      select: {
        id: true,
        name: true,
        telnyxAssistantId: true,
        telnyxInboundNumber: true
      }
    });

    if (company) {
      return company;
    }
  }

  const calledNumber = normalizePhone(input.calledNumber || '');

  if (calledNumber) {
    const company = await db.company.findFirst({
      where: {
        OR: [
          { telnyxInboundNumber: calledNumber },
          {
            telnyxInboundNumbers: {
              some: {
                number: calledNumber
              }
            }
          }
        ]
      },
      select: {
        id: true,
        name: true,
        telnyxAssistantId: true,
        telnyxInboundNumber: true
      }
    });

    if (company) {
      return company;
    }
  }

  return null;
}

export async function checkVoiceAppointmentAvailability(
  input: CheckVoiceAvailabilityInput
): Promise<CheckVoiceAvailabilityResult> {
  const company = await resolveVoiceSchedulingCompany(input);

  if (!company) {
    throw new Error('company_not_resolved');
  }

  const requestedStartTime = parseRequestedDate(input.startTime);
  const durationMinutes = normalizeDurationMinutes(input.durationMinutes);
  const conflict = await findConflictingAppointment({
    companyId: company.id,
    startTime: requestedStartTime,
    durationMinutes
  });
  const suggestedSlots = conflict
    ? await suggestNextOpenSlots({
        companyId: company.id,
        startTime: requestedStartTime,
        durationMinutes
      })
    : [];

  await db.eventLog.create({
    data: {
      companyId: company.id,
      eventType: 'voice_appointment_availability_checked',
      payload: {
        requestedStartTime: requestedStartTime.toISOString(),
        durationMinutes,
        available: !conflict,
        conflictingAppointmentId: conflict?.id || null,
        suggestedSlots
      }
    }
  });

  return {
    success: true,
    companyId: company.id,
    requestedStartTime: requestedStartTime.toISOString(),
    durationMinutes,
    available: !conflict,
    conflictingAppointmentId: conflict?.id || null,
    suggestedSlots
  };
}

export async function cancelVoiceAppointment(
  input: CancelVoiceAppointmentInput
): Promise<CancelVoiceAppointmentResult> {
  const company = await resolveVoiceSchedulingCompany(input);

  if (!company) {
    throw new Error('company_not_resolved');
  }

  const appointmentId = clean(input.appointmentId);
  const normalizedPhone = normalizePhone(input.phone || '');
  const requestedStartTime = input.startTime ? parseRequestedDate(input.startTime) : null;

  let appointment = null;

  if (appointmentId) {
    appointment = await db.appointment.findFirst({
      where: {
        id: appointmentId,
        companyId: company.id
      },
      select: {
        id: true,
        startTime: true,
        status: true,
        contactId: true
      }
    });
  }

  if (!appointment && normalizedPhone) {
    appointment = await db.appointment.findFirst({
      where: {
        companyId: company.id,
        contact: {
          phone: normalizedPhone
        },
        ...(requestedStartTime
          ? {
              startTime: requestedStartTime
            }
          : {
              status: {
                in: [...activeAppointmentStatuses()]
              },
              startTime: {
                gte: new Date()
              }
            })
      },
      orderBy: { startTime: 'asc' },
      select: {
        id: true,
        startTime: true,
        status: true,
        contactId: true
      }
    });
  }

  if (!appointment) {
    throw new Error('appointment_not_found');
  }

  const alreadyCanceled = appointment.status === AppointmentStatus.CANCELED;

  if (!alreadyCanceled) {
    await db.appointment.update({
      where: { id: appointment.id },
      data: {
        status: AppointmentStatus.CANCELED,
        canceledAt: new Date(),
        externalSyncStatus: AppointmentExternalSyncStatus.PENDING,
        externalSyncError: null,
        notes: clean(input.reason) ? `${clean(input.reason)}\n\nCanceled via voice assistant.` : undefined
      }
    });
  }

  await db.eventLog.create({
    data: {
      companyId: company.id,
      eventType: 'voice_appointment_canceled',
      payload: {
        appointmentId: appointment.id,
        contactId: appointment.contactId,
        appointmentTime: appointment.startTime.toISOString(),
        status: alreadyCanceled ? 'already_canceled' : 'canceled',
        cancelledBy: clean(input.cancelledBy) || 'voice_assistant',
        reason: clean(input.reason) || null,
        rawPayload: input.rawPayload ?? null
      }
    }
  });

  return {
    success: true,
    companyId: company.id,
    appointmentId: appointment.id,
    appointmentTime: appointment.startTime.toISOString(),
    status: alreadyCanceled ? 'already_canceled' : 'canceled'
  };
}
