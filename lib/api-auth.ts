import { NextRequest } from 'next/server';

export function requireApiKey(request: NextRequest) {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) {
    throw new Error('INTERNAL_API_KEY is not configured');
  }

  const provided = request.headers.get('x-api-key');
  if (!provided || provided !== expected) {
    return false;
  }

  return true;
}
