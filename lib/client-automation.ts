type AutomationPayload = Record<string, unknown>;

export type ClientAutomationStatus = 'NOT_CONFIGURED' | 'PENDING' | 'READY' | 'ACTION_REQUIRED' | 'FAILED';

export type ClientAutomationState = {
  provider: 'n8n' | null;
  status: ClientAutomationStatus;
  workflowId: string | null;
  workflowName: string | null;
  workflowEditorUrl: string | null;
  workflowWebhookPath: string | null;
  workflowWebhookUrl: string | null;
  templateWorkflowId: string | null;
  configUrl: string | null;
  bookingCreateUrl: string | null;
  workflowActive: boolean;
  lastError: string | null;
  source: string | null;
  notes: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  updatedAt: string | null;
};

const STATUSES: ClientAutomationStatus[] = ['NOT_CONFIGURED', 'PENDING', 'READY', 'ACTION_REQUIRED', 'FAILED'];

export const emptyClientAutomationState: ClientAutomationState = {
  provider: null,
  status: 'NOT_CONFIGURED',
  workflowId: null,
  workflowName: null,
  workflowEditorUrl: null,
  workflowWebhookPath: null,
  workflowWebhookUrl: null,
  templateWorkflowId: null,
  configUrl: null,
  bookingCreateUrl: null,
  workflowActive: false,
  lastError: null,
  source: null,
  notes: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  updatedAt: null
};

function payloadText(payload: AutomationPayload, key: keyof ClientAutomationState) {
  const value = payload[key];

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

export function parseClientAutomationPayload(payload: unknown): ClientAutomationState {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return emptyClientAutomationState;
  }

  const record = payload as AutomationPayload;
  const provider = payloadText(record, 'provider');
  const status = payloadText(record, 'status');

  return {
    provider: provider === 'n8n' ? 'n8n' : null,
    status: STATUSES.includes(status as ClientAutomationStatus) ? (status as ClientAutomationStatus) : 'NOT_CONFIGURED',
    workflowId: payloadText(record, 'workflowId'),
    workflowName: payloadText(record, 'workflowName'),
    workflowEditorUrl: payloadText(record, 'workflowEditorUrl'),
    workflowWebhookPath: payloadText(record, 'workflowWebhookPath'),
    workflowWebhookUrl: payloadText(record, 'workflowWebhookUrl'),
    templateWorkflowId: payloadText(record, 'templateWorkflowId'),
    configUrl: payloadText(record, 'configUrl'),
    bookingCreateUrl: payloadText(record, 'bookingCreateUrl'),
    workflowActive: record.workflowActive === true,
    lastError: payloadText(record, 'lastError'),
    source: payloadText(record, 'source'),
    notes: payloadText(record, 'notes'),
    lastAttemptAt: payloadText(record, 'lastAttemptAt'),
    lastSuccessAt: payloadText(record, 'lastSuccessAt'),
    updatedAt: payloadText(record, 'updatedAt')
  };
}
