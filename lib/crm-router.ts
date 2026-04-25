import { CrmProvider, CrmSyncStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { decryptJson } from '@/lib/encrypted-json';
import { getCrmSyncQueue } from '@/lib/queue';
import { gohighlevelCrmAdapter } from '@/lib/crm-adapters/gohighlevel';
import { hubspotCrmAdapter } from '@/lib/crm-adapters/hubspot';
import { noneCrmAdapter } from '@/lib/crm-adapters/none';
import { createStubCrmAdapter } from '@/lib/crm-adapters/stub';
import type { CrmAdapter, CrmCredentials, CrmFieldMapping, CrmPushResult, StandardLead } from '@/lib/crm-adapters/types';

type PushLeadOptions = {
  leadId?: string;
  contactId?: string;
  attempt?: number;
};

type EnqueueCrmSyncOptions = {
  leadId?: string;
  contactId?: string;
};

const crmAdapters: Record<CrmProvider, CrmAdapter> = {
  [CrmProvider.NONE]: noneCrmAdapter,
  [CrmProvider.HUBSPOT]: hubspotCrmAdapter,
  [CrmProvider.GOHIGHLEVEL]: gohighlevelCrmAdapter,
  [CrmProvider.PIPEDRIVE]: createStubCrmAdapter('pipedrive'),
  [CrmProvider.SALESFORCE]: createStubCrmAdapter('salesforce'),
  [CrmProvider.BOULEVARD]: createStubCrmAdapter('boulevard'),
  [CrmProvider.VAGARO]: createStubCrmAdapter('vagaro')
};

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeFieldMapping(value: unknown): CrmFieldMapping {
  const raw = objectRecord(value);
  const mapping: CrmFieldMapping = {};

  for (const [key, mappedKey] of Object.entries(raw)) {
    if (typeof mappedKey === 'string' && mappedKey.trim()) {
      mapping[key as keyof StandardLead] = mappedKey.trim();
    }
  }

  return mapping;
}

function serializeResult(result: CrmPushResult) {
  return {
    success: result.success,
    externalId: result.externalId || null,
    response: result.response ?? null,
    error: result.error || null
  };
}

export async function pushLeadToClientCRM(
  companyId: string,
  lead: StandardLead,
  options: PushLeadOptions = {}
): Promise<CrmPushResult & { provider: CrmProvider }> {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      crmProvider: true,
      crmCredentialsEncrypted: true,
      crmFieldMapping: true
    }
  });

  if (!company) {
    throw new Error('crm_company_not_found');
  }

  const provider = company.crmProvider || CrmProvider.NONE;
  const adapter = crmAdapters[provider] || noneCrmAdapter;
  let credentials: CrmCredentials = {};
  let result: CrmPushResult;

  try {
    credentials = decryptJson<CrmCredentials>(company.crmCredentialsEncrypted) || {};
    result = await adapter.pushLead(credentials, normalizeFieldMapping(company.crmFieldMapping), lead);
  } catch (error) {
    result = {
      success: false,
      error: error instanceof Error ? error.message : 'crm_sync_failed'
    };
  }

  await db.crmSyncLog.create({
    data: {
      companyId,
      leadId: options.leadId || null,
      contactId: options.contactId || null,
      provider,
      status: result.success ? CrmSyncStatus.SUCCESS : CrmSyncStatus.FAILED,
      externalId: result.externalId || null,
      attempt: options.attempt || 1,
      payload: {
        lead,
        leadId: options.leadId || null,
        contactId: options.contactId || null
      },
      response: serializeResult(result),
      error: result.error || null
    }
  });

  return {
    ...result,
    provider
  };
}

export async function enqueueLeadCrmSync(
  companyId: string,
  lead: StandardLead,
  options: EnqueueCrmSyncOptions = {}
) {
  if (process.env.REDIS_URL) {
    await getCrmSyncQueue().add(
      'push_lead_to_crm',
      {
        companyId,
        lead,
        leadId: options.leadId || null,
        contactId: options.contactId || null
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 15 * 60 * 1000
        },
        removeOnComplete: 100,
        removeOnFail: 500
      }
    );

    return { queued: true, fallback: false };
  }

  void pushLeadToClientCRM(companyId, lead, {
    leadId: options.leadId,
    contactId: options.contactId,
    attempt: 1
  }).catch((error) => {
    console.error('[crm-router] background CRM sync failed', error);
  });

  return { queued: false, fallback: true };
}
