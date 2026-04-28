type TelnyxRequestOptions = RequestInit & {
  searchParams?: URLSearchParams | Record<string, string | number | boolean | null | undefined>;
};

const TELNYX_API_BASE_URL = 'https://api.telnyx.com/v2';

type TelnyxConfig = {
  apiKey: string | null;
  templateAssistantId: string | null;
  assistantModel: string | null;
  assistantInstructions: string | null;
  mcpServerType: string;
};

export type TelnyxMcpServer = {
  id: string;
  name: string | null;
  type: string | null;
  url: string | null;
  allowedTools: string[];
};

export type TelnyxAssistant = {
  id: string;
  name: string | null;
};

export class TelnyxRequestError extends Error {
  statusCode: number;
  responseBody: string;

  constructor(message: string, statusCode: number, responseBody: string) {
    super(message);
    this.name = 'TelnyxRequestError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

function trimText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function payloadRecord(payload: unknown) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

function payloadText(payload: unknown, key: string) {
  const value = payloadRecord(payload)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function payloadStringArray(payload: unknown, key: string) {
  const value = payloadRecord(payload)[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

function unwrapData(payload: unknown) {
  const record = payloadRecord(payload);
  const data = record.data;

  if (data === undefined) {
    return payload;
  }

  return data;
}

function getConfig(): TelnyxConfig {
  const apiKey = trimText(process.env.TELNYX_API_KEY) || null;
  const templateAssistantId = trimText(process.env.TELNYX_TEMPLATE_ASSISTANT_ID) || null;
  const assistantModel = trimText(process.env.TELNYX_ASSISTANT_MODEL) || null;
  const assistantInstructions = trimText(process.env.TELNYX_ASSISTANT_INSTRUCTIONS) || null;
  const mcpServerType = trimText(process.env.TELNYX_MCP_SERVER_TYPE) || 'http';

  return {
    apiKey,
    templateAssistantId,
    assistantModel,
    assistantInstructions,
    mcpServerType
  };
}

function appendSearchParams(url: URL, searchParams?: TelnyxRequestOptions['searchParams']) {
  if (!searchParams) {
    return;
  }

  if (searchParams instanceof URLSearchParams) {
    for (const [key, value] of searchParams.entries()) {
      url.searchParams.set(key, value);
    }
    return;
  }

  for (const [key, value] of Object.entries(searchParams)) {
    if (value === null || value === undefined || value === '') {
      continue;
    }

    url.searchParams.set(key, String(value));
  }
}

function detailFromBody(body: string) {
  if (!body) {
    return 'empty_response';
  }

  try {
    const parsed = JSON.parse(body);
    const parsedRecord = payloadRecord(parsed);

    if (typeof parsedRecord.message === 'string' && parsedRecord.message.trim()) {
      return parsedRecord.message.trim();
    }

    if (typeof parsedRecord.error === 'string' && parsedRecord.error.trim()) {
      return parsedRecord.error.trim();
    }

    if (Array.isArray(parsedRecord.detail) && parsedRecord.detail.length > 0) {
      const first = parsedRecord.detail[0];
      if (first && typeof first === 'object' && !Array.isArray(first)) {
        const msg = payloadText(first, 'msg');
        if (msg) {
          return msg;
        }
      }
    }
  } catch {
    return body;
  }

  return body;
}

async function telnyxRequest<T>(path: string, options: TelnyxRequestOptions = {}): Promise<T> {
  const config = getConfig();

  if (!config.apiKey) {
    throw new Error('telnyx_api_key_missing');
  }

  const { searchParams, headers, ...init } = options;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${TELNYX_API_BASE_URL}${normalizedPath}`);
  appendSearchParams(url, searchParams);

  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...headers
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    const body = await response.text();
    const detail = detailFromBody(body);
    throw new TelnyxRequestError(`telnyx_request_failed:${response.status}:${detail}`, response.status, body || detail);
  }

  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }

  return (await response.text()) as T;
}

function parseMcpServer(payload: unknown): TelnyxMcpServer | null {
  const record = payloadRecord(payload);
  const id = payloadText(record, 'id');

  if (!id) {
    return null;
  }

  return {
    id,
    name: payloadText(record, 'name'),
    type: payloadText(record, 'type'),
    url: payloadText(record, 'url'),
    allowedTools: payloadStringArray(record, 'allowed_tools')
  };
}

function parseAssistant(payload: unknown): TelnyxAssistant | null {
  const record = payloadRecord(payload);
  const id = payloadText(record, 'id');

  if (!id) {
    return null;
  }

  return {
    id,
    name: payloadText(record, 'name')
  };
}

function listPayloadArray(payload: unknown) {
  const unwrapped = unwrapData(payload);

  if (Array.isArray(unwrapped)) {
    return unwrapped;
  }

  const record = payloadRecord(unwrapped);
  if (Array.isArray(record.items)) {
    return record.items;
  }

  return [];
}

export function telnyxProvisioningConfig() {
  const config = getConfig();

  const missing: string[] = [];

  if (!config.apiKey) {
    missing.push('TELNYX_API_KEY');
  }

  return {
    ...config,
    isConfigured: missing.length === 0,
    missing
  };
}

export async function listTelnyxMcpServers() {
  const response = await telnyxRequest<unknown>('/ai/mcp_servers');
  return listPayloadArray(response).map((item) => parseMcpServer(item)).filter((item): item is TelnyxMcpServer => Boolean(item));
}

export async function createTelnyxMcpServer(input: {
  name: string;
  url: string;
  allowedTools: string[];
  type?: string | null;
}) {
  const config = getConfig();
  const body = {
    name: input.name,
    url: input.url,
    type: trimText(input.type) || config.mcpServerType || 'http',
    allowed_tools: input.allowedTools
  };
  const response = await telnyxRequest<unknown>('/ai/mcp_servers', {
    method: 'POST',
    body: JSON.stringify(body)
  });
  return parseMcpServer(unwrapData(response));
}

export async function addTelnyxAssistantTool(assistantId: string, toolId: string) {
  await telnyxRequest<unknown>(`/ai/assistants/${assistantId}/tools/${toolId}`, {
    method: 'PUT'
  });
}

export async function cloneTelnyxAssistant(assistantId: string) {
  const response = await telnyxRequest<unknown>(`/ai/assistants/${assistantId}/clone`, {
    method: 'POST'
  });
  return parseAssistant(unwrapData(response));
}

export async function createTelnyxAssistant(input: {
  name: string;
  model: string;
  instructions: string;
}) {
  const response = await telnyxRequest<unknown>('/ai/assistants', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      model: input.model,
      instructions: input.instructions
    })
  });
  return parseAssistant(unwrapData(response));
}

export async function updateTelnyxAssistantName(assistantId: string, name: string) {
  const response = await telnyxRequest<unknown>(`/ai/assistants/${assistantId}`, {
    method: 'POST',
    body: JSON.stringify({ name })
  });
  return parseAssistant(unwrapData(response));
}
