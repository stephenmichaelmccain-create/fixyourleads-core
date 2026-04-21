import { LeadStatus, MessageDirection } from '@prisma/client';
import { db } from '@/lib/db';
import { sendBookingNotification } from '@/lib/notifications';
import { sendSms } from '@/lib/telnyx';

type CreateAppointmentInput = {
  companyId: string;
  contactId: string;
  startTime?: Date;
};

function defaultAppointmentStartTime() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}

export async function createAppointmentFlow({ companyId, contactId, startTime }: CreateAppointmentInput) {
  const appointmentTime = startTime || defaultAppointmentStartTime();

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

  const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  const contact = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
  const conversation = await db.conversation.findUniqueOrThrow({
    where: { companyId_contactId: { companyId, contactId } }
  });

  const confirmationText = `You are booked for ${appointmentTime.toLocaleString()}. We will follow up with details shortly.`;
  const telnyxResult = await sendSms(contact.phone, confirmationText);

  await db.message.create({
    data: {
      companyId,
      conversationId: conversation.id,
      direction: MessageDirection.OUTBOUND,
      content: confirmationText,
      externalId: telnyxResult?.data?.id || null
    }
  });

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
        notificationStatus: notification.status,
        notificationDetail: notification.detail
      }
    }
  });

  return { appointment, notification };
}
