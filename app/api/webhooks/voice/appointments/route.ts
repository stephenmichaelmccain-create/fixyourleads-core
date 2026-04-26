import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { authenticateVoiceWebhookRequest } from '@/lib/voice-webhook-auth';
import { bookVoiceAppointment } from '@/services/voice-bookings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const voiceAppointmentSchema = z.object({
  phone: z.string().trim().min(7),
  startTime: z.union([z.string().trim().min(1), z.date()]),
  fullName: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  purpose: z.string().trim().min(1).optional(),
  meetingUrl: z.string().trim().min(1).optional(),
  displayCompanyName: z.string().trim().min(1).optional(),
  sourceProspectId: z.string().trim().min(1).optional(),
  notes: z.string().trim().min(1).optional(),
  companyId: z.string().trim().min(1).optional(),
  telnyxAssistantId: z.string().trim().min(1).optional(),
  calledNumber: z.string().trim().min(7).optional(),
  callId: z.string().trim().min(1).optional(),
  recordingUrl: z.string().trim().min(1).optional(),
  transcriptUrl: z.string().trim().min(1).optional(),
  transcriptText: z.string().trim().min(1).optional()
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Webhook-Secret, X-Voice-Webhook-Secret'
};

function cleanedString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function pickString(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = cleanedString(payload[key]);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function pickDateLike(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const raw = payload[key];

    if (raw instanceof Date) {
      return raw;
    }

    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return new Date(raw > 10_000_000_000 ? raw : raw * 1000);
    }

    const value = cleanedString(raw);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function normalizePayload(body: unknown) {
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

  return {
    phone: pickString(payload, ['phone', 'phone_number', 'caller_phone', 'contact_phone']),
    startTime: pickDateLike(payload, ['start_time', 'startTime', 'appointment_time', 'appointmentTime', 'scheduled_for', 'booking_time']),
    fullName: pickString(payload, ['full_name', 'fullName', 'name', 'caller_name', 'contact_name']),
    email: pickString(payload, ['email', 'email_address', 'caller_email', 'contact_email']),
    purpose: pickString(payload, ['purpose', 'service', 'appointment_type', 'appointmentType']),
    meetingUrl: pickString(payload, ['meeting_url', 'meetingUrl', 'google_meet_url', 'googleMeetUrl']),
    displayCompanyName: pickString(payload, ['display_company_name', 'displayCompanyName', 'business_name', 'businessName', 'company_name', 'companyName']),
    sourceProspectId: pickString(payload, ['source_prospect_id', 'sourceProspectId', 'prospect_id', 'prospectId']),
    notes: pickString(payload, ['notes', 'summary', 'booking_notes']),
    companyId: pickString(payload, ['company_id', 'companyId', 'client_id', 'clientId']),
    telnyxAssistantId: pickString(payload, ['telnyx_assistant_id', 'telnyxAssistantId', 'assistant_id', 'assistantId']),
    calledNumber: pickString(payload, ['called_number', 'calledNumber', 'to', 'to_number']),
    callId: pickString(payload, ['call_id', 'callId', 'telnyx_call_control_id', 'call_control_id']),
    recordingUrl: pickString(payload, ['recording_url', 'recordingUrl']),
    transcriptUrl: pickString(payload, ['transcript_url', 'transcriptUrl']),
    transcriptText: pickString(payload, ['transcript_text', 'transcriptText', 'transcript', 'call_transcript'])
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const authResult = authenticateVoiceWebhookRequest(rawBody, request.headers);

  if (!authResult.ok) {
    return NextResponse.json(
      { success: false, error: authResult.error, reason: authResult.reason },
      { status: 401, headers: corsHeaders }
    );
  }

  let body: unknown;

  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400, headers: corsHeaders });
  }

  const normalizedPayload = normalizePayload(body);
  const parsed = voiceAppointmentSchema.safeParse(normalizedPayload);

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'invalid_payload',
        issues: parsed.error.flatten().fieldErrors
      },
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    const result = await bookVoiceAppointment({
      ...parsed.data,
      rawPayload: body
    });

    return NextResponse.json(result, { headers: corsHeaders, status: result.bookingStatus === 'created' ? 201 : 200 });
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid_phone') {
      return NextResponse.json({ success: false, error: 'invalid_phone' }, { status: 400, headers: corsHeaders });
    }

    if (error instanceof Error && error.message === 'company_not_resolved') {
      return NextResponse.json({ success: false, error: 'company_not_resolved' }, { status: 404, headers: corsHeaders });
    }

    if (error instanceof Error && (error.message === 'invalid_startTime' || error.message === 'startTime_in_past')) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400, headers: corsHeaders });
    }

    console.error('[voice-booking] appointment webhook failed', error);

    return NextResponse.json(
      {
        success: false,
        error: 'voice_appointment_booking_failed'
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
