import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { authenticateVoiceWebhookRequest } from '@/lib/voice-webhook-auth';
import { cancelVoiceAppointment } from '@/services/voice-scheduling';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const cancelSchema = z.object({
  appointmentId: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(7).optional(),
  startTime: z.union([z.string().trim().min(1), z.date()]).optional(),
  reason: z.string().trim().min(1).optional(),
  cancelledBy: z.string().trim().min(1).optional(),
  companyId: z.string().trim().min(1).optional(),
  telnyxAssistantId: z.string().trim().min(1).optional(),
  calledNumber: z.string().trim().min(7).optional()
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
    appointmentId: pickString(payload, ['appointment_id', 'appointmentId']),
    phone: pickString(payload, ['phone', 'phone_number', 'caller_phone', 'contact_phone']),
    startTime: pickDateLike(payload, ['start_time', 'startTime', 'appointment_time', 'appointmentTime']),
    reason: pickString(payload, ['reason', 'cancel_reason', 'cancelReason']),
    cancelledBy: pickString(payload, ['cancelled_by', 'cancelledBy']),
    companyId: pickString(payload, ['company_id', 'companyId', 'client_id', 'clientId']),
    telnyxAssistantId: pickString(payload, ['telnyx_assistant_id', 'telnyxAssistantId', 'assistant_id', 'assistantId']),
    calledNumber: pickString(payload, ['called_number', 'calledNumber', 'to', 'to_number'])
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

  const parsed = cancelSchema.safeParse(normalizePayload(body));

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'invalid_payload', issues: parsed.error.flatten().fieldErrors },
      { status: 400, headers: corsHeaders }
    );
  }

  if (!parsed.data.appointmentId && !parsed.data.phone) {
    return NextResponse.json(
      { success: false, error: 'appointmentId_or_phone_required' },
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    const result = await cancelVoiceAppointment({
      ...parsed.data,
      rawPayload: body
    });

    return NextResponse.json(result, { headers: corsHeaders });
  } catch (error) {
    if (error instanceof Error && error.message === 'company_not_resolved') {
      return NextResponse.json({ success: false, error: 'company_not_resolved' }, { status: 404, headers: corsHeaders });
    }

    if (error instanceof Error && error.message === 'appointment_not_found') {
      return NextResponse.json({ success: false, error: 'appointment_not_found' }, { status: 404, headers: corsHeaders });
    }

    if (error instanceof Error && error.message === 'invalid_startTime') {
      return NextResponse.json({ success: false, error: 'invalid_startTime' }, { status: 400, headers: corsHeaders });
    }

    console.error('[voice-tool] cancel appointment failed', error);

    return NextResponse.json({ success: false, error: 'voice_appointment_cancel_failed' }, { status: 500, headers: corsHeaders });
  }
}
