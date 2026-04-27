import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { automationClientConfig } from '@/services/automation';

function hasAutomationSecret(request: NextRequest) {
  const expected = String(process.env.AUTOMATION_SHARED_SECRET || '').trim();

  if (!expected) {
    return false;
  }

  const provided =
    request.headers.get('x-automation-secret') ||
    request.headers.get('x-webhook-secret') ||
    request.nextUrl.searchParams.get('secret');

  return String(provided || '').trim() === expected;
}

function hasInternalApiKey(request: NextRequest) {
  try {
    return requireApiKey(request);
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  if (!hasAutomationSecret(request) && !hasInternalApiKey(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const companyId = String(request.nextUrl.searchParams.get('companyId') || '').trim();

  if (!companyId) {
    return NextResponse.json({ error: 'companyId_required' }, { status: 400 });
  }

  const config = await automationClientConfig(companyId);

  if (!config) {
    return NextResponse.json({ error: 'company_not_found' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    config
  });
}
