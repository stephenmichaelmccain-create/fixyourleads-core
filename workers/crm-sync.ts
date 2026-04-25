import { Worker } from 'bullmq';
import { getRedis } from '@/lib/redis';
import { db } from '@/lib/db';
import { pushLeadToClientCRM } from '@/lib/crm-router';
import { sendCrmSyncFailureNotification } from '@/lib/notifications';
import type { StandardLead } from '@/lib/crm-adapters/types';

type CrmSyncJobData = {
  companyId: string;
  lead: StandardLead;
  leadId?: string | null;
  contactId?: string | null;
};

const worker = new Worker(
  'crm_sync_queue',
  async (job) => {
    const { companyId, lead, leadId, contactId } = job.data as CrmSyncJobData;

    if (!companyId || !lead) {
      throw new Error('crm_sync_company_and_lead_required');
    }

    const result = await pushLeadToClientCRM(companyId, lead, {
      leadId: leadId || undefined,
      contactId: contactId || undefined,
      attempt: job.attemptsMade + 1
    });

    if (!result.success) {
      throw new Error(result.error || 'crm_sync_failed');
    }
  },
  { connection: getRedis() }
);

worker.on('failed', async (job, error) => {
  if (!job) {
    return;
  }

  const attempts = job.opts.attempts || 1;

  if (job.attemptsMade < attempts) {
    return;
  }

  const { companyId, lead } = job.data as CrmSyncJobData;

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: {
      name: true,
      crmProvider: true,
      notificationEmail: true
    }
  });

  await sendCrmSyncFailureNotification({
    to:
      process.env.VOICE_DEMO_OWNER_EMAIL ||
      process.env.DEFAULT_CLIENT_NOTIFICATION_EMAIL ||
      company?.notificationEmail ||
      process.env.NOTIFICATION_FROM_EMAIL ||
      process.env.SMTP_USER,
    companyName: company?.name || companyId,
    provider: company?.crmProvider || 'UNKNOWN',
    error: error.message,
    leadName: lead?.full_name,
    leadPhone: lead?.phone
  });
});
