import { LeadStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { sendSms } from '@/lib/telnyx';

export async function createMockAppointment(companyId: string, contactId: string) {
  const appointment = await db.appointment.create({
    data: {
      companyId,
      contactId,
      startTime: new Date(Date.now() + 24 * 60 * 60 * 1000)
    }
  });

  await db.lead.updateMany({
    where: { companyId, contactId },
    data: { status: LeadStatus.BOOKED }
  });

  const contact = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
  const conversation = await db.conversation.findUniqueOrThrow({
    where: { companyId_contactId: { companyId, contactId } }
  });

  const telnyxResult = await sendSms(contact.phone, 'You are booked. We will follow up with details shortly.');

  await db.message.create({
    data: {
      companyId,
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      content: 'You are booked. We will follow up with details shortly.',
      externalId: telnyxResult?.data?.id || null
    }
  });

  await db.eventLog.create({
    data: {
      companyId,
      eventType: 'appointment_booked',
      payload: { appointmentId: appointment.id, contactId }
    }
  });

  return appointment;
}
