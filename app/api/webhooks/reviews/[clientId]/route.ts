import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { enqueueReviewRequestFromCompletion, getReviewAutomationSettings } from '@/services/reviews';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const reviewWebhookSchema = z.object({
  appointmentId: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  completedAt: z.string().trim().min(1).optional(),
  contactName: z.string().trim().min(1).optional(),
  customerName: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  contactPhone: z.string().trim().min(7).optional(),
  customerPhone: z.string().trim().min(7).optional(),
  phone: z.string().trim().min(7).optional(),
  optInSource: z.string().trim().min(1).optional()
});

function secureCompare(left: string, right: string) {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function firstText(...values: Array<unknown>) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) {
      return text;
    }
  }

  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const company = await db.company.findUnique({
    where: { id: clientId },
    select: { id: true }
  });

  if (!company) {
    return NextResponse.json({ error: 'client_not_found' }, { status: 404 });
  }

  const settings = await getReviewAutomationSettings(company.id);
  if (!settings.enabled) {
    return NextResponse.json({ error: 'review_automation_disabled' }, { status: 400 });
  }

  const providedSecret =
    String(request.headers.get('x-review-webhook-secret') || '').trim() ||
    String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();

  if (!settings.webhookSecret || !providedSecret || !secureCompare(settings.webhookSecret, providedSecret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = reviewWebhookSchema.safeParse(body || {});

  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const status = firstText(parsed.data.status) || 'completed';
  if (status.toLowerCase() !== 'completed') {
    return NextResponse.json({ ok: true, skipped: true, reason: 'status_not_completed' });
  }

  const contactPhone = firstText(parsed.data.contactPhone, parsed.data.customerPhone, parsed.data.phone);
  if (!contactPhone) {
    return NextResponse.json({ error: 'contactPhone_required' }, { status: 400 });
  }

  const contactName = firstText(parsed.data.contactName, parsed.data.customerName, parsed.data.name);
  const completedAtRaw = firstText(parsed.data.completedAt);
  const completedAt = completedAtRaw ? new Date(completedAtRaw) : new Date();

  if (Number.isNaN(completedAt.getTime())) {
    return NextResponse.json({ error: 'invalid_completedAt' }, { status: 400 });
  }

  let queued;
  try {
    queued = await enqueueReviewRequestFromCompletion({
      companyId: company.id,
      appointmentId: firstText(parsed.data.appointmentId),
      completedAt,
      contactName,
      contactPhone,
      optInSource: firstText(parsed.data.optInSource)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'review_queue_failed';
    return NextResponse.json({ error: detail }, { status: 400 });
  }

  await db.eventLog.create({
    data: {
      companyId: company.id,
      eventType: 'review_webhook_received',
      payload: {
        workflowRunId: queued.workflowRun.id,
        appointmentId: firstText(parsed.data.appointmentId),
        contactId: queued.contact.id,
        conversationId: queued.conversation.id,
        scheduledFor: queued.nextRunAt.toISOString()
      }
    }
  });

  return NextResponse.json({
    ok: true,
    workflowRunId: queued.workflowRun.id,
    scheduledFor: queued.nextRunAt.toISOString()
  });
}
