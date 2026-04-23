import { ContactChannelType, Prisma, WorkflowStatus, WorkflowType, type WorkflowRun } from '@prisma/client';
import { db } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';

const WORKFLOW_PRIORITY: Record<WorkflowType, number> = {
  REVIEW_REQUEST: 10,
  REACTIVATION: 20,
  RECALL: 30,
  NEW_LEAD_FOLLOW_UP: 40,
  ACTIVE_CONVERSATION: 60,
  BOOKING: 80,
  NO_SHOW_RECOVERY: 90
};

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function normalizeChannelSource(channelType: ContactChannelType, sourceId: string) {
  const raw = String(sourceId || '').trim();

  if (!raw) {
    return '';
  }

  if (channelType === ContactChannelType.SMS || channelType === ContactChannelType.VOICE) {
    return normalizePhone(raw);
  }

  return raw;
}

type EnsureContactChannelIdentityInput = {
  companyId: string;
  contactId: string;
  channelType: ContactChannelType;
  sourceId: string;
};

export async function ensureContactChannelIdentity({
  companyId,
  contactId,
  channelType,
  sourceId
}: EnsureContactChannelIdentityInput) {
  const normalizedSourceId = normalizeChannelSource(channelType, sourceId);

  if (!normalizedSourceId) {
    return null;
  }

  return db.contactChannelIdentity.upsert({
    where: {
      companyId_channelType_sourceId: {
        companyId,
        channelType,
        sourceId: normalizedSourceId
      }
    },
    update: {
      contactId
    },
    create: {
      companyId,
      contactId,
      channelType,
      sourceId: normalizedSourceId
    }
  });
}

export async function ensurePhoneChannelIdentities(companyId: string, contactId: string, phone: string) {
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone) {
    return [];
  }

  return Promise.all([
    ensureContactChannelIdentity({
      companyId,
      contactId,
      channelType: ContactChannelType.SMS,
      sourceId: normalizedPhone
    }),
    ensureContactChannelIdentity({
      companyId,
      contactId,
      channelType: ContactChannelType.VOICE,
      sourceId: normalizedPhone
    })
  ]);
}

type ActivateWorkflowRunInput = {
  companyId: string;
  contactId: string;
  workflowType: WorkflowType;
  conversationId?: string | null;
  leadId?: string | null;
  payload?: unknown;
  nextRunAt?: Date | null;
  reason?: string | null;
  lastInboundAt?: Date | null;
  lastOutboundAt?: Date | null;
};

type WorkflowCompletionStatus = typeof WorkflowStatus.COMPLETED | typeof WorkflowStatus.CANCELED;

type CompleteWorkflowRunsInput = {
  companyId: string;
  contactId: string;
  workflowTypes?: WorkflowType[];
  reason?: string | null;
  status?: WorkflowCompletionStatus;
};

function completionTimestampField(status: WorkflowCompletionStatus) {
  return status === WorkflowStatus.CANCELED ? 'canceledAt' : 'completedAt';
}

export async function activateWorkflowRun({
  companyId,
  contactId,
  workflowType,
  conversationId,
  leadId,
  payload,
  nextRunAt,
  reason,
  lastInboundAt,
  lastOutboundAt
}: ActivateWorkflowRunInput): Promise<WorkflowRun> {
  const priority = WORKFLOW_PRIORITY[workflowType];
  const payloadJson = toJsonValue(payload);
  const now = new Date();

  return db.$transaction(async (tx) => {
    const higherPriorityOwner = await tx.workflowRun.findFirst({
      where: {
        companyId,
        contactId,
        status: WorkflowStatus.ACTIVE,
        priority: { gt: priority }
      },
      orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }]
    });

    if (higherPriorityOwner && higherPriorityOwner.workflowType !== workflowType) {
      const blockedOwner = await tx.workflowRun.update({
        where: { id: higherPriorityOwner.id },
        data: {
          lastInboundAt: lastInboundAt ?? undefined,
          lastOutboundAt: lastOutboundAt ?? undefined
        }
      });

      await tx.eventLog.create({
        data: {
          companyId,
          eventType: 'workflow_activation_blocked',
          payload: {
            contactId,
            requestedWorkflowType: workflowType,
            requestedReason: reason || null,
            blockedByWorkflowRunId: blockedOwner.id,
            blockedByWorkflowType: blockedOwner.workflowType
          }
        }
      });

      return blockedOwner;
    }

    const existingRun = await tx.workflowRun.findFirst({
      where: {
        companyId,
        contactId,
        workflowType,
        status: {
          in: [WorkflowStatus.ACTIVE, WorkflowStatus.PAUSED]
        }
      },
      orderBy: [{ updatedAt: 'desc' }]
    });

    const workflow = existingRun
      ? await tx.workflowRun.update({
          where: { id: existingRun.id },
          data: {
            status: WorkflowStatus.ACTIVE,
            priority,
            conversationId: conversationId ?? existingRun.conversationId,
            leadId: leadId ?? existingRun.leadId,
            payload: payloadJson ?? undefined,
            nextRunAt: nextRunAt ?? undefined,
            pausedAt: null,
            completedAt: null,
            canceledAt: null,
            lastInboundAt: lastInboundAt ?? undefined,
            lastOutboundAt: lastOutboundAt ?? undefined
          }
        })
      : await tx.workflowRun.create({
          data: {
            companyId,
            contactId,
            conversationId: conversationId ?? null,
            leadId: leadId ?? null,
            workflowType,
            status: WorkflowStatus.ACTIVE,
            priority,
            payload: payloadJson ?? undefined,
            nextRunAt: nextRunAt ?? null,
            lastInboundAt: lastInboundAt ?? null,
            lastOutboundAt: lastOutboundAt ?? null
          }
        });

    const workflowsToPause = await tx.workflowRun.findMany({
      where: {
        companyId,
        contactId,
        status: WorkflowStatus.ACTIVE,
        id: { not: workflow.id }
      },
      select: {
        id: true,
        workflowType: true
      }
    });

    if (workflowsToPause.length > 0) {
      await tx.workflowRun.updateMany({
        where: {
          id: {
            in: workflowsToPause.map((run) => run.id)
          }
        },
        data: {
          status: WorkflowStatus.PAUSED,
          pausedAt: now
        }
      });

      await tx.eventLog.create({
        data: {
          companyId,
          eventType: 'workflow_runs_paused',
          payload: {
            contactId,
            activatedWorkflowRunId: workflow.id,
            activatedWorkflowType: workflow.workflowType,
            pausedWorkflowRunIds: workflowsToPause.map((run) => run.id),
            pausedWorkflowTypes: workflowsToPause.map((run) => run.workflowType),
            reason: reason || null
          }
        }
      });
    }

    await tx.eventLog.create({
      data: {
        companyId,
        eventType: 'workflow_activated',
        payload: {
          workflowRunId: workflow.id,
          workflowType,
          contactId,
          conversationId: workflow.conversationId,
          leadId: workflow.leadId,
          priority,
          nextRunAt: workflow.nextRunAt?.toISOString() || null,
          reason: reason || null
        }
      }
    });

    return workflow;
  });
}

export async function completeWorkflowRuns({
  companyId,
  contactId,
  workflowTypes,
  reason,
  status = WorkflowStatus.COMPLETED
}: CompleteWorkflowRunsInput) {
  const runs = await db.workflowRun.findMany({
    where: {
      companyId,
      contactId,
      ...(workflowTypes?.length ? { workflowType: { in: workflowTypes } } : {}),
      status: {
        in: [WorkflowStatus.ACTIVE, WorkflowStatus.PAUSED]
      }
    },
    select: {
      id: true,
      workflowType: true
    }
  });

  if (runs.length === 0) {
    return [];
  }

  const timestampField = completionTimestampField(status);
  const timestamp = new Date();
  const completionData =
    timestampField === 'canceledAt'
      ? { status, nextRunAt: null, pausedAt: null, canceledAt: timestamp }
      : { status, nextRunAt: null, pausedAt: null, completedAt: timestamp };

  await db.workflowRun.updateMany({
    where: {
      id: {
        in: runs.map((run) => run.id)
      }
    },
    data: completionData
  });

  await db.eventLog.create({
    data: {
      companyId,
      eventType: status === WorkflowStatus.CANCELED ? 'workflow_runs_canceled' : 'workflow_runs_completed',
      payload: {
        contactId,
        workflowRunIds: runs.map((run) => run.id),
        workflowTypes: runs.map((run) => run.workflowType),
        reason: reason || null
      }
    }
  });

  return runs;
}

export async function cancelWorkflowRunsForContact(companyId: string, contactId: string, reason?: string | null) {
  return completeWorkflowRuns({
    companyId,
    contactId,
    reason,
    status: WorkflowStatus.CANCELED
  });
}

export async function touchWorkflowActivity({
  companyId,
  contactId,
  direction,
  when = new Date()
}: {
  companyId: string;
  contactId: string;
  direction: 'inbound' | 'outbound';
  when?: Date;
}) {
  const currentOwner = await db.workflowRun.findFirst({
    where: {
      companyId,
      contactId,
      status: WorkflowStatus.ACTIVE
    },
    orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }]
  });

  if (!currentOwner) {
    return null;
  }

  return db.workflowRun.update({
    where: { id: currentOwner.id },
    data: direction === 'inbound' ? { lastInboundAt: when } : { lastOutboundAt: when }
  });
}

export async function getWorkflowOwner(companyId: string, contactId: string) {
  return db.workflowRun.findFirst({
    where: {
      companyId,
      contactId,
      status: WorkflowStatus.ACTIVE
    },
    orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }]
  });
}
