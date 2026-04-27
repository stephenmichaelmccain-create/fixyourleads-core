type N8nRequestOptions = RequestInit & {
  searchParams?: URLSearchParams | Record<string, string | number | boolean | null | undefined>;
};

type N8nWorkflowNode = {
  id?: string;
  name?: string;
  type?: string;
  webhookId?: string;
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
};

export type N8nWorkflow = {
  id?: string;
  name: string;
  active?: boolean;
  nodes: N8nWorkflowNode[];
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
  staticData?: Record<string, unknown> | null;
  pinData?: Record<string, unknown>;
  tags?: Array<{ id?: string; name?: string }>;
  [key: string]: unknown;
};

type N8nConfig = {
  apiBases: string[];
  baseUrl: string | null;
  editorBaseUrl: string | null;
  webhookBaseUrl: string | null;
  apiKey: string | null;
  templateWorkflowId: string | null;
  automationSharedSecret: string | null;
};

type ConnectivityCheck = {
  status: 'ok' | 'missing_config' | 'error';
  detail: string;
  statusCode?: number;
};

export class N8nRequestError extends Error {
  statusCode: number;
  responseBody: string;

  constructor(message: string, statusCode: number, responseBody: string) {
    super(message);
    this.name = 'N8nRequestError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

function trimTrailingSlash(value: string | null | undefined) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function readConfiguredBaseUrl() {
  return trimTrailingSlash(process.env.N8N_BASE_URL) || null;
}

function readConfiguredEditorBaseUrl() {
  return trimTrailingSlash(process.env.N8N_EDITOR_BASE_URL) || readConfiguredBaseUrl();
}

function readConfiguredWebhookBaseUrl() {
  return trimTrailingSlash(process.env.N8N_WEBHOOK_BASE_URL) || readConfiguredBaseUrl();
}

function apiBases(baseUrl: string | null) {
  const explicit = trimTrailingSlash(process.env.N8N_API_BASE_URL);

  if (explicit) {
    return [explicit];
  }

  if (!baseUrl) {
    return [];
  }

  if (/\/(api\/v\d+|rest)$/i.test(baseUrl)) {
    return [baseUrl];
  }

  return [`${baseUrl}/api/v1`, `${baseUrl}/rest`];
}

function getConfig(): N8nConfig {
  const baseUrl = readConfiguredBaseUrl();

  return {
    apiBases: apiBases(baseUrl),
    baseUrl,
    editorBaseUrl: readConfiguredEditorBaseUrl(),
    webhookBaseUrl: readConfiguredWebhookBaseUrl(),
    apiKey: String(process.env.N8N_API_KEY || '').trim() || null,
    templateWorkflowId: String(process.env.N8N_TEMPLATE_BOOKING_WORKFLOW_ID || '').trim() || null,
    automationSharedSecret: String(process.env.AUTOMATION_SHARED_SECRET || '').trim() || null
  };
}

function appendSearchParams(url: URL, searchParams?: N8nRequestOptions['searchParams']) {
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

async function readBody(response: Response) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
}

async function n8nRequest<T>(path: string, options: N8nRequestOptions = {}): Promise<T> {
  const config = getConfig();

  if (!config.apiKey) {
    throw new Error('n8n_api_key_missing');
  }

  if (config.apiBases.length === 0) {
    throw new Error('n8n_base_url_missing');
  }

  const { searchParams, headers, ...init } = options;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  let lastError: unknown = null;

  for (const apiBase of config.apiBases) {
    const url = new URL(`${apiBase}${normalizedPath}`);
    appendSearchParams(url, searchParams);

    const response = await fetch(url, {
      ...init,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'X-N8N-API-KEY': config.apiKey,
        ...headers
      },
      cache: 'no-store'
    });

    if (response.ok) {
      return (await readBody(response)) as T;
    }

    const body = await response.text();
    const error = new N8nRequestError(
      `n8n_request_failed:${response.status}`,
      response.status,
      body || response.statusText || 'empty_response'
    );

    if (response.status === 404 && apiBase !== config.apiBases[config.apiBases.length - 1]) {
      lastError = error;
      continue;
    }

    throw error;
  }

  throw lastError instanceof Error ? lastError : new Error('n8n_request_failed');
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function deepReplacePlaceholders(value: unknown, replacements: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return Object.entries(replacements).reduce((text, [token, replacement]) => text.split(token).join(replacement), value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepReplacePlaceholders(item, replacements));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, deepReplacePlaceholders(nested, replacements)])
    );
  }

  return value;
}

function sanitizeWorkflow(template: N8nWorkflow, workflowName: string, replacements: Record<string, string>, webhookPath: string) {
  const clone = structuredClone({
    name: workflowName,
    nodes: Array.isArray(template.nodes) ? template.nodes : [],
    connections: template.connections && typeof template.connections === 'object' ? template.connections : {},
    settings: template.settings && typeof template.settings === 'object' ? template.settings : {},
    staticData: template.staticData ?? null,
    pinData: template.pinData && typeof template.pinData === 'object' ? template.pinData : undefined
  }) as N8nWorkflow;

  clone.nodes = clone.nodes.map((node) => {
    const nextNode = structuredClone(node);
    delete nextNode.id;
    delete nextNode.webhookId;

    if (nextNode.parameters && typeof nextNode.parameters === 'object') {
      nextNode.parameters = deepReplacePlaceholders(nextNode.parameters, replacements) as Record<string, unknown>;

      if (
        typeof nextNode.type === 'string' &&
        nextNode.type.toLowerCase().includes('webhook') &&
        typeof nextNode.parameters.path === 'string'
      ) {
        nextNode.parameters.path = webhookPath;
      }
    }

    return deepReplacePlaceholders(nextNode, replacements) as N8nWorkflowNode;
  });

  clone.connections = deepReplacePlaceholders(clone.connections, replacements) as Record<string, unknown>;
  clone.settings = deepReplacePlaceholders(clone.settings, replacements) as Record<string, unknown>;
  clone.staticData = deepReplacePlaceholders(clone.staticData, replacements) as Record<string, unknown> | null;
  clone.pinData = deepReplacePlaceholders(clone.pinData, replacements) as Record<string, unknown> | undefined;

  return clone;
}

export function n8nProvisioningConfig() {
  const config = getConfig();

  return {
    baseUrl: config.baseUrl,
    editorBaseUrl: config.editorBaseUrl,
    webhookBaseUrl: config.webhookBaseUrl,
    templateWorkflowId: config.templateWorkflowId,
    automationSharedSecret: config.automationSharedSecret,
    isConfigured: Boolean(config.baseUrl && config.apiKey && config.templateWorkflowId && config.automationSharedSecret),
    missing: [
      config.baseUrl ? null : 'N8N_BASE_URL',
      config.apiKey ? null : 'N8N_API_KEY',
      config.templateWorkflowId ? null : 'N8N_TEMPLATE_BOOKING_WORKFLOW_ID',
      config.automationSharedSecret ? null : 'AUTOMATION_SHARED_SECRET'
    ].filter(Boolean) as string[]
  };
}

export function buildN8nEditorUrl(workflowId: string | null) {
  const editorBaseUrl = readConfiguredEditorBaseUrl();

  if (!editorBaseUrl || !workflowId) {
    return null;
  }

  return `${editorBaseUrl}/workflow/${workflowId}`;
}

export function buildN8nWebhookPath(companyName: string, companyId: string) {
  const namePart = slugify(companyName) || 'client';
  return `fyl-${namePart}-${companyId.slice(-8)}`;
}

export function buildN8nWebhookUrl(webhookPath: string | null) {
  const webhookBaseUrl = readConfiguredWebhookBaseUrl();

  if (!webhookBaseUrl || !webhookPath) {
    return null;
  }

  return `${webhookBaseUrl}/webhook/${webhookPath}`;
}

export async function getN8nWorkflow(workflowId: string) {
  return n8nRequest<N8nWorkflow>(`/workflows/${workflowId}`);
}

export async function createN8nWorkflow(workflow: N8nWorkflow) {
  return n8nRequest<N8nWorkflow>('/workflows', {
    method: 'POST',
    body: JSON.stringify(workflow)
  });
}

export async function updateN8nWorkflow(workflowId: string, payload: Partial<N8nWorkflow> & Record<string, unknown>) {
  return n8nRequest<N8nWorkflow>(`/workflows/${workflowId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });
}

export async function cloneN8nTemplateWorkflow(input: {
  companyId: string;
  companyName: string;
  workflowName: string;
  replacements: Record<string, string>;
}) {
  const config = getConfig();

  if (!config.templateWorkflowId) {
    throw new Error('n8n_template_workflow_missing');
  }

  const template = await getN8nWorkflow(config.templateWorkflowId);
  const webhookPath = buildN8nWebhookPath(input.companyName, input.companyId);
  const workflow = sanitizeWorkflow(template, input.workflowName, input.replacements, webhookPath);
  const created = await createN8nWorkflow(workflow);
  const workflowId = String(created.id || '');

  if (!workflowId) {
    throw new Error('n8n_workflow_id_missing');
  }

  let activatedWorkflow = created;
  let activationError: string | null = null;

  try {
    activatedWorkflow = await updateN8nWorkflow(workflowId, { active: true });
  } catch (error) {
    activationError = error instanceof Error ? error.message : 'n8n_activation_failed';
  }

  return {
    workflow: activatedWorkflow,
    workflowId,
    webhookPath,
    webhookUrl: buildN8nWebhookUrl(webhookPath),
    editorUrl: buildN8nEditorUrl(workflowId),
    activationError
  };
}

export async function checkN8nConnectivity(): Promise<ConnectivityCheck> {
  const readiness = n8nProvisioningConfig();

  if (!readiness.baseUrl || !readiness.isConfigured) {
    return {
      status: 'missing_config',
      detail:
        readiness.missing.length > 0
          ? `Missing ${readiness.missing.join(', ')}`
          : 'n8n base URL or API key is missing'
    };
  }

  try {
    await n8nRequest<unknown>('/workflows', {
      searchParams: { limit: 1 }
    });

    return {
      status: 'ok',
      detail: `Connected to ${readiness.baseUrl}`
    };
  } catch (error) {
    if (error instanceof N8nRequestError) {
      return {
        status: 'error',
        detail: error.responseBody || error.message,
        statusCode: error.statusCode
      };
    }

    return {
      status: 'error',
      detail: error instanceof Error ? error.message : 'n8n_connectivity_failed'
    };
  }
}
