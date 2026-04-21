import { normalizePhone } from '@/lib/phone';

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
