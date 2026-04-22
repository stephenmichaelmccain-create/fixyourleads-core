import { LeadStatus, MessageDirection, type Appointment } from '@prisma/client';
import { db } from '@/lib/db';
import { companyPrimaryInboundNumber } from '@/lib/inbound-numbers';
import { sendBookingNotification } from '@/lib/notifications';
import { sendSms } from '@/lib/telnyx';

type CreateAppointmentInput = {
  companyId: string;
  contactId: string;
  startTime?: Date;
};

type BookingStatus = 'created' | 'existing';
type ConfirmationStatus = 'sent' | 'failed' | 'skipped';

type CreateAppointmentResult = {
  appointment: Appointment;
  bookingStatus: BookingStatus;
  notification: Awaited<ReturnType<typeof sendBookingNotification>>;
  confirmationStatus: ConfirmationStatus;
  confirmationDetail: string;
  confirmationMessageId: string | null;
};

function defaultAppointmentStartTime() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
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
      startTime: appointmentTime
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

  return {
    appointment,
    bookingStatus: 'created',
    notification,
    confirmationStatus,
    confirmationDetail,
    confirmationMessageId
  };
}
