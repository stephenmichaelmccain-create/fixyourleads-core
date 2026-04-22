import { NextRequest } from 'next/server';

function extractBearerToken(value: string | null) {
  const raw = String(value || '').trim();

  if (!raw.toLowerCase().startsWith('bearer ')) {
    return null;
  }

  return raw.slice(7).trim() || null;
}

export function resolveProvidedApiKey(request: NextRequest) {
  return (
    request.headers.get('x-api-key') ||
    extractBearerToken(request.headers.get('authorization')) ||
    request.nextUrl.searchParams.get('apiKey') ||
    request.nextUrl.searchParams.get('api_key') ||
    request.nextUrl.searchParams.get('token')
  );
}

export function requireApiKey(request: NextRequest) {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) {
    throw new Error('INTERNAL_API_KEY is not configured');
  }

  const provided = resolveProvidedApiKey(request);
  if (!provided || provided !== expected) {
    return false;
  }

  return true;
}
