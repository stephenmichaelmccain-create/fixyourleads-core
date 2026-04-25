"use server";

import { CrmProvider, Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { encryptJson } from '@/lib/encrypted-json';
import { pushLeadToClientCRM } from '@/lib/crm-router';
import type { StandardLead } from '@/lib/crm-adapters/types';

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value || '').trim();
  return text || null;
}

function parseProvider(value: FormDataEntryValue | null) {
  const provider = String(value || '').trim().toUpperCase();

  if (Object.values(CrmProvider).includes(provider as CrmProvider)) {
    return provider as CrmProvider;
  }

  return CrmProvider.NONE;
}

function parseJsonObject(value: FormDataEntryValue | null, fallback: Record<string, unknown> | null) {
  const text = String(value || '').trim();

  if (!text) {
    return fallback;
  }

  const parsed = JSON.parse(text);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('json_object_required');
  }

  return parsed as Record<string, unknown>;
}

function crmPath(companyId: string, params: Record<string, string>) {
  const search = new URLSearchParams(params);
  return `/clients/${companyId}/crm?${search.toString()}#crm-integration`;
}

export async function saveClientCrmIntegrationAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  const crmProvider = parseProvider(formData.get('crmProvider'));
  const telnyxAssistantId = optionalText(formData.get('telnyxAssistantId'));
  const notificationPhone = optionalText(formData.get('notificationPhone'));
  const rawCredentials = optionalText(formData.get('crmCredentials'));

  if (!companyId) {
    throw new Error('company_id_required');
  }

  let crmFieldMapping: Record<string, unknown>;

  try {
    crmFieldMapping = parseJsonObject(formData.get('crmFieldMapping'), {}) || {};
  } catch {
    redirect(crmPath(companyId, { notice: 'invalid_field_mapping' }));
  }

  const existing = await db.company.findUnique({
    where: { id: companyId },
    select: {
      crmCredentialsEncrypted: true
    }
  });

  if (!existing) {
    throw new Error('company_not_found');
  }

  let crmCredentialsEncrypted = existing.crmCredentialsEncrypted;

  if (crmProvider === CrmProvider.NONE) {
    crmCredentialsEncrypted = null;
  } else if (rawCredentials) {
    try {
      crmCredentialsEncrypted = encryptJson(parseJsonObject(rawCredentials, {}));
    } catch (error) {
      const notice = error instanceof Error && error.message === 'crm_encryption_key_missing'
        ? 'encryption_key_missing'
        : 'invalid_credentials';
      redirect(crmPath(companyId, { notice }));
    }
  }

  await db.company.update({
    where: { id: companyId },
    data: {
      crmProvider,
      crmCredentialsEncrypted,
      crmFieldMapping: crmFieldMapping as Prisma.InputJsonObject,
      telnyxAssistantId,
      notificationPhone
    }
  });

  revalidatePath(`/clients/${companyId}`);
  revalidatePath(`/clients/${companyId}/crm`);

  redirect(crmPath(companyId, { notice: 'crm_updated' }));
}

export async function testClientCrmIntegrationAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();

  if (!companyId) {
    throw new Error('company_id_required');
  }

  const testLead: StandardLead = {
    full_name: 'Fix Your Leads Test Caller',
    email: 'test-lead@example.com',
    phone: '+15555550123',
    business_name: 'Test Med Spa',
    source: 'voice_agent',
    call_id: `crm-test-${Date.now()}`,
    notes: 'Test lead from the operator CRM integration screen.',
    created_at: new Date().toISOString()
  };

  const result = await pushLeadToClientCRM(companyId, testLead, {
    attempt: 1
  });

  revalidatePath(`/clients/${companyId}/crm`);

  redirect(
    crmPath(companyId, {
      test: result.success ? 'success' : 'failed',
      provider: result.provider,
      detail: result.success ? result.externalId || 'ok' : result.error || 'crm_sync_failed'
    })
  );
}
