import { db } from '@/lib/db';
import { emptyClientAutomationState, parseClientAutomationPayload } from '@/lib/client-automation';
import { emptyTelnyxSetupState, parseTelnyxSetupPayload } from '@/lib/client-telnyx-setup';
import {
  addTelnyxAssistantTool,
  cloneTelnyxAssistant,
  createTelnyxAssistant,
  createTelnyxMcpServer,
  listTelnyxMcpServers,
  TelnyxMcpServer,
  TelnyxRequestError,
  telnyxProvisioningConfig,
  updateTelnyxAssistantName
} from '@/lib/telnyx-assistants';

type TelnyxProvisioningResult = {
  status: 'READY' | 'ACTION_REQUIRED' | 'FAILED';
  detail: string;
  assistantId: string | null;
  mcpServerId: string | null;
};

const MCP_ALLOWED_TOOLS = ['check_availability', 'book_appointment', 'cancel_appointment'];

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function assistantName(companyName: string) {
  return `${companyName} booking flow`;
}

function mcpServerName(companyName: string) {
  return `${companyName} voice mcp`;
}

function summarizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'telnyx_provisioning_failed';
}

function alreadyLinkedError(error: unknown) {
  if (!(error instanceof TelnyxRequestError)) {
    return false;
  }

  if (error.statusCode === 409) {
    return true;
  }

  const body = String(error.responseBody || '').toLowerCase();
  return body.includes('already') || body.includes('exists') || body.includes('duplicate');
}

function fallbackMcpTypes(preferredType: string) {
  return uniqueStrings([preferredType, 'http', 'remote']);
}

async function resolveMcpServer(input: {
  companyName: string;
  mcpUrl: string;
  preferredType: string;
}) {
  const existing = await listTelnyxMcpServers();
  const byUrl = existing.find((server) => server.url === input.mcpUrl);

  if (byUrl) {
    return byUrl;
  }

  let lastError: unknown = null;

  for (const type of fallbackMcpTypes(input.preferredType)) {
    try {
      const created = await createTelnyxMcpServer({
        name: mcpServerName(input.companyName),
        url: input.mcpUrl,
        allowedTools: MCP_ALLOWED_TOOLS,
        type
      });

      if (created) {
        return created;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('telnyx_mcp_server_create_failed');
}

async function resolveAssistant(input: {
  companyName: string;
  existingAssistantId: string | null;
  templateAssistantId: string | null;
  assistantModel: string | null;
  assistantInstructions: string | null;
}) {
  if (input.existingAssistantId) {
    return {
      assistantId: input.existingAssistantId,
      created: false
    };
  }

  const desiredName = assistantName(input.companyName);

  if (input.templateAssistantId) {
    const cloned = await cloneTelnyxAssistant(input.templateAssistantId);

    if (!cloned?.id) {
      throw new Error('telnyx_clone_assistant_missing_id');
    }

    try {
      await updateTelnyxAssistantName(cloned.id, desiredName);
    } catch {
      // Name update is nice-to-have; cloning success is enough to continue.
    }

    return {
      assistantId: cloned.id,
      created: true
    };
  }

  if (!input.assistantModel || !input.assistantInstructions) {
    throw new Error(
      'Set TELNYX_TEMPLATE_ASSISTANT_ID (recommended), or set TELNYX_ASSISTANT_MODEL and TELNYX_ASSISTANT_INSTRUCTIONS before auto-connect.'
    );
  }

  const created = await createTelnyxAssistant({
    name: desiredName,
    model: input.assistantModel,
    instructions: input.assistantInstructions
  });

  if (!created?.id) {
    throw new Error('telnyx_create_assistant_missing_id');
  }

  return {
    assistantId: created.id,
    created: true
  };
}

async function saveTelnyxSetupEvent(input: {
  companyId: string;
  mcpUrl: string | null;
  assistantId: string | null;
  assistantName: string | null;
  mcpServer: TelnyxMcpServer | null;
  notes: string;
}) {
  const latestSetupEvent = await db.eventLog.findFirst({
    where: { companyId: input.companyId, eventType: 'client_telnyx_setup_updated' },
    orderBy: { createdAt: 'desc' },
    select: { payload: true }
  });
  const existing = latestSetupEvent ? parseTelnyxSetupPayload(latestSetupEvent.payload) : emptyTelnyxSetupState;

  await db.eventLog.create({
    data: {
      companyId: input.companyId,
      eventType: 'client_telnyx_setup_updated',
      payload: {
        ...existing,
        automationUrl: input.mcpUrl || existing.automationUrl,
        webhookConfigured: Boolean(input.mcpUrl || existing.webhookUrl),
        notes: input.notes,
        assistantId: input.assistantId,
        assistantName: input.assistantName || existing.assistantName,
        mcpServerId: input.mcpServer?.id || null,
        mcpServerName: input.mcpServer?.name || null,
        mcpServerType: input.mcpServer?.type || null,
        mcpServerUrl: input.mcpServer?.url || input.mcpUrl || null,
        mcpAllowedTools: input.mcpServer?.allowedTools || MCP_ALLOWED_TOOLS,
        updatedAt: new Date().toISOString()
      }
    }
  });
}

export async function connectClientTelnyxAssistant(companyId: string): Promise<TelnyxProvisioningResult> {
  const [company, latestAutomationEvent] = await Promise.all([
    db.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        telnyxAssistantId: true
      }
    }),
    db.eventLog.findFirst({
      where: { companyId, eventType: 'client_automation_updated' },
      orderBy: { createdAt: 'desc' },
      select: { payload: true }
    })
  ]);

  if (!company) {
    throw new Error('company_not_found');
  }

  const automationState = latestAutomationEvent
    ? parseClientAutomationPayload(latestAutomationEvent.payload)
    : emptyClientAutomationState;
  const mcpUrl = automationState.workflowMcpUrl;

  if (!mcpUrl || automationState.triggerType !== 'mcp' || !automationState.workflowActive) {
    const detail = 'Launch and activate the client n8n MCP workflow first, then run auto-connect.';
    await saveTelnyxSetupEvent({
      companyId,
      mcpUrl: null,
      assistantId: company.telnyxAssistantId,
      assistantName: null,
      mcpServer: null,
      notes: detail
    });
    return {
      status: 'ACTION_REQUIRED',
      detail,
      assistantId: company.telnyxAssistantId,
      mcpServerId: null
    };
  }

  const config = telnyxProvisioningConfig();

  if (!config.isConfigured) {
    const detail = `Missing ${config.missing.join(', ')} before Telnyx auto-connect can run.`;
    await saveTelnyxSetupEvent({
      companyId,
      mcpUrl,
      assistantId: company.telnyxAssistantId,
      assistantName: null,
      mcpServer: null,
      notes: detail
    });
    return {
      status: 'ACTION_REQUIRED',
      detail,
      assistantId: company.telnyxAssistantId,
      mcpServerId: null
    };
  }

  try {
    const mcpServer = await resolveMcpServer({
      companyName: company.name,
      mcpUrl,
      preferredType: config.mcpServerType
    });

    if (!mcpServer?.id) {
      throw new Error('telnyx_mcp_server_missing_id');
    }

    const assistant = await resolveAssistant({
      companyName: company.name,
      existingAssistantId: company.telnyxAssistantId,
      templateAssistantId: config.templateAssistantId,
      assistantModel: config.assistantModel,
      assistantInstructions: config.assistantInstructions
    });

    try {
      await addTelnyxAssistantTool(assistant.assistantId, mcpServer.id);
    } catch (error) {
      if (!alreadyLinkedError(error)) {
        throw error;
      }
    }

    await db.company.update({
      where: { id: company.id },
      data: {
        telnyxAssistantId: assistant.assistantId
      }
    });

    const detail = 'Telnyx assistant is connected to this client workflow MCP server.';

    await saveTelnyxSetupEvent({
      companyId,
      mcpUrl,
      assistantId: assistant.assistantId,
      assistantName: assistantName(company.name),
      mcpServer,
      notes: detail
    });

    return {
      status: 'READY',
      detail,
      assistantId: assistant.assistantId,
      mcpServerId: mcpServer.id
    };
  } catch (error) {
    const detail = summarizeError(error);
    const actionRequired =
      detail.includes('TELNYX_TEMPLATE_ASSISTANT_ID') ||
      detail.includes('telnyx_api_key_missing');

    await saveTelnyxSetupEvent({
      companyId,
      mcpUrl,
      assistantId: company.telnyxAssistantId,
      assistantName: null,
      mcpServer: null,
      notes: actionRequired ? `Auto-connect blocked: ${detail}` : `Auto-connect failed: ${detail}`
    });

    return {
      status: actionRequired ? 'ACTION_REQUIRED' : 'FAILED',
      detail,
      assistantId: company.telnyxAssistantId,
      mcpServerId: null
    };
  }
}
