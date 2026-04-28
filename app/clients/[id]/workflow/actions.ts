"use server";

import { CrmProvider } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { encryptJson } from '@/lib/encrypted-json';
import { buildN8nEditorUrl } from '@/lib/n8n';
import { emptyTelnyxSetupState, parseTelnyxSetupPayload } from '@/lib/client-telnyx-setup';
import { provisionClientAutomation, resetClientAutomation } from '@/services/automation';
import { connectClientTelnyxAssistant } from '@/services/telnyx-provisioning';

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

function readPayloadRecord(payload: unknown) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

function readEncryptedCrmPayload(payload: unknown) {
  const record = readPayloadRecord(payload);
  return typeof record.crmCredentialsEncrypted === 'string' ? record.crmCredentialsEncrypted.trim() : '';
}

function workflowPath(companyId: string, notice?: string) {
  const params = new URLSearchParams();

  if (notice) {
    params.set('notice', notice);
  }

  const search = params.toString();
  return search ? `/clients/${companyId}/connections?${search}` : `/clients/${companyId}/connections`;
}

function revalidateClientConnectionPaths(companyId: string) {
  revalidatePath(`/clients/${companyId}`);
  revalidatePath(`/clients/${companyId}/workflow`);
  revalidatePath(`/clients/${companyId}/connections`);
  revalidatePath(`/clients/${companyId}/live-log`);
  revalidatePath(`/clients/${companyId}/crm`);
  revalidatePath(`/clients/${companyId}/booking`);
  revalidatePath(`/clients/${companyId}/calendar`);
  revalidatePath(`/clients/${companyId}/operator`);
  revalidatePath(`/events?companyId=${companyId}`);
  revalidatePath(`/bookings?companyId=${companyId}`);
  revalidatePath('/diagnostics/voice');
}

function appBaseUrl() {
  return process.env.APP_BASE_URL?.trim().replace(/\/$/, '') || null;
}

function defaultVoiceWebhookUrl() {
  const baseUrl = appBaseUrl();
  return baseUrl ? `${baseUrl}/api/webhooks/voice/appointments` : null;
}

function defaultWorkflowUrl(companyId: string) {
  const baseUrl = appBaseUrl();
  return baseUrl ? `${baseUrl}/clients/${companyId}/connections` : null;
}

function buildCrmCredentials(provider: CrmProvider, apiKey: string | null, secondaryKey: string | null) {
  switch (provider) {
    case CrmProvider.HUBSPOT:
      return {
        privateAppToken: apiKey
      };
    case CrmProvider.GOHIGHLEVEL:
      return {
        accessToken: apiKey,
        locationId: secondaryKey
      };
    case CrmProvider.PIPEDRIVE:
      return {
        apiToken: apiKey,
        companyDomain: secondaryKey
      };
    case CrmProvider.SALESFORCE:
      return {
        accessToken: apiKey,
        instanceUrl: secondaryKey
      };
    case CrmProvider.BOULEVARD:
    case CrmProvider.VAGARO:
      return {
        apiKey,
        locationId: secondaryKey
      };
    default:
      return {
        token: apiKey,
        secondaryKey
      };
  }
}

export async function saveClientWorkflowAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();

  if (!companyId) {
    throw new Error('company_id_required');
  }

  const crmProvider = parseProvider(formData.get('crmProvider'));
  const crmApiKey = optionalText(formData.get('crmApiKey'));
  const crmSecondaryKey = optionalText(formData.get('crmSecondaryKey'));

  const voiceLine = optionalText(formData.get('voiceLine'));
  const webhookUrl = optionalText(formData.get('webhookUrl')) || defaultVoiceWebhookUrl();
  const automationUrl = optionalText(formData.get('automationUrl')) || defaultWorkflowUrl(companyId);

  const bookingPlatformName = optionalText(formData.get('bookingPlatformName'));
  const bookingPlatformUrl = optionalText(formData.get('bookingPlatformUrl'));
  const bookingPlatformId = optionalText(formData.get('bookingPlatformId'));
  const bookingApiKey = optionalText(formData.get('bookingApiKey'));
  const bookingSecondaryKey = optionalText(formData.get('bookingSecondaryKey'));
  const secondaryPlatformName = optionalText(formData.get('secondaryPlatformName'));
  const secondaryPlatformUrl = optionalText(formData.get('secondaryPlatformUrl'));
  const secondaryPlatformId = optionalText(formData.get('secondaryPlatformId'));

  const [company, latestVoiceSetupEvent, latestBookingSetupEvent, latestCrmSetupEvent] = await Promise.all([
    db.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        crmCredentialsEncrypted: true
      }
    }),
    db.eventLog.findFirst({
      where: { companyId, eventType: 'client_telnyx_setup_updated' },
      orderBy: { createdAt: 'desc' },
      select: { payload: true }
    }),
    db.eventLog.findFirst({
      where: { companyId, eventType: 'client_calendar_setup_updated' },
      orderBy: { createdAt: 'desc' },
      select: { payload: true }
    }),
    db.eventLog.findFirst({
      where: { companyId, eventType: 'client_crm_setup_updated' },
      orderBy: { createdAt: 'desc' },
      select: { payload: true }
    })
  ]);

  if (!company) {
    throw new Error('company_not_found');
  }

  let crmCredentialsEncrypted = company.crmCredentialsEncrypted;

  try {
    if (crmProvider === CrmProvider.NONE) {
      crmCredentialsEncrypted = null;
    } else if (crmApiKey || crmSecondaryKey) {
      crmCredentialsEncrypted = encryptJson(buildCrmCredentials(crmProvider, crmApiKey, crmSecondaryKey));
    }
  } catch (error) {
    const notice =
      error instanceof Error && error.message === 'crm_encryption_key_missing'
        ? 'encryption_key_missing'
        : 'credentials_invalid';
    redirect(workflowPath(companyId, notice));
  }

  await db.company.update({
    where: { id: companyId },
    data: {
      crmProvider,
      crmCredentialsEncrypted
    }
  });

  const existingCrmPayload = readPayloadRecord(latestCrmSetupEvent?.payload);
  const existingEncryptedCrmCredentials = readEncryptedCrmPayload(latestCrmSetupEvent?.payload) || company.crmCredentialsEncrypted;
  const shouldWriteCrmSetup = Boolean(
    latestCrmSetupEvent || crmProvider !== CrmProvider.NONE || crmApiKey || crmSecondaryKey || company.crmCredentialsEncrypted
  );

  if (shouldWriteCrmSetup) {
    await db.eventLog.create({
      data: {
        companyId,
        eventType: 'client_crm_setup_updated',
        payload: {
          ...existingCrmPayload,
          crmProvider,
          crmCredentialsEncrypted: crmCredentialsEncrypted || existingEncryptedCrmCredentials || null,
          hasApiKey: Boolean(crmCredentialsEncrypted),
          hasSecondaryKey: Boolean(crmSecondaryKey),
          updatedAt: new Date().toISOString()
        }
      }
    });
  }

  const existingVoiceState = latestVoiceSetupEvent
    ? parseTelnyxSetupPayload(latestVoiceSetupEvent.payload)
    : emptyTelnyxSetupState;
  const shouldWriteVoiceSetup = Boolean(latestVoiceSetupEvent || voiceLine || webhookUrl || automationUrl);

  if (shouldWriteVoiceSetup) {
    await db.eventLog.create({
      data: {
        companyId,
        eventType: 'client_telnyx_setup_updated',
        payload: {
          ...existingVoiceState,
          phoneNumber: voiceLine,
          webhookUrl,
          automationUrl,
          webhookConfigured: Boolean(webhookUrl),
          updatedAt: new Date().toISOString()
        }
      }
    });
  }

  const existingBookingPayload = readPayloadRecord(latestBookingSetupEvent?.payload);
  const existingEncryptedBookingCredentials =
    typeof existingBookingPayload.externalPlatformCredentialsEncrypted === 'string'
      ? existingBookingPayload.externalPlatformCredentialsEncrypted.trim()
      : '';

  let bookingCredentialsEncrypted = existingEncryptedBookingCredentials || null;

  try {
    if (bookingApiKey || bookingSecondaryKey) {
      bookingCredentialsEncrypted = encryptJson({
        apiKey: bookingApiKey,
        secondaryKey: bookingSecondaryKey
      });
    }
  } catch (error) {
    const notice =
      error instanceof Error && error.message === 'crm_encryption_key_missing'
        ? 'encryption_key_missing'
        : 'credentials_invalid';
    redirect(workflowPath(companyId, notice));
  }

  const shouldWriteBookingSetup = Boolean(
    latestBookingSetupEvent ||
      bookingPlatformName ||
      bookingPlatformUrl ||
      bookingPlatformId ||
      bookingApiKey ||
      bookingSecondaryKey ||
      secondaryPlatformName ||
      secondaryPlatformUrl ||
      secondaryPlatformId
  );

  if (shouldWriteBookingSetup) {
    const previousPlatformName =
      typeof existingBookingPayload.externalPlatformName === 'string'
        ? existingBookingPayload.externalPlatformName
        : null;
    const previousPlatformUrl =
      typeof existingBookingPayload.externalPlatformUrl === 'string'
        ? existingBookingPayload.externalPlatformUrl
        : null;
    const previousPlatformId =
      typeof existingBookingPayload.externalCalendarId === 'string'
        ? existingBookingPayload.externalCalendarId
        : null;

    await db.eventLog.create({
      data: {
        companyId,
        eventType: 'client_calendar_setup_updated',
        payload: {
          ...existingBookingPayload,
          connectionMode:
            bookingPlatformName || bookingPlatformUrl || bookingPlatformId || bookingCredentialsEncrypted
              ? 'external_booking'
              : typeof existingBookingPayload.connectionMode === 'string'
                ? existingBookingPayload.connectionMode
                : null,
          externalPlatformName: bookingPlatformName || previousPlatformName,
          externalPlatformUrl: bookingPlatformUrl || previousPlatformUrl,
          externalCalendarId: bookingPlatformId || previousPlatformId,
          externalPlatformCredentialsEncrypted: bookingCredentialsEncrypted,
          secondaryPlatformName:
            secondaryPlatformName ||
            (typeof existingBookingPayload.secondaryPlatformName === 'string'
              ? existingBookingPayload.secondaryPlatformName
              : null),
          secondaryPlatformUrl:
            secondaryPlatformUrl ||
            (typeof existingBookingPayload.secondaryPlatformUrl === 'string'
              ? existingBookingPayload.secondaryPlatformUrl
              : null),
          secondaryPlatformId:
            secondaryPlatformId ||
            (typeof existingBookingPayload.secondaryPlatformId === 'string'
              ? existingBookingPayload.secondaryPlatformId
              : null),
          updatedAt: new Date().toISOString()
        }
      }
    });
  }

  const provisionResult = await provisionClientAutomation(companyId, 'workflow_save');

  revalidateClientConnectionPaths(companyId);

  if (provisionResult.status !== 'FAILED' && provisionResult.workflowId) {
    const editorUrl = buildN8nEditorUrl(provisionResult.workflowId);

    if (editorUrl) {
      redirect(editorUrl);
    }
  }

  redirect(workflowPath(companyId, provisionResult.status === 'FAILED' ? 'automation_failed' : 'updated'));
}

export async function retryClientAutomationAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();

  if (!companyId) {
    throw new Error('company_id_required');
  }

  const result = await provisionClientAutomation(companyId, 'manual_retry');

  revalidateClientConnectionPaths(companyId);

  const notice =
    result.status === 'READY'
      ? 'automation_ready'
      : result.status === 'ACTION_REQUIRED'
        ? 'automation_attention'
        : 'automation_failed';

  redirect(workflowPath(companyId, notice));
}

export async function resetClientAutomationAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();

  if (!companyId) {
    throw new Error('company_id_required');
  }

  await resetClientAutomation(companyId);
  revalidateClientConnectionPaths(companyId);
  redirect(workflowPath(companyId, 'automation_reset'));
}

export async function connectClientTelnyxAssistantAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();

  if (!companyId) {
    throw new Error('company_id_required');
  }

  const result = await connectClientTelnyxAssistant(companyId);

  revalidateClientConnectionPaths(companyId);

  const notice =
    result.status === 'READY'
      ? 'telnyx_connected'
      : result.status === 'ACTION_REQUIRED'
        ? 'telnyx_attention'
        : 'telnyx_failed';

  redirect(workflowPath(companyId, notice));
}
