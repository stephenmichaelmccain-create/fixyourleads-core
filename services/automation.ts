import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { emptyClientAutomationState, parseClientAutomationPayload } from '@/lib/client-automation';
import { emptyClientCalendarSetupState, parseClientCalendarSetupPayload } from '@/lib/client-calendar-setup';
import { emptyTelnyxSetupState, parseTelnyxSetupPayload } from '@/lib/client-telnyx-setup';
import {
  activateN8nWorkflow,
  deleteN8nWorkflow,
  N8nRequestError,
  buildN8nEditorUrl,
  cloneN8nTemplateWorkflow,
  extractN8nWorkflowAccess,
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

function readinessFromWorkflow(input: {
  active: boolean;
  triggerType: 'mcp' | 'webhook' | null;
  activationError?: string | null;
}) {
  if (!input.active) {
    return {
      status: 'ACTION_REQUIRED' as const,
      detail:
        input.activationError || 'Workflow exists but is not active yet in n8n. Activate it and retry from Connections.',
      lastError: input.activationError || 'n8n_workflow_inactive'
    };
  }

  if (input.triggerType !== 'mcp') {
    return {
      status: 'ACTION_REQUIRED' as const,
      detail:
        'Workflow is active, but it is not MCP-based yet. Switch the template to an MCP Server Trigger workflow and launch again.',
      lastError: 'n8n_workflow_not_mcp'
    };
  }

  return {
    status: 'READY' as const,
    detail: 'Shared n8n MCP workflow provisioned and activated.',
    lastError: null
  };
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
  triggerType?: 'mcp' | 'webhook' | null;
  workflowId?: string | null;
  workflowName?: string | null;
  workflowEditorUrl?: string | null;
  workflowMcpPath?: string | null;
  workflowMcpUrl?: string | null;
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
    triggerType: input.triggerType ?? input.previous.triggerType,
    workflowId: input.workflowId ?? input.previous.workflowId,
    workflowName: input.workflowName ?? input.previous.workflowName,
    workflowEditorUrl: input.workflowEditorUrl ?? input.previous.workflowEditorUrl,
    workflowMcpPath: input.workflowMcpPath ?? input.previous.workflowMcpPath,
    workflowMcpUrl: input.workflowMcpUrl ?? input.previous.workflowMcpUrl,
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
  const provisioningReadiness = n8nProvisioningConfig();

  await recordAutomationState({
    companyId,
    eventType: 'client_automation_updated',
    payload: mergedAutomationPayload({
      previous: previousState,
      source,
      status: 'PENDING',
      templateWorkflowId: provisioningReadiness.templateWorkflowId,
      configUrl,
      bookingCreateUrl,
      notes: 'Provisioning shared n8n client workflow.'
    })
  });

  if (!provisioningReadiness.isConfigured) {
    const detail = `Missing ${provisioningReadiness.missing.join(', ')} before n8n provisioning can run.`;

    await recordAutomationState({
      companyId,
      eventType: 'client_automation_updated',
      payload: mergedAutomationPayload({
        previous: previousState,
        source,
        status: 'ACTION_REQUIRED',
        templateWorkflowId: provisioningReadiness.templateWorkflowId,
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
        const access = extractN8nWorkflowAccess(existingWorkflow);
        let active = existingWorkflow.active === true;
        let activationError: string | null = null;

        if (!active) {
          try {
            existingWorkflow = await activateN8nWorkflow(previousState.workflowId);
            active = existingWorkflow.active === true;
          } catch (error) {
            activationError = summarizeError(error);
          }
        }

        const workflowReadiness = readinessFromWorkflow({
          active,
          triggerType: access.triggerType,
          activationError
        });

        await recordAutomationState({
          companyId,
          eventType: 'client_automation_updated',
          payload: mergedAutomationPayload({
            previous: previousState,
            source,
            status: workflowReadiness.status,
            triggerType: access.triggerType,
            workflowId: previousState.workflowId,
            workflowName: existingWorkflow.name || previousState.workflowName || defaultWorkflowName(company.name),
            workflowEditorUrl: buildN8nEditorUrl(previousState.workflowId),
            workflowMcpPath: access.triggerType === 'mcp' ? access.path : null,
            workflowMcpUrl: access.triggerType === 'mcp' ? access.url : null,
            workflowWebhookPath: access.triggerType === 'webhook' ? access.path : null,
            workflowWebhookUrl: access.triggerType === 'webhook' ? access.url : null,
            workflowActive: active,
            templateWorkflowId: provisioningReadiness.templateWorkflowId,
            configUrl,
            bookingCreateUrl,
            lastError: workflowReadiness.lastError,
            notes: workflowReadiness.detail
          })
        });

        return {
          status: workflowReadiness.status,
          detail: workflowReadiness.detail,
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
      __FYL_AUTOMATION_SECRET__: provisioningReadiness.automationSharedSecret || '',
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

    const workflowReadiness = readinessFromWorkflow({
      active: !created.activationError,
      triggerType: created.triggerType,
      activationError: created.activationError
    });

    const currentState = await latestAutomationState(companyId);

    await recordAutomationState({
      companyId,
      eventType: 'client_automation_updated',
      payload: mergedAutomationPayload({
        previous: currentState,
        source,
        status: workflowReadiness.status,
        triggerType: created.triggerType,
        workflowId: created.workflowId,
        workflowName: created.workflow.name || defaultWorkflowName(company.name),
        workflowEditorUrl: created.editorUrl,
        workflowMcpPath: created.mcpPath,
        workflowMcpUrl: created.mcpUrl,
        workflowWebhookPath: created.webhookPath,
        workflowWebhookUrl: created.webhookUrl,
        workflowActive: !created.activationError,
        templateWorkflowId: provisioningReadiness.templateWorkflowId,
        configUrl,
        bookingCreateUrl,
        lastError: workflowReadiness.lastError,
        notes: workflowReadiness.detail
      })
    });

    return {
      status: workflowReadiness.status,
      detail: workflowReadiness.detail,
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
        templateWorkflowId: provisioningReadiness.templateWorkflowId,
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

export async function resetClientAutomation(companyId: string) {
  const previousState = await latestAutomationState(companyId);

  if (previousState.workflowId) {
    try {
      await deleteN8nWorkflow(previousState.workflowId);
    } catch (error) {
      if (!(error instanceof N8nRequestError) || error.statusCode !== 404) {
        throw error;
      }
    }
  }

  await recordAutomationState({
    companyId,
    eventType: 'client_automation_updated',
    payload: {
      ...emptyClientAutomationState,
      provider: 'n8n',
      templateWorkflowId: previousState.templateWorkflowId,
      configUrl: previousState.configUrl,
      bookingCreateUrl: previousState.bookingCreateUrl,
      source: 'manual_retry',
      notes: previousState.workflowId ? 'Client workflow reset and deleted from n8n.' : 'Client automation state reset.',
      lastAttemptAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  });
}
