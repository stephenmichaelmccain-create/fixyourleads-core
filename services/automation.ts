import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { emptyClientAutomationState, parseClientAutomationPayload } from '@/lib/client-automation';
import { emptyClientCalendarSetupState, parseClientCalendarSetupPayload } from '@/lib/client-calendar-setup';
import { emptyTelnyxSetupState, parseTelnyxSetupPayload } from '@/lib/client-telnyx-setup';
import {
  activateN8nWorkflow,
  N8nRequestError,
  buildN8nEditorUrl,
  buildN8nWebhookUrl,
  cloneN8nTemplateWorkflow,
  getN8nWorkflow,
  n8nProvisioningConfig
} from '@/lib/n8n';

type ProvisionSource = 'signup_approval' | 'workflow_save' | 'manual_retry';

type ProvisionResult = {
  status: 'READY' | 'ACTION_REQUIRED' | 'FAILED';
  detail: string;
  workflowId: string | null;
};

type AutomationEventRecord = {
  companyId: string;
  eventType: 'client_automation_updated';
  payload: Prisma.InputJsonValue;
};

function trimTrailingSlash(value: string | null | undefined) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function appBaseUrl() {
  return trimTrailingSlash(process.env.APP_BASE_URL) || null;
}

function automationConfigUrl(companyId: string) {
  const baseUrl = appBaseUrl();
  return baseUrl ? `${baseUrl}/api/internal/automation/client-config?companyId=${companyId}` : null;
}

function internalBookingCreateUrl() {
  const baseUrl = appBaseUrl();
  return baseUrl ? `${baseUrl}/api/internal/bookings/create` : null;
}

function voiceAvailabilityWebhookUrl() {
  const baseUrl = appBaseUrl();
  return baseUrl ? `${baseUrl}/api/webhooks/voice/check-availability` : null;
}

function voiceCancelWebhookUrl() {
  const baseUrl = appBaseUrl();
  return baseUrl ? `${baseUrl}/api/webhooks/voice/cancel` : null;
}

function voiceAppointmentsWebhookUrl() {
  const baseUrl = appBaseUrl();
  return baseUrl ? `${baseUrl}/api/webhooks/voice/appointments` : null;
}

function configuredVoiceWebhookSecret() {
  return (
    String(process.env.VOICE_BOOKING_WEBHOOK_SECRET || '').trim() ||
    String(process.env.VOICE_DEMO_WEBHOOK_SECRET || '').trim() ||
    String(process.env.INTERNAL_API_KEY || '').trim() ||
    null
  );
}

function defaultWorkflowName(companyName: string) {
  return `${companyName} booking automation`;
}

function summarizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'automation_provision_failed';
}

function calledNumberFromState(input: {
  telnyxInboundNumber: string | null;
  additionalNumbers: Array<{ number: string }>;
  voicePhoneNumber: string | null;
}) {
  return input.telnyxInboundNumber || input.additionalNumbers[0]?.number || input.voicePhoneNumber || null;
}

async function latestAutomationState(companyId: string) {
  const latestEvent = await db.eventLog.findFirst({
    where: { companyId, eventType: 'client_automation_updated' },
    orderBy: { createdAt: 'desc' },
    select: { payload: true }
  });

  return latestEvent ? parseClientAutomationPayload(latestEvent.payload) : emptyClientAutomationState;
}

async function recordAutomationState(record: AutomationEventRecord) {
  await db.eventLog.create({
    data: record
  });
}

function mergedAutomationPayload(input: {
  previous: ReturnType<typeof parseClientAutomationPayload>;
  source: ProvisionSource;
  status: 'PENDING' | 'READY' | 'ACTION_REQUIRED' | 'FAILED';
  workflowId?: string | null;
  workflowName?: string | null;
  workflowEditorUrl?: string | null;
  workflowWebhookPath?: string | null;
  workflowWebhookUrl?: string | null;
  workflowActive?: boolean;
  templateWorkflowId?: string | null;
  configUrl?: string | null;
  bookingCreateUrl?: string | null;
  lastError?: string | null;
  notes?: string | null;
}) {
  const timestamp = new Date().toISOString();

  return {
    ...input.previous,
    provider: 'n8n',
    status: input.status,
    workflowId: input.workflowId ?? input.previous.workflowId,
    workflowName: input.workflowName ?? input.previous.workflowName,
    workflowEditorUrl: input.workflowEditorUrl ?? input.previous.workflowEditorUrl,
    workflowWebhookPath: input.workflowWebhookPath ?? input.previous.workflowWebhookPath,
    workflowWebhookUrl: input.workflowWebhookUrl ?? input.previous.workflowWebhookUrl,
    workflowActive: input.workflowActive ?? input.previous.workflowActive,
    templateWorkflowId: input.templateWorkflowId ?? input.previous.templateWorkflowId,
    configUrl: input.configUrl ?? input.previous.configUrl,
    bookingCreateUrl: input.bookingCreateUrl ?? input.previous.bookingCreateUrl,
    lastError: input.lastError ?? null,
    source: input.source,
    notes: input.notes ?? input.previous.notes,
    lastAttemptAt: timestamp,
    lastSuccessAt:
      input.status === 'READY'
        ? timestamp
        : input.previous.lastSuccessAt,
    updatedAt: timestamp
  };
}

export async function loadAutomationSummary() {
  const companies = await db.company.findMany({
    select: {
      id: true,
      name: true
    }
  });

  if (companies.length === 0) {
    return {
      ready: 0,
      actionRequired: 0,
      failed: 0,
      pending: 0,
      rows: [] as Array<{
        companyId: string;
        companyName: string;
        status: string;
        lastError: string | null;
        updatedAt: string | null;
      }>
    };
  }

  const events = await db.eventLog.findMany({
    where: {
      companyId: { in: companies.map((company) => company.id) },
      eventType: 'client_automation_updated'
    },
    orderBy: { createdAt: 'desc' },
    select: {
      companyId: true,
      payload: true
    }
  });

  const latestByCompany = new Map<string, ReturnType<typeof parseClientAutomationPayload>>();

  for (const event of events) {
    if (!latestByCompany.has(event.companyId)) {
      latestByCompany.set(event.companyId, parseClientAutomationPayload(event.payload));
    }
  }

  const rows = companies
    .map((company) => ({
      companyId: company.id,
      companyName: company.name,
      ...(latestByCompany.get(company.id) || emptyClientAutomationState)
    }))
    .filter((row) => row.status !== 'NOT_CONFIGURED')
    .sort((left, right) => {
      const severity = { FAILED: 0, ACTION_REQUIRED: 1, PENDING: 2, READY: 3 } as Record<string, number>;
      return severity[left.status] - severity[right.status] || left.companyName.localeCompare(right.companyName);
    });

  return {
    ready: rows.filter((row) => row.status === 'READY').length,
    actionRequired: rows.filter((row) => row.status === 'ACTION_REQUIRED').length,
    failed: rows.filter((row) => row.status === 'FAILED').length,
    pending: rows.filter((row) => row.status === 'PENDING').length,
    rows: rows.map((row) => ({
      companyId: row.companyId,
      companyName: row.companyName,
      status: row.status,
      lastError: row.lastError,
      updatedAt: row.updatedAt
    }))
  };
}

export async function provisionClientAutomation(companyId: string, source: ProvisionSource): Promise<ProvisionResult> {
  const [company, latestVoiceSetupEvent, latestCalendarSetupEvent, previousState] = await Promise.all([
    db.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        website: true,
        notificationEmail: true,
        primaryContactName: true,
        primaryContactEmail: true,
        primaryContactPhone: true,
        telnyxInboundNumber: true,
        telnyxAssistantId: true,
        telnyxInboundNumbers: {
          select: { number: true }
        }
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
    latestAutomationState(companyId)
  ]);

  if (!company) {
    throw new Error('company_not_found');
  }

  const voiceState = latestVoiceSetupEvent
    ? parseTelnyxSetupPayload(latestVoiceSetupEvent.payload)
    : emptyTelnyxSetupState;
  const calendarState = latestCalendarSetupEvent
    ? parseClientCalendarSetupPayload(latestCalendarSetupEvent.payload)
    : emptyClientCalendarSetupState;
  const calledNumber = calledNumberFromState({
    telnyxInboundNumber: company.telnyxInboundNumber,
    additionalNumbers: company.telnyxInboundNumbers,
    voicePhoneNumber: voiceState.phoneNumber
  });
  const configUrl = automationConfigUrl(company.id);
  const bookingCreateUrl = internalBookingCreateUrl();
  const readiness = n8nProvisioningConfig();

  await recordAutomationState({
    companyId,
    eventType: 'client_automation_updated',
    payload: mergedAutomationPayload({
      previous: previousState,
      source,
      status: 'PENDING',
      templateWorkflowId: readiness.templateWorkflowId,
      configUrl,
      bookingCreateUrl,
      notes: 'Provisioning shared n8n client workflow.'
    })
  });

  if (!readiness.isConfigured) {
    const detail = `Missing ${readiness.missing.join(', ')} before n8n provisioning can run.`;

    await recordAutomationState({
      companyId,
      eventType: 'client_automation_updated',
      payload: mergedAutomationPayload({
        previous: previousState,
        source,
        status: 'ACTION_REQUIRED',
        templateWorkflowId: readiness.templateWorkflowId,
        configUrl,
        bookingCreateUrl,
        lastError: detail,
        notes: 'Railway env is incomplete for n8n automation.'
      })
    });

    return {
      status: 'ACTION_REQUIRED',
      detail,
      workflowId: previousState.workflowId
    };
  }

  try {
    if (previousState.workflowId) {
      try {
        let existingWorkflow = await getN8nWorkflow(previousState.workflowId);
        let active = existingWorkflow.active === true;
        let detail = 'Existing n8n workflow is active.';
        let activationError: string | null = null;

        if (!active) {
          try {
            existingWorkflow = await activateN8nWorkflow(previousState.workflowId);
            active = existingWorkflow.active === true;
            detail = active
              ? 'Existing n8n workflow was re-activated.'
              : 'Existing n8n workflow still needs activation in n8n.';
          } catch (error) {
            activationError = summarizeError(error);
            detail = `Existing n8n workflow exists but activation still needs attention: ${activationError}`;
          }
        }

        const status = active ? 'READY' : 'ACTION_REQUIRED';

        await recordAutomationState({
          companyId,
          eventType: 'client_automation_updated',
          payload: mergedAutomationPayload({
            previous: previousState,
            source,
            status,
            workflowId: previousState.workflowId,
            workflowName: existingWorkflow.name || previousState.workflowName || defaultWorkflowName(company.name),
            workflowEditorUrl: buildN8nEditorUrl(previousState.workflowId),
            workflowWebhookUrl: previousState.workflowWebhookUrl || buildN8nWebhookUrl(previousState.workflowWebhookPath),
            workflowActive: active,
            templateWorkflowId: readiness.templateWorkflowId,
            configUrl,
            bookingCreateUrl,
            lastError: active ? null : activationError || detail,
            notes: detail
          })
        });

        return {
          status,
          detail,
          workflowId: previousState.workflowId
        };
      } catch (error) {
        if (!(error instanceof N8nRequestError) || error.statusCode !== 404) {
          throw error;
        }
      }
    }

    const replacements = {
      __FYL_COMPANY_ID__: company.id,
      __FYL_COMPANY_NAME__: company.name,
      __FYL_APP_BASE_URL__: appBaseUrl() || '',
      __FYL_CONFIG_URL__: configUrl || '',
      __FYL_BOOKING_CREATE_URL__: bookingCreateUrl || '',
      __FYL_AUTOMATION_SECRET__: readiness.automationSharedSecret || '',
      __FYL_INTERNAL_API_KEY__: String(process.env.INTERNAL_API_KEY || '').trim(),
      __FYL_CALLED_NUMBER__: calledNumber || '',
      __FYL_TELNYX_ASSISTANT_ID__: company.telnyxAssistantId || '',
      __FYL_NOTIFICATION_EMAIL__: company.notificationEmail || '',
      __FYL_EXTERNAL_BOOKING_PLATFORM__: calendarState.externalPlatformName || '',
      __FYL_EXTERNAL_BOOKING_PLATFORM_URL__: calendarState.externalPlatformUrl || '',
      __FYL_EXTERNAL_CALENDAR_ID__: calendarState.externalCalendarId || '',
      __FYL_SECONDARY_PLATFORM_NAME__: calendarState.secondaryPlatformName || '',
      __FYL_SECONDARY_PLATFORM_URL__: calendarState.secondaryPlatformUrl || '',
      __FYL_SECONDARY_PLATFORM_ID__: calendarState.secondaryPlatformId || ''
    };

    const created = await cloneN8nTemplateWorkflow({
      companyId: company.id,
      companyName: company.name,
      workflowName: defaultWorkflowName(company.name),
      replacements
    });

    const status = created.activationError ? 'ACTION_REQUIRED' : 'READY';
    const detail = created.activationError
      ? `Workflow cloned, but activation still needs attention: ${created.activationError}`
      : 'Shared n8n workflow provisioned and activated.';

    const currentState = await latestAutomationState(companyId);

    await recordAutomationState({
      companyId,
      eventType: 'client_automation_updated',
      payload: mergedAutomationPayload({
        previous: currentState,
        source,
        status,
        workflowId: created.workflowId,
        workflowName: created.workflow.name || defaultWorkflowName(company.name),
        workflowEditorUrl: created.editorUrl,
        workflowWebhookPath: created.webhookPath,
        workflowWebhookUrl: created.webhookUrl,
        workflowActive: !created.activationError,
        templateWorkflowId: readiness.templateWorkflowId,
        configUrl,
        bookingCreateUrl,
        lastError: created.activationError,
        notes: detail
      })
    });

    return {
      status,
      detail,
      workflowId: created.workflowId
    };
  } catch (error) {
    const detail = summarizeError(error);
    const currentState = await latestAutomationState(companyId);

    await recordAutomationState({
      companyId,
      eventType: 'client_automation_updated',
      payload: mergedAutomationPayload({
        previous: currentState,
        source,
        status: 'FAILED',
        templateWorkflowId: readiness.templateWorkflowId,
        configUrl,
        bookingCreateUrl,
        lastError: detail,
        notes: 'n8n provisioning failed.'
      })
    });

    return {
      status: 'FAILED',
      detail,
      workflowId: currentState.workflowId
    };
  }
}

export async function automationClientConfig(companyId: string) {
  const [company, latestVoiceSetupEvent, latestCalendarSetupEvent, latestAutomationEvent] = await Promise.all([
    db.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        website: true,
        notificationEmail: true,
        primaryContactName: true,
        primaryContactEmail: true,
        primaryContactPhone: true,
        telnyxInboundNumber: true,
        telnyxAssistantId: true,
        telnyxInboundNumbers: {
          select: { number: true }
        }
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
      where: { companyId, eventType: 'client_automation_updated' },
      orderBy: { createdAt: 'desc' },
      select: { payload: true }
    })
  ]);

  if (!company) {
    return null;
  }

  const voiceState = latestVoiceSetupEvent
    ? parseTelnyxSetupPayload(latestVoiceSetupEvent.payload)
    : emptyTelnyxSetupState;
  const calendarState = latestCalendarSetupEvent
    ? parseClientCalendarSetupPayload(latestCalendarSetupEvent.payload)
    : emptyClientCalendarSetupState;
  const automationState = latestAutomationEvent
    ? parseClientAutomationPayload(latestAutomationEvent.payload)
    : emptyClientAutomationState;
  const calledNumber = calledNumberFromState({
    telnyxInboundNumber: company.telnyxInboundNumber,
    additionalNumbers: company.telnyxInboundNumbers,
    voicePhoneNumber: voiceState.phoneNumber
  });

  return {
    mcp: {
      serverName: `${company.name} voice mcp`,
      tools: ['check_availability', 'book_appointment', 'cancel_appointment']
    },
    company: {
      id: company.id,
      name: company.name,
      website: company.website,
      notificationEmail: company.notificationEmail,
      primaryContactName: company.primaryContactName,
      primaryContactEmail: company.primaryContactEmail,
      primaryContactPhone: company.primaryContactPhone
    },
    telnyx: {
      calledNumber,
      telnyxAssistantId: company.telnyxAssistantId,
      setup: voiceState
    },
    calendar: calendarState,
    automation: automationState,
    platforms: {
      primary: {
        name: calendarState.externalPlatformName,
        url: calendarState.externalPlatformUrl,
        id: calendarState.externalCalendarId
      },
      secondary: {
        name: calendarState.secondaryPlatformName,
        url: calendarState.secondaryPlatformUrl,
        id: calendarState.secondaryPlatformId
      }
    },
    endpoints: {
      availabilityWebhookUrl: voiceAvailabilityWebhookUrl(),
      bookingCreateUrl: internalBookingCreateUrl(),
      cancelWebhookUrl: voiceCancelWebhookUrl(),
      clientConfigUrl: automationConfigUrl(company.id),
      voiceAppointmentsWebhookUrl: voiceAppointmentsWebhookUrl()
    },
    auth: {
      headerName: 'x-api-key',
      internalApiKey: String(process.env.INTERNAL_API_KEY || '').trim() || null,
      voiceWebhookHeaderName: 'x-voice-webhook-secret',
      voiceWebhookSecret: configuredVoiceWebhookSecret()
    }
  };
}
