const EXPLICIT_TEST_WORKSPACE_NAMES = new Set([
  'demo',
  'fixyourleads',
  'fix your leads',
  'live webhook test clinic',
  'logogo',
  'sdasd',
  'stephen',
  'test',
  'testing'
]);

const EXPLICIT_TEST_PROSPECT_NAMES = new Set([
  'demo',
  'logogo',
  'sdasd',
  'stephen',
  'test',
  'testing'
]);

export function normalizeWorkspaceName(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isDemoWorkspaceName(value: string | null | undefined) {
  return normalizeWorkspaceName(value).startsWith('[demo]');
}

export function isLikelyTestWorkspaceName(value: string | null | undefined) {
  const normalized = normalizeWorkspaceName(value);

  if (!normalized) {
    return false;
  }

  if (isDemoWorkspaceName(normalized)) {
    return true;
  }

  if (EXPLICIT_TEST_WORKSPACE_NAMES.has(normalized)) {
    return true;
  }

  if (normalized.startsWith('test')) {
    return true;
  }

  if (/^(test+ing|test+\w*)$/.test(normalized.replace(/\s+/g, ''))) {
    return true;
  }

  return false;
}

export function isLikelyTestProspectName(value: string | null | undefined) {
  const normalized = normalizeWorkspaceName(value);

  if (!normalized) {
    return false;
  }

  if (isDemoWorkspaceName(normalized)) {
    return true;
  }

  if (EXPLICIT_TEST_PROSPECT_NAMES.has(normalized)) {
    return true;
  }

  return normalized.startsWith('test');
}
