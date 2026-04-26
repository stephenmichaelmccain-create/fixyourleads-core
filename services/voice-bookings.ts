import { db } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';
import { createAppointmentFlow, resolveAppointmentStartTime } from '@/services/booking';
import { createLeadFlow } from '@/services/leads';

export type VoiceAppointmentBookingInput = {
  phone: string;
  startTime: string | Date;
  fullName?: string;
  email?: string;
  purpose?: string;
  meetingUrl?: string;
  displayCompanyName?: string;
  sourceProspectId?: string;
  notes?: string;
  companyId?: string;
  telnyxAssistantId?: string;
  calledNumber?: string;
  callId?: string;
  recordingUrl?: string;
  transcriptUrl?: string;
  transcriptText?: string;
  rawPayload?: unknown;
};

export type VoiceAppointmentBookingResult = {
  success: true;
  companyId: string;
  leadId: string;
  contactId: string;
  conversationId: string;
  appointmentId: string;
  duplicateLead: boolean;
  bookingStatus: 'created' | 'existing';
  appointmentTime: string;
};

function clean(value?: string | null) {
  const trimmed = String(value || '').trim();
  return trimmed || undefined;
}

async function resolveVoiceBookingCompany(
  input: Pick<VoiceAppointmentBookingInput, 'companyId' | 'telnyxAssistantId' | 'calledNumber'>
) {
  const directCompanyId = clean(input.companyId);

  if (directCompanyId) {
    const company = await db.company.findUnique({ where: { id: directCompanyId } });

    if (company) {
      return company;
    }
  }

  const assistantId = clean(input.telnyxAssistantId);

  if (assistantId) {
    const company = await db.company.findUnique({ where: { telnyxAssistantId: assistantId } });

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
      }
    });

    if (company) {
      return company;
    }
  }

  return null;
}

export async function bookVoiceAppointment(input: VoiceAppointmentBookingInput): Promise<VoiceAppointmentBookingResult> {
  const company = await resolveVoiceBookingCompany(input);

  if (!company) {
    throw new Error('company_not_resolved');
  }

  const callId = clean(input.callId);
  const leadResult = await createLeadFlow({
    companyId: company.id,
    phone: input.phone,
    name: clean(input.fullName),
    source: 'voice_agent',
    sourceExternalId: callId ? `voice-call:${callId}` : undefined
  });

  if (clean(input.fullName) || clean(input.email)) {
    await db.contact.update({
      where: { id: leadResult.contact.id },
      data: {
        name: clean(input.fullName) || undefined,
        email: clean(input.email) || undefined
      }
    });
  }

  const appointmentResult = await createAppointmentFlow({
    companyId: company.id,
    contactId: leadResult.contact.id,
    startTime: resolveAppointmentStartTime(new Date(input.startTime)),
    purpose: clean(input.purpose),
    meetingUrl: clean(input.meetingUrl),
    displayCompanyName: clean(input.displayCompanyName) || company.name,
    sourceProspectId: clean(input.sourceProspectId),
    notes: clean(input.notes),
    callExternalId: callId,
    callRecordingUrl: clean(input.recordingUrl),
    callTranscriptUrl: clean(input.transcriptUrl),
    callTranscriptText: clean(input.transcriptText)
  });

  await db.eventLog.create({
    data: {
      companyId: company.id,
      eventType: 'voice_appointment_booked',
      payload: {
        leadId: leadResult.lead.id,
        contactId: leadResult.contact.id,
        conversationId: leadResult.conversation.id,
        appointmentId: appointmentResult.appointment.id,
        bookingStatus: appointmentResult.bookingStatus,
        duplicateLead: leadResult.duplicate,
        callId: callId || null,
        recordingUrl: clean(input.recordingUrl) || null,
        transcriptUrl: clean(input.transcriptUrl) || null,
        hasTranscriptText: Boolean(clean(input.transcriptText)),
        rawPayload: input.rawPayload ?? null
      }
    }
  });

  return {
    success: true,
    companyId: company.id,
    leadId: leadResult.lead.id,
    contactId: leadResult.contact.id,
    conversationId: leadResult.conversation.id,
    appointmentId: appointmentResult.appointment.id,
    duplicateLead: leadResult.duplicate,
    bookingStatus: appointmentResult.bookingStatus,
    appointmentTime: appointmentResult.appointment.startTime.toISOString()
  };
}
