import { LeadStatus, WorkflowStatus, WorkflowType } from '@prisma/client';
import { Worker } from 'bullmq';
import { db } from '@/lib/db';
import { getRedis } from '@/lib/redis';
import { scheduleWorkflowRun } from '@/lib/workflow-jobs';
import { activateWorkflowRun, completeWorkflowRuns } from '@/lib/workflows';
import { sendOutboundMessage } from '@/services/messaging';

const NEW_LEAD_FOLLOW_UP_DELAY_MS = 48 * 60 * 60 * 1000;
const NEW_LEAD_FOLLOW_UP_MAX_TOUCHES = 2;

function readFollowUpTouches(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return 0;
  }

  const value = (payload as Record<string, unknown>).followUpTouches;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function nextLeadFollowUpText(name: string | null, touchNumber: number) {
  const firstName = name?.trim()?.split(/\s+/)[0] || 'there';

  if (touchNumber <= 1) {
    return `Hey ${firstName}, just checking in on your request. Want me to help you get booked?`;
  }

  return `Hey ${firstName}, last quick follow-up from me. If you still want to book, reply here and we can get it moving.`;
}

async function handleNewLeadFollowUp(workflowRunId: string) {
  const workflowRun = await db.workflowRun.findUnique({
    where: { id: workflowRunId },
    include: {
      contact: true,
      lead: true
    }
  });

  if (!workflowRun) {
    return;
  }

  if (workflowRun.status !== WorkflowStatus.ACTIVE || workflowRun.workflowType !== WorkflowType.NEW_LEAD_FOLLOW_UP) {
    return;
  }

  if (!workflowRun.lead || !workflowRun.contact) {
    await completeWorkflowRuns({
      companyId: workflowRun.companyId,
      contactId: workflowRun.contactId,
      workflowTypes: [WorkflowType.NEW_LEAD_FOLLOW_UP],
      reason: 'workflow_missing_contact_or_lead'
    });
    return;
  }

  if (workflowRun.lead.status === LeadStatus.BOOKED) {
    await completeWorkflowRuns({
      companyId: workflowRun.companyId,
      contactId: workflowRun.contactId,
      workflowTypes: [WorkflowType.NEW_LEAD_FOLLOW_UP],
      reason: 'lead_booked'
    });
    return;
  }

  if (workflowRun.lead.status === LeadStatus.SUPPRESSED) {
    await completeWorkflowRuns({
      companyId: workflowRun.companyId,
      contactId: workflowRun.contactId,
      workflowTypes: [WorkflowType.NEW_LEAD_FOLLOW_UP],
      reason: 'lead_suppressed',
      status: WorkflowStatus.CANCELED
    });
    return;
  }

  if (workflowRun.nextRunAt && workflowRun.nextRunAt.getTime() > Date.now()) {
    await scheduleWorkflowRun({
      workflowRunId: workflowRun.id,
      nextRunAt: workflowRun.nextRunAt
    });
    return;
  }

  const followUpTouches = readFollowUpTouches(workflowRun.payload);

  if (followUpTouches >= NEW_LEAD_FOLLOW_UP_MAX_TOUCHES) {
    await completeWorkflowRuns({
      companyId: workflowRun.companyId,
      contactId: workflowRun.contactId,
      workflowTypes: [WorkflowType.NEW_LEAD_FOLLOW_UP],
      reason: 'lead_follow_up_sequence_completed'
    });
    return;
  }

  const result = await sendOutboundMessage(
    workflowRun.companyId,
    workflowRun.contactId,
    nextLeadFollowUpText(workflowRun.contact.name, followUpTouches + 1),
    'workflow_follow_up_message_sent'
  );

  const nextRunAt =
    followUpTouches + 1 >= NEW_LEAD_FOLLOW_UP_MAX_TOUCHES ? null : new Date(Date.now() + NEW_LEAD_FOLLOW_UP_DELAY_MS);

  const updatedRun = await activateWorkflowRun({
    companyId: workflowRun.companyId,
    contactId: workflowRun.contactId,
    conversationId: result.conversation.id,
    leadId: workflowRun.leadId,
    workflowType: WorkflowType.NEW_LEAD_FOLLOW_UP,
    reason: 'lead_follow_up_step_sent',
    lastOutboundAt: result.message.createdAt,
    nextRunAt,
    payload: {
      ...(workflowRun.payload && typeof workflowRun.payload === 'object' ? workflowRun.payload : {}),
      followUpTouches: followUpTouches + 1,
      lastStepAt: result.message.createdAt.toISOString()
    }
  });

  await db.eventLog.create({
    data: {
      companyId: workflowRun.companyId,
      eventType: 'workflow_step_executed',
      payload: {
        workflowRunId: updatedRun.id,
        workflowType: updatedRun.workflowType,
        contactId: workflowRun.contactId,
        leadId: workflowRun.leadId,
        followUpTouches: followUpTouches + 1,
        nextRunAt: nextRunAt?.toISOString() || null
      }
    }
  });

  if (nextRunAt) {
    await scheduleWorkflowRun({
      workflowRunId: updatedRun.id,
      nextRunAt
    });
    return;
  }

  await completeWorkflowRuns({
    companyId: workflowRun.companyId,
    contactId: workflowRun.contactId,
    workflowTypes: [WorkflowType.NEW_LEAD_FOLLOW_UP],
    reason: 'lead_follow_up_sequence_completed'
  });
}

new Worker(
  'workflow_queue',
  async (job) => {
    const { workflowRunId } = job.data as { workflowRunId?: string };

    if (!workflowRunId) {
      throw new Error('workflowRunId_required');
    }

    const workflowRun = await db.workflowRun.findUnique({
      where: { id: workflowRunId },
      select: {
        companyId: true,
        workflowType: true
      }
    });

    if (!workflowRun) {
      return;
    }

    switch (workflowRun.workflowType) {
      case WorkflowType.NEW_LEAD_FOLLOW_UP:
        await handleNewLeadFollowUp(workflowRunId);
        return;
      default:
        await db.eventLog.create({
          data: {
            companyId: workflowRun.companyId,
            eventType: 'workflow_step_skipped',
            payload: {
              workflowRunId,
              workflowType: workflowRun.workflowType,
              reason: 'workflow_type_not_implemented'
            }
          }
        });
    }
  },
  { connection: getRedis() }
);
