import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { verifyTelnyxWebhookSignature } from '@/lib/security';
import { bookVoiceDemo } from '@/services/voice-demo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const voiceDemoSchema = z.object({
  fullName: z.string().trim().min(1),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7),
  businessName: z.string().trim().min(1),
  businessType: z.string().trim().min(1).optional(),
  preferredTime: z.string().trim().min(1).optional(),
  reason: z.string().trim().min(1).optional(),
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
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Webhook-Secret, X-Voice-Demo-Secret'
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

function normalizePayload(body: unknown) {
  const payload = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

  return {
    fullName: pickString(payload, ['full_name', 'fullName', 'name', 'caller_name']),
    email: pickString(payload, ['email', 'email_address', 'caller_email']),
    phone: pickString(payload, ['phone', 'phone_number', 'caller_phone']),
    businessName: pickString(payload, ['business_name', 'businessName', 'company', 'company_name']),
    businessType: pickString(payload, ['business_type', 'businessType', 'industry']),
    preferredTime: pickString(payload, ['preferred_time', 'preferredTime', 'requested_time', 'booking_time']),
    reason: pickString(payload, ['reason', 'notes', 'intent']),
    companyId: pickString(payload, ['company_id', 'companyId', 'client_id', 'clientId']),
    telnyxAssistantId: pickString(payload, ['telnyx_assistant_id', 'telnyxAssistantId', 'assistant_id', 'assistantId']),
    calledNumber: pickString(payload, ['called_number', 'calledNumber', 'to', 'to_number']),
    callId: pickString(payload, ['call_id', 'callId', 'telnyx_call_control_id', 'call_control_id']),
    recordingUrl: pickString(payload, ['recording_url', 'recordingUrl']),
    transcriptUrl: pickString(payload, ['transcript_url', 'transcriptUrl']),
    transcriptText: pickString(payload, ['transcript_text', 'transcriptText', 'transcript', 'call_transcript'])
  };
}

function webhookSecretMatches(request: NextRequest) {
  const secret = process.env.VOICE_DEMO_WEBHOOK_SECRET?.trim();

  if (!secret) {
    return true;
  }

  const authorization = request.headers.get('authorization') || '';
  const bearer = authorization.replace(/^Bearer\s+/i, '').trim();
  const headerSecret =
    request.headers.get('x-webhook-secret') || request.headers.get('x-voice-demo-secret') || '';

  return bearer === secret || headerSecret === secret;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signatureResult = verifyTelnyxWebhookSignature(
    rawBody,
    request.headers.get('telnyx-signature-ed25519'),
    request.headers.get('telnyx-timestamp')
  );

  if (!signatureResult.ok) {
    return NextResponse.json(
      { success: false, error: 'invalid_signature', reason: signatureResult.reason },
      { status: 401, headers: corsHeaders }
    );
  }

  if (!webhookSecretMatches(request)) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401, headers: corsHeaders });
  }

  let body: unknown;

  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400, headers: corsHeaders });
  }

  const normalizedPayload = normalizePayload(body);
  const parsed = voiceDemoSchema.safeParse(normalizedPayload);

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
    const result = await bookVoiceDemo({
      ...parsed.data,
      rawPayload: body
    });

    return NextResponse.json(result, { headers: corsHeaders });
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid_phone') {
      return NextResponse.json({ success: false, error: 'invalid_phone' }, { status: 400, headers: corsHeaders });
    }

    if (error instanceof Error && error.message === 'calendly_demo_url_missing') {
      return NextResponse.json(
        {
          success: false,
          error: 'calendly_demo_url_missing',
          message: 'Got your info. We will reach out within the hour.'
        },
        { status: 500, headers: corsHeaders }
      );
    }

    console.error('[voice-demo] book_demo webhook failed', error);

    return NextResponse.json(
      {
        success: false,
        error: 'voice_demo_booking_failed',
        message: 'Got your info. We will reach out within the hour.'
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
