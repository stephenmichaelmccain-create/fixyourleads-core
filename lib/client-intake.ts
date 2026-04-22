const PROSPECT_META_PREFIX = 'fyl:';

type IntakeStage = 'waiting_signup' | 'workspace_created' | 'setup_pending' | 'ready';

export function normalizeClinicKey(value: string | null | undefined) {
  return String(value || '')
    .replace(/^\[demo\]\s*/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

export function normalizeWebsiteKey(value: string | null | undefined) {
  const raw = String(value || '').trim().toLowerCase();

  if (!raw) {
    return '';
  }

  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, '').trim();
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]?.trim() || '';
  }
}

export function parseProspectMetadata(notes?: string | null) {
  const meta: Record<string, string> = {};

  for (const line of String(notes || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(PROSPECT_META_PREFIX)) {
      continue;
    }

    const [key, ...parts] = trimmed.slice(PROSPECT_META_PREFIX.length).split('=');
    const value = parts.join('=').trim();
    if (key && value) {
      meta[key.trim()] = value;
    }
  }

  return meta;
}

export function upsertProspectMetadata(
  notes: string | null | undefined,
  updates: Record<string, string | null | undefined>
) {
  const meta = parseProspectMetadata(notes);

  for (const [key, value] of Object.entries(updates)) {
    if (!key) {
      continue;
    }

    if (value == null || value === '') {
      delete meta[key];
      continue;
    }

    meta[key] = value;
  }

  const bodyLines = String(notes || '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() && !line.trim().startsWith(PROSPECT_META_PREFIX));

  const metaLines = Object.entries(meta)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${PROSPECT_META_PREFIX}${key}=${value}`);

  return [...bodyLines, ...metaLines].join('\n');
}

export function intakeStageDetails(options: {
  hasWorkspace: boolean;
  hasRouting: boolean;
  hasNotificationEmail: boolean;
  hasSignupReceived?: boolean;
}): {
  stage: IntakeStage;
  label: string;
  tone: 'ok' | 'warn' | 'error' | 'muted';
  detail: string;
} {
  if (!options.hasWorkspace) {
    return {
      stage: 'waiting_signup',
      label: 'Waiting for signup',
      tone: 'warn',
      detail: 'The clinic was sold, but no client workspace has been created yet.'
    };
  }

  if (options.hasSignupReceived && (!options.hasRouting || !options.hasNotificationEmail)) {
    return {
      stage: 'workspace_created',
      label: 'Signup received',
      tone: 'warn',
      detail: 'Website signup landed. Finish routing and notification setup so the client can go live.'
    };
  }

  if (!options.hasRouting || !options.hasNotificationEmail) {
    return {
      stage: 'setup_pending',
      label: 'Setup pending',
      tone: 'error',
      detail: 'A client workspace exists, but routing or notification email is still missing.'
    };
  }

  return {
    stage: 'ready',
    label: 'Ready for onboarding',
    tone: 'ok',
    detail: 'The sold clinic already has a client workspace with the main setup pieces in place.'
  };
}
