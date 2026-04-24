import { Prisma, WorkflowStatus, WorkflowType } from '@prisma/client';
import { db } from '@/lib/db';
import { companyPrimaryInboundNumber } from '@/lib/inbound-numbers';
import { sendReviewAlertNotification } from '@/lib/notifications';
import { normalizePhone } from '@/lib/phone';
import { scheduleWorkflowRun } from '@/lib/workflow-jobs';
import { completeWorkflowRuns, ensurePhoneChannelIdentities } from '@/lib/workflows';
import { parseClientCalendarSetupPayload } from '@/lib/client-calendar-setup';
import { sendOutboundMessage } from '@/services/messaging';
import { sendSms } from '@/lib/telnyx';

const DEFAULT_REVIEW_DELAY_HOURS = 2;
const REVIEW_START_HOUR = 9;
const REVIEW_END_HOUR = 21;

type ReviewWorkflowPayload = {
  stage?: string;
  appointmentId?: string | null;
  googleReviewUrl?: string | null;
  ownerAlertContact?: string | null;
  clarificationSent?: boolean;
  score?: number | null;
  replyText?: string | null;
  optInSource?: string | null;
  reviewRequestSentAt?: string | null;
  reviewRequestMessageId?: string | null;
  completedAt?: string | null;
  resolvedAt?: string | null;
};

export type ReviewAutomationSettings = {
  enabled: boolean;
  googleReviewUrl: string | null;
  ownerAlertContact: string | null;
  webhookSecret: string | null;
  delayHours: number;
  timezone: string;
};

function reviewPayload(payload: Prisma.JsonValue | null | undefined): ReviewWorkflowPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }

  return payload as ReviewWorkflowPayload;
}

function safeJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isEmail(value: string | null | undefined) {
  return Boolean(value && value.includes('@'));
}

function parseDelayHours(value: string | null) {
  const parsed = Number(value || DEFAULT_REVIEW_DELAY_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REVIEW_DELAY_HOURS;
}

function readTimeZoneHour(date: Date, timeZone: string) {
  try {
    const hour = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hour12: false
    }).format(date);
    const parsed = Number(hour);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function adjustForQuietHours(candidate: Date, timeZone: string) {
  let scheduled = new Date(candidate);

  for (let i = 0; i < 96; i += 1) {
    const localHour = readTimeZoneHour(scheduled, timeZone);
    if (localHour === null) {
      return scheduled;
    }

    if (localHour >= REVIEW_START_HOUR && localHour < REVIEW_END_HOUR) {
      return scheduled;
    }

    scheduled = new Date(scheduled.getTime() + 30 * 60 * 1000);
  }

  return scheduled;
}

function reviewPromptText(name: string | null) {
  const firstName = name?.trim()?.split(/\s+/)[0] || 'there';
  return `Hi ${firstName}, thanks for coming in today! On a scale of 1-10, how was your visit? Reply STOP to opt out.`;
}

function reviewClarificationText() {
  return 'Sorry, I did not catch that. Could you reply with a number from 1 to 10 so we can log your feedback?';
}

function positiveReviewFollowUpText(reviewUrl: string) {
  return `So glad to hear it! Would you mind sharing on Google? ${reviewUrl}`;
}

function negativeReviewFollowUpText(companyName: string) {
  return `Thanks for the honest feedback. ${companyName} wants to hear this directly and will reach out shortly.`;
}

function ownerAlertSmsText(companyName: string, customerName: string, score: number, feedbackText: string) {
  return `Low rating for ${companyName}: ${customerName} replied ${score}/10. Latest feedback: ${feedbackText || 'No text captured'}`;
}

export function parseReviewScore(text: string) {
  const match = String(text || '').match(/\b10\b|\b[1-9]\b/);
  if (!match) {
    return null;
  }

  const score = Number(match[0]);
  return Number.isFinite(score) && score >= 1 && score <= 10 ? score : null;
}

export async function getReviewAutomationSettings(companyId: string): Promise<ReviewAutomationSettings> {
  const latestSetup = await db.eventLog.findFirst({
    where: { companyId, eventType: 'client_calendar_setup_updated' },
    orderBy: { createdAt: 'desc' },
    select: { payload: true }
  });

  const state = parseClientCalendarSetupPayload(latestSetup?.payload || null);

  return {
    enabled: state.reviewAutomationEnabled,
    googleReviewUrl: state.reviewGoogleReviewUrl,
    ownerAlertContact: state.reviewOwnerAlertContact,
    webhookSecret: state.reviewWebhookSecret,
    delayHours: parseDelayHours(state.reviewDelayHours),
    timezone: state.timezone || 'America/Chicago'
  };
}

export function reviewWebhookUrl(companyId: string) {
  const baseUrl = String(process.env.APP_BASE_URL || 'https://app-production-9ba1.up.railway.app').replace(/\/+$/, '');
  return `${baseUrl}/api/webhooks/reviews/${companyId}`;
}

export async function enqueueReviewRequestFromCompletion(input: {
  companyId: string;
  appointmentId?: string | null;
  completedAt?: Date | null;
  contactName?: string | null;
  contactPhone: string;
  optInSource?: string | null;
}) {
  const company = await db.company.findUniqueOrThrow({
    where: { id: input.companyId },
    select: { id: true, name: true }
  });

  const settings = await getReviewAutomationSettings(company.id);
  const normalizedPhone = normalizePhone(input.contactPhone);

  if (!normalizedPhone) {
    throw new Error('contact_phone_invalid');
  }

  if (!settings.enabled) {
    throw new Error('review_automation_disabled');
  }

  if (!settings.googleReviewUrl) {
    throw new Error('review_google_url_missing');
  }

  const contact = await db.contact.upsert({
    where: { companyId_phone: { companyId: company.id, phone: normalizedPhone } },
    update: {
      phone: normalizedPhone,
      ...(input.contactName ? { name: input.contactName } : {})
    },
    create: {
      companyId: company.id,
      phone: normalizedPhone,
      name: input.contactName || null
    }
  });

  const conversation = await db.conversation.upsert({
    where: { companyId_contactId: { companyId: company.id, contactId: contact.id } },
    update: {},
    create: { companyId: company.id, contactId: contact.id }
  });

  await ensurePhoneChannelIdentities(company.id, contact.id, normalizedPhone);

  const completedAt = input.completedAt || new Date();
  const initialSendAt = new Date(completedAt.getTime() + settings.delayHours * 60 * 60 * 1000);
  const nextRunAt = adjustForQuietHours(initialSendAt, settings.timezone);
  const existingRun = await db.workflowRun.findFirst({
    where: {
      companyId: company.id,
      contactId: contact.id,
      workflowType: WorkflowType.REVIEW_REQUEST,
      status: {
        in: [WorkflowStatus.ACTIVE, WorkflowStatus.PAUSED]
      }
    },
    orderBy: { updatedAt: 'desc' }
  });

  const payload = {
    stage: 'pending_send',
    appointmentId: input.appointmentId || null,
    googleReviewUrl: settings.googleReviewUrl,
    ownerAlertContact: settings.ownerAlertContact,
    clarificationSent: false,
    score: null,
    replyText: null,
    optInSource: input.optInSource || null,
    completedAt: completedAt.toISOString(),
    resolvedAt: null
  };

  const workflowRun = existingRun
    ? await db.workflowRun.update({
        where: { id: existingRun.id },
        data: {
          status: WorkflowStatus.ACTIVE,
          conversationId: conversation.id,
          payload: safeJson(payload),
          nextRunAt,
          pausedAt: null,
          completedAt: null,
          canceledAt: null
        }
      })
    : await db.workflowRun.create({
        data: {
          companyId: company.id,
          contactId: contact.id,
          conversationId: conversation.id,
          workflowType: WorkflowType.REVIEW_REQUEST,
          status: WorkflowStatus.ACTIVE,
          priority: 10,
          payload: safeJson(payload),
          nextRunAt
        }
      });

  await db.eventLog.create({
    data: {
      companyId: company.id,
      eventType: 'review_request_queued',
      payload: {
        workflowRunId: workflowRun.id,
        contactId: contact.id,
        conversationId: conversation.id,
        appointmentId: input.appointmentId || null,
        completedAt: completedAt.toISOString(),
        nextRunAt: nextRunAt.toISOString(),
        optInSource: input.optInSource || null
      }
    }
  });

  await scheduleWorkflowRun({
    workflowRunId: workflowRun.id,
    nextRunAt
  });

  return {
    company,
    contact,
    conversation,
    workflowRun,
    nextRunAt
  };
}

export async function enqueueReviewRequestTest(input: {
  companyId: string;
  contactName?: string | null;
  contactPhone: string;
}) {
  const settings = await getReviewAutomationSettings(input.companyId);
  const completedAt = new Date(Date.now() - settings.delayHours * 60 * 60 * 1000 - 60 * 1000);

  return enqueueReviewRequestFromCompletion({
    companyId: input.companyId,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    completedAt,
    appointmentId: `review-test-${Date.now()}`,
    optInSource: 'operator_review_test'
  });
}

export async function executeReviewRequestWorkflow(workflowRunId: string) {
  const workflowRun = await db.workflowRun.findUnique({
    where: { id: workflowRunId },
    include: {
      contact: true
    }
  });

  if (!workflowRun) {
    return;
  }

  if (workflowRun.status !== WorkflowStatus.ACTIVE || workflowRun.workflowType !== WorkflowType.REVIEW_REQUEST) {
    return;
  }

  const payload = reviewPayload(workflowRun.payload);
  if (payload.stage !== 'pending_send') {
    await db.eventLog.create({
      data: {
        companyId: workflowRun.companyId,
        eventType: 'review_request_skipped',
        payload: {
          workflowRunId,
          contactId: workflowRun.contactId,
          stage: payload.stage || 'unknown',
          reason: 'workflow_stage_not_pending_send'
        }
      }
    });
    return;
  }

  const settings = await getReviewAutomationSettings(workflowRun.companyId);
  if (!settings.enabled || !settings.googleReviewUrl) {
    await completeWorkflowRuns({
      companyId: workflowRun.companyId,
      contactId: workflowRun.contactId,
      workflowTypes: [WorkflowType.REVIEW_REQUEST],
      reason: 'review_automation_disabled_or_missing_url',
      status: WorkflowStatus.CANCELED
    });
    return;
  }

  const result = await sendOutboundMessage(
    workflowRun.companyId,
    workflowRun.contactId,
    reviewPromptText(workflowRun.contact.name),
    'review_request_sent'
  );

  await db.workflowRun.update({
    where: { id: workflowRun.id },
    data: {
      payload: safeJson({
        ...payload,
        stage: 'awaiting_score',
        clarificationSent: false,
        reviewRequestSentAt: result.message.createdAt.toISOString(),
        reviewRequestMessageId: result.message.id
      }),
      nextRunAt: null,
      lastOutboundAt: result.message.createdAt
    }
  });

  await db.eventLog.create({
    data: {
      companyId: workflowRun.companyId,
      eventType: 'review_request_workflow_updated',
      payload: {
        workflowRunId: workflowRun.id,
        contactId: workflowRun.contactId,
        stage: 'awaiting_score',
        reviewRequestMessageId: result.message.id
      }
    }
  });
}

async function sendOwnerAlert(input: {
  companyId: string;
  companyName: string;
  ownerAlertContact: string | null;
  customerName: string;
  customerPhone: string;
  score: number;
  feedbackText: string;
}) {
  const destination = input.ownerAlertContact;

  if (!destination) {
    return {
      status: 'skipped' as const,
      detail: 'owner_alert_destination_missing'
    };
  }

  if (isEmail(destination)) {
    return sendReviewAlertNotification({
      companyName: input.companyName,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      score: input.score,
      feedbackText: input.feedbackText,
      to: destination
    });
  }

  const company = await db.company.findUnique({
    where: { id: input.companyId },
    select: {
      telnyxInboundNumber: true,
      telnyxInboundNumbers: {
        select: { number: true }
      }
    }
  });

  if (!company) {
    return {
      status: 'failed' as const,
      detail: 'company_not_found_for_owner_alert'
    };
  }

  const ownerPhone = normalizePhone(destination);
  if (!ownerPhone) {
    return {
      status: 'skipped' as const,
      detail: 'owner_alert_destination_invalid'
    };
  }

  try {
    const result = await sendSms(
      ownerPhone,
      ownerAlertSmsText(input.companyName, input.customerName, input.score, input.feedbackText),
      companyPrimaryInboundNumber(company)
    );

    return {
      status: 'sent' as const,
      detail: `review alert sent to ${ownerPhone}`,
      messageId: result?.data?.id || ''
    };
  } catch (error) {
    return {
      status: 'failed' as const,
      detail: error instanceof Error ? error.message : 'owner_alert_send_failed'
    };
  }
}

export async function handleReviewAutomationReply(input: {
  companyId: string;
  contactId: string;
  text: string;
}) {
  const workflowRun = await db.workflowRun.findFirst({
    where: {
      companyId: input.companyId,
      contactId: input.contactId,
      workflowType: WorkflowType.REVIEW_REQUEST,
      status: WorkflowStatus.ACTIVE
    },
    orderBy: { updatedAt: 'desc' },
    include: {
      contact: true
    }
  });

  if (!workflowRun) {
    return { handled: false as const };
  }

  const payload = reviewPayload(workflowRun.payload);
  if (!['awaiting_score', 'clarification_sent'].includes(payload.stage || '')) {
    return { handled: false as const };
  }

  const score = parseReviewScore(input.text);
  if (score === null) {
    if (payload.clarificationSent) {
      await db.eventLog.create({
        data: {
          companyId: input.companyId,
          eventType: 'review_score_unparsed',
          payload: {
            workflowRunId: workflowRun.id,
            contactId: input.contactId,
            text: input.text,
            clarificationAlreadySent: true
          }
        }
      });
      return { handled: true as const, outcome: 'ignored_unclear_follow_up' as const };
    }

    const clarification = await sendOutboundMessage(
      input.companyId,
      input.contactId,
      reviewClarificationText(),
      'review_score_clarification_sent'
    );

    await db.workflowRun.update({
      where: { id: workflowRun.id },
      data: {
        payload: safeJson({
          ...payload,
          stage: 'clarification_sent',
          clarificationSent: true,
          replyText: input.text
        }),
        lastInboundAt: new Date(),
        lastOutboundAt: clarification.message.createdAt
      }
    });

    return { handled: true as const, outcome: 'clarification_sent' as const };
  }

  const settings = await getReviewAutomationSettings(input.companyId);
  const company = await db.company.findUniqueOrThrow({
    where: { id: input.companyId },
    select: {
      id: true,
      name: true,
      notificationEmail: true,
      primaryContactEmail: true,
      primaryContactPhone: true
    }
  });

  await db.eventLog.create({
    data: {
      companyId: input.companyId,
      eventType: 'review_score_received',
      payload: {
        workflowRunId: workflowRun.id,
        contactId: input.contactId,
        score,
        text: input.text,
        appointmentId: payload.appointmentId || null
      }
    }
  });

  if (score >= 9) {
    if (settings.googleReviewUrl) {
      const followUp = await sendOutboundMessage(
        input.companyId,
        input.contactId,
        positiveReviewFollowUpText(settings.googleReviewUrl),
        'review_positive_follow_up_sent'
      );

      await db.workflowRun.update({
        where: { id: workflowRun.id },
        data: {
          payload: safeJson({
            ...payload,
            stage: 'completed_positive',
            score,
            replyText: input.text,
            resolvedAt: new Date().toISOString()
          }),
          lastInboundAt: new Date(),
          lastOutboundAt: followUp.message.createdAt
        }
      });
    }

    await completeWorkflowRuns({
      companyId: input.companyId,
      contactId: input.contactId,
      workflowTypes: [WorkflowType.REVIEW_REQUEST],
      reason: 'positive_review_handled'
    });

    return { handled: true as const, outcome: 'positive_review_link_sent' as const };
  }

  const apology = await sendOutboundMessage(
    input.companyId,
    input.contactId,
    negativeReviewFollowUpText(company.name),
    'review_negative_follow_up_sent'
  );

  const ownerAlertContact =
    settings.ownerAlertContact || company.notificationEmail || company.primaryContactEmail || company.primaryContactPhone || null;
  const ownerAlert = await sendOwnerAlert({
    companyId: company.id,
    companyName: company.name,
    ownerAlertContact,
    customerName: workflowRun.contact.name || 'Unnamed customer',
    customerPhone: workflowRun.contact.phone,
    score,
    feedbackText: input.text
  });

  await db.eventLog.create({
    data: {
      companyId: input.companyId,
      eventType: 'review_owner_alert_processed',
      payload: {
        workflowRunId: workflowRun.id,
        contactId: input.contactId,
        score,
        destination: ownerAlertContact,
        alertStatus: ownerAlert.status,
        alertDetail: ownerAlert.detail
      }
    }
  });

  await db.workflowRun.update({
    where: { id: workflowRun.id },
    data: {
      payload: safeJson({
        ...payload,
        stage: 'completed_negative',
        score,
        replyText: input.text,
        resolvedAt: new Date().toISOString()
      }),
      lastInboundAt: new Date(),
      lastOutboundAt: apology.message.createdAt
    }
  });

  await completeWorkflowRuns({
    companyId: input.companyId,
    contactId: input.contactId,
    workflowTypes: [WorkflowType.REVIEW_REQUEST],
    reason: 'negative_review_handled'
  });

  return { handled: true as const, outcome: 'negative_review_escalated' as const };
}
