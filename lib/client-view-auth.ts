import { createHmac, timingSafeEqual } from 'node:crypto';

function clientViewSecret() {
  const configured =
    process.env.CLIENT_VIEW_SECRET?.trim() ||
    process.env.INTERNAL_API_KEY?.trim() ||
    null;

  return configured;
}

export function clientViewTokenForCompany(companyId: string) {
  const secret = clientViewSecret();

  if (!secret || !companyId.trim()) {
    return null;
  }

  return createHmac('sha256', secret).update(companyId).digest('hex');
}

export function buildClientViewPath(companyId: string) {
  const token = clientViewTokenForCompany(companyId);

  if (!token) {
    return null;
  }

  return `/c/${companyId}?token=${token}`;
}

export function isValidClientViewToken(companyId: string, token: string | null | undefined) {
  const expected = clientViewTokenForCompany(companyId);
  const provided = token?.trim() || null;

  if (!expected || !provided) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
