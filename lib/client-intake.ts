type IntakeStage = 'waiting_signup' | 'workspace_created' | 'setup_pending' | 'ready';

export function normalizeClinicKey(value: string | null | undefined) {
  return String(value || '')
    .replace(/^\[demo\]\s*/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

export function intakeStageDetails(options: {
  hasWorkspace: boolean;
  hasRouting: boolean;
  hasNotificationEmail: boolean;
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
