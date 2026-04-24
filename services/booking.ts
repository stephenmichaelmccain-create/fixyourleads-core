import { AppointmentStatus, LeadStatus, MessageDirection, WorkflowType, type Appointment } from '@prisma/client';
import { db } from '@/lib/db';
import { companyPrimaryInboundNumber } from '@/lib/inbound-numbers';
import { sendBookingNotification } from '@/lib/notifications';
import { sendSms } from '@/lib/telnyx';
import { activateWorkflowRun, completeWorkflowRuns, touchWorkflowActivity } from '@/lib/workflows';

type CreateAppointmentInput = {
  companyId: string;
  contactId: string;
  startTime?: Date;
};

type BookingStatus = 'created' | 'existing';
type ConfirmationStatus = 'sent' | 'failed' | 'skipped';
type BookingRequestStatus = 'sent' | 'failed' | 'skipped';

type CreateAppointmentResult = {
  appointment: Appointment;
  bookingStatus: BookingStatus;
  notification: Awaited<ReturnType<typeof sendBookingNotification>>;
  confirmationStatus: ConfirmationStatus;
  confirmationDetail: string;
  confirmationMessageId: string | null;
};

type RequestBookingDetailsInput = {
  companyId: string;
  contactId: string;
  inboundText?: string | null;
};

type RequestBookingDetailsResult = {
  status: BookingRequestStatus;
  detail: string;
  messageId: string | null;
};

function defaultAppointmentStartTime() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

function bookingDetailsRequestText(companyName: string) {
  return `Thanks for reaching back out to ${companyName}. What day and time works best for your appointment? Reply with something like "Tuesday at 2pm" and we will confirm it.`;
}

export function resolveAppointmentStartTime(startTime?: Date) {
  const appointmentTime = startTime || defaultAppointmentStartTime();

  if (Number.isNaN(appointmentTime.getTime())) {
    throw new Error('invalid_startTime');
  }

  if (appointmentTime.getTime() < Date.now() - 60_000) {
    throw new Error('startTime_in_past');
  }

  return appointmentTime;
}

export async function requestBookingDetailsFlow({
  companyId,
  contactId,
  inboundText
}: RequestBookingDetailsInput): Promise<RequestBookingDetailsResult> {
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      telnyxInboundNumber: true,
      telnyxInboundNumbers: {
        select: { number: true }
      }
    }
  });
  const contact = await db.contact.findFirst({
    where: {
      id: contactId,
      companyId
    }
  });

  if (!contact) {
    throw new Error('contact_not_found_for_company');
  }

  const conversation = await db.conversation.findUniqueOrThrow({
    where: { companyId_contactId: { companyId, contactId } }
  });

  const existingAppointment = await db.appointment.findFirst({
    where: {
      companyId,
      contactId,
      status: {
        in: [AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED, AppointmentStatus.RESCHEDULED]
      },
      startTime: {
        gte: new Date()
      }
    },
    orderBy: { startTime: 'asc' }
  });

  if (existingAppointment) {
    await db.eventLog.create({
      data: {
        companyId,
        eventType: 'booking_details_request_skipped',
        payload: {
          contactId,
          conversationId: conversation.id,
          reason: 'appointment_already_exists',
          appointmentId: existingAppointment.id,
          inboundText: inboundText || null
        }
      }
    });

    await activateWorkflowRun({
      companyId,
      contactId,
      conversationId: conversation.id,
      workflowType: WorkflowType.BOOKING,
      reason: 'appointment_already_exists'
    });

    return {
      status: 'skipped',
      detail: 'appointment_already_exists',
      messageId: null
    };
  }

  const recentPrompt = await db.message.findFirst({
    where: {
      companyId,
      conversationId: conversation.id,
      direction: MessageDirection.OUTBOUND,
      content: {
        contains: 'Reply with something like "Tuesday at 2pm"'
      },
      createdAt: {
        gte: new Date(Date.now() - 15 * 60 * 1000)
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  if (recentPrompt) {
    await db.eventLog.create({
      data: {
        companyId,
        eventType: 'booking_details_request_skipped',
        payload: {
          contactId,
          conversationId: conversation.id,
          reason: 'recent_prompt_already_sent',
          recentPromptMessageId: recentPrompt.id,
          inboundText: inboundText || null
        }
      }
    });

    await activateWorkflowRun({
      companyId,
      contactId,
      conversationId: conversation.id,
      workflowType: WorkflowType.BOOKING,
      reason: 'booking_details_already_requested'
    });

    return {
      status: 'skipped',
      detail: 'recent_prompt_already_sent',
      messageId: recentPrompt.externalId || recentPrompt.id
    };
  }

  const text = bookingDetailsRequestText(company.name);
  const fromNumber = companyPrimaryInboundNumber(company);

  try {
    const telnyxResult = await sendSms(contact.phone, text, fromNumber);
    const externalId = telnyxResult?.data?.id || null;
    const message = await db.message.create({
      data: {
        companyId,
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        content: text,
        externalId
      }
    });

    await db.eventLog.create({
      data: {
        companyId,
        eventType: 'booking_details_requested',
        payload: {
          contactId,
          conversationId: conversation.id,
          inboundText: inboundText || null,
          messageId: message.id,
          from: fromNumber,
          to: contact.phone
        }
      }
    });

    await activateWorkflowRun({
      companyId,
      contactId,
      conversationId: conversation.id,
      workflowType: WorkflowType.BOOKING,
      reason: 'booking_details_requested'
    });
    await completeWorkflowRuns({
      companyId,
      contactId,
      workflowTypes: [WorkflowType.NEW_LEAD_FOLLOW_UP],
      reason: 'booking_details_requested'
    });
    await touchWorkflowActivity({
      companyId,
      contactId,
      direction: 'outbound',
      when: message.createdAt
    });

    return {
      status: 'sent',
      detail: 'booking_details_requested',
      messageId: externalId
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'booking_details_request_failed';

    await db.eventLog.create({
      data: {
        companyId,
        eventType: 'booking_details_request_failed',
        payload: {
          contactId,
          conversationId: conversation.id,
          inboundText: inboundText || null,
          detail
        }
      }
    });

    await activateWorkflowRun({
      companyId,
      contactId,
      conversationId: conversation.id,
      workflowType: WorkflowType.BOOKING,
      reason: 'booking_details_request_failed'
    });

    return {
      status: 'failed',
      detail,
      messageId: null
    };
  }
}

export async function createAppointmentFlow({ companyId, contactId, startTime }: CreateAppointmentInput): Promise<CreateAppointmentResult> {
  const appointmentTime = resolveAppointmentStartTime(startTime);

  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      notificationEmail: true,
      telnyxInboundNumber: true,
      telnyxInboundNumbers: {
        select: { number: true }
      }
    }
  });
  const contact = await db.contact.findFirst({
    where: {
      id: contactId,
      companyId
    }
  });

  if (!contact) {
    throw new Error('contact_not_found_for_company');
  }
  const conversation = await db.conversation.findUniqueOrThrow({
    where: { companyId_contactId: { companyId, contactId } }
  });

  const existingAppointment = await db.appointment.findFirst({
    where: {
      companyId,
      contactId,
      startTime: appointmentTime
    }
  });

  if (existingAppointment) {
    await db.lead.updateMany({
      where: { companyId, contactId },
      data: {
        status: LeadStatus.BOOKED,
        suppressedAt: null,
        suppressionReason: null
      }
    });

    await db.eventLog.create({
      data: {
        companyId,
        eventType: 'appointment_booking_duplicate',
        payload: {
          appointmentId: existingAppointment.id,
          contactId,
          startTime: existingAppointment.startTime.toISOString()
        }
      }
    });

    await activateWorkflowRun({
      companyId,
      contactId,
      conversationId: conversation.id,
      workflowType: WorkflowType.BOOKING,
      reason: 'appointment_already_exists'
    });
    await completeWorkflowRuns({
      companyId,
      contactId,
      workflowTypes: [WorkflowType.NEW_LEAD_FOLLOW_UP, WorkflowType.ACTIVE_CONVERSATION],
      reason: 'appointment_already_exists'
    });

    return {
      appointment: existingAppointment,
      bookingStatus: 'existing',
      notification: {
        status: 'skipped',
        detail: 'appointment_already_exists'
      },
      confirmationStatus: 'skipped',
      confirmationDetail: 'appointment_already_exists',
      confirmationMessageId: null
    };
  }

  const appointment = await db.appointment.create({
    data: {
      companyId,
      contactId,
      startTime: appointmentTime,
      status: AppointmentStatus.BOOKED
    }
  });

  await db.lead.updateMany({
    where: { companyId, contactId },
    data: {
      status: LeadStatus.BOOKED,
      suppressedAt: null,
      suppressionReason: null
    }
  });

  const confirmationText = `You are booked for ${appointmentTime.toLocaleString()}. We will follow up with details shortly.`;
  let confirmationStatus: ConfirmationStatus = 'sent';
  let confirmationDetail = 'booking_confirmation_sent';
  let confirmationMessageId: string | null = null;

  try {
    const fromNumber = companyPrimaryInboundNumber(company);
    const telnyxResult = await sendSms(contact.phone, confirmationText, fromNumber);
    confirmationMessageId = telnyxResult?.data?.id || null;

    await db.message.create({
      data: {
        companyId,
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        content: confirmationText,
        externalId: confirmationMessageId
      }
    });
  } catch (error) {
    confirmationStatus = 'failed';
    confirmationDetail = error instanceof Error ? error.message : 'booking_confirmation_failed';
  }

  const notification = await sendBookingNotification({
    companyName: company.name,
    contactName: contact.name,
    contactPhone: contact.phone,
    appointmentTime,
    to: company.notificationEmail || process.env.DEFAULT_CLIENT_NOTIFICATION_EMAIL || null
  });

  await db.eventLog.create({
    data: {
      companyId,
      eventType: 'appointment_booked',
      payload: {
        appointmentId: appointment.id,
        contactId,
        bookingStatus: 'created',
        startTime: appointment.startTime.toISOString(),
        confirmationStatus,
        confirmationDetail,
        confirmationMessageId,
        notificationStatus: notification.status,
        notificationDetail: notification.detail
      }
    }
  });

  await activateWorkflowRun({
    companyId,
    contactId,
    conversationId: conversation.id,
    workflowType: WorkflowType.BOOKING,
    reason: 'appointment_booked',
    payload: {
      appointmentId: appointment.id
    }
  });
  await completeWorkflowRuns({
    companyId,
    contactId,
    workflowTypes: [WorkflowType.NEW_LEAD_FOLLOW_UP, WorkflowType.ACTIVE_CONVERSATION],
    reason: 'appointment_booked'
  });

  return {
    appointment,
    bookingStatus: 'created',
    notification,
    confirmationStatus,
    confirmationDetail,
    confirmationMessageId
  };
}
