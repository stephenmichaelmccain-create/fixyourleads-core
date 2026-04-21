import { normalizePhone } from '@/lib/phone';

const TELNYX_API_URL = 'https://api.telnyx.com';
const TELNYX_HEALTH_TIMEOUT_MS = 2_000;

function hasConfiguredEnv(value: string | undefined) {
  return Boolean(value?.trim());
}

export async function checkTelnyxConnectivity(apiKey: string | undefined): Promise<{
  status: 'ok' | 'missing_config' | 'error';
  detail: string;
  statusCode?: number;
  requestId?: string | null;
}> {
  if (!hasConfiguredEnv(apiKey)) {
    return { status: 'missing_config', detail: 'TELNYX_API_KEY is missing' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, TELNYX_HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(`${TELNYX_API_URL}/v2/messages?limit=1`, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      signal: controller.signal
    });
    const statusCode = response.status;
    const requestId = response.headers.get('x-request-id') || response.headers.get('x-correlation-id');

    if (response.ok || (statusCode >= 200 && statusCode < 400)) {
      return {
        status: 'ok',
        detail: requestId
          ? `Telnyx API responsive (request ${requestId})`
          : 'Telnyx API responsive',
        statusCode,
        requestId
      };
    }

    return {
      status: 'error',
      detail: `Telnyx API responded with ${statusCode}: ${response.statusText || 'request failed'}`,
      statusCode,
      requestId
    };
  } catch (error) {
    const detail =
      error instanceof Error && error.name === 'AbortError'
        ? 'Telnyx API health request timed out'
        : `Telnyx API check failed: ${error instanceof Error ? error.message : 'unknown error'}`;

    return { status: 'error', detail };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendSms(to: string, text: string, fromOverride?: string | null) {
  const apiKey = process.env.TELNYX_API_KEY;
  const from = fromOverride || process.env.TELNYX_FROM_NUMBER;

  if (!apiKey || !from) throw new Error('Missing Telnyx configuration');

  const response = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: normalizePhone(from),
      to: normalizePhone(to),
      text
    })
  });

  if (!response.ok) {
    throw new Error(`Telnyx send failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}
