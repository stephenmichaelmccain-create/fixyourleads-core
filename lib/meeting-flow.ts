export type MeetingFlowStageKey =
  | 'demo_booked'
  | 'setup_call'
  | 'onboarding_signup'
  | 'checkin_3day'
  | 'review_2week';

type MeetingFlowStageDefinition = {
  key: MeetingFlowStageKey;
  label: string;
  defaultPurpose: string;
  nextKey: MeetingFlowStageKey | null;
  nextOffsetDays: number | null;
};

const FLOW_STAGE_PREFIX = '[flow_stage:';

export const MEETING_FLOW_STAGES: MeetingFlowStageDefinition[] = [
  {
    key: 'demo_booked',
    label: 'Demo Booked',
    defaultPurpose: 'Demo Booked',
    nextKey: 'setup_call',
    nextOffsetDays: 1
  },
  {
    key: 'setup_call',
    label: 'Setup Call',
    defaultPurpose: 'Setup Call',
    nextKey: 'onboarding_signup',
    nextOffsetDays: 1
  },
  {
    key: 'onboarding_signup',
    label: 'Onboarding Signup',
    defaultPurpose: 'Onboarding Signup',
    nextKey: 'checkin_3day',
    nextOffsetDays: 3
  },
  {
    key: 'checkin_3day',
    label: '3-5 Day Check-In',
    defaultPurpose: '3-5 Day Check-In',
    nextKey: 'review_2week',
    nextOffsetDays: 14
  },
  {
    key: 'review_2week',
    label: '2-Week Review',
    defaultPurpose: '2-Week Review',
    nextKey: null,
    nextOffsetDays: null
  }
];

const MEETING_FLOW_STAGE_KEY_SET = new Set<MeetingFlowStageKey>(MEETING_FLOW_STAGES.map((stage) => stage.key));

function asStageKey(value: string | null | undefined): MeetingFlowStageKey | null {
  if (!value) {
    return null;
  }

  return MEETING_FLOW_STAGE_KEY_SET.has(value as MeetingFlowStageKey) ? (value as MeetingFlowStageKey) : null;
}

export function defaultMeetingFlowStage() {
  return 'demo_booked' as const;
}

export function isMeetingFlowStageKey(value: string | null | undefined): value is MeetingFlowStageKey {
  return Boolean(asStageKey(value));
}

export function stageFromQueryValue(value: string | null | undefined) {
  return asStageKey(value) || defaultMeetingFlowStage();
}

export function meetingFlowStageLabel(stage: MeetingFlowStageKey) {
  return MEETING_FLOW_STAGES.find((item) => item.key === stage)?.label || 'Demo Booked';
}

export function meetingFlowDefaultPurpose(stage: MeetingFlowStageKey) {
  return MEETING_FLOW_STAGES.find((item) => item.key === stage)?.defaultPurpose || 'Demo Booked';
}

export function meetingFlowNextStage(stage: MeetingFlowStageKey) {
  const current = MEETING_FLOW_STAGES.find((item) => item.key === stage);

  if (!current || !current.nextKey || !current.nextOffsetDays) {
    return null;
  }

  return {
    key: current.nextKey,
    offsetDays: current.nextOffsetDays
  };
}

export function stageMarkerLine(stage: MeetingFlowStageKey) {
  return `[flow_stage:${stage}]`;
}

function stripStageMarkerLines(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(FLOW_STAGE_PREFIX))
    .join('\n');
}

export function parseMeetingFlowStage(input: { notes?: string | null; purpose?: string | null }): MeetingFlowStageKey {
  const notes = String(input.notes || '');
  const purpose = String(input.purpose || '').toLowerCase();

  for (const line of notes.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed.startsWith(FLOW_STAGE_PREFIX) || !trimmed.endsWith(']')) {
      continue;
    }

    const parsed = asStageKey(trimmed.slice(FLOW_STAGE_PREFIX.length, -1));
    if (parsed) {
      return parsed;
    }
  }

  if (purpose.includes('2-week') || purpose.includes('2 week') || purpose.includes('review')) {
    return 'review_2week';
  }

  if (purpose.includes('3-5 day') || purpose.includes('3 day') || purpose.includes('5 day') || purpose.includes('check-in')) {
    return 'checkin_3day';
  }

  if (purpose.includes('onboard')) {
    return 'onboarding_signup';
  }

  if (purpose.includes('setup') || purpose.includes('api')) {
    return 'setup_call';
  }

  return defaultMeetingFlowStage();
}

export function composeMeetingFlowNotes(input: {
  stage: MeetingFlowStageKey;
  notes?: string | null;
  extraLines?: string[];
}) {
  const cleaned = stripStageMarkerLines(String(input.notes || '').trim());
  const extras = (input.extraLines || []).map((line) => line.trim()).filter(Boolean);
  const lines = [stageMarkerLine(input.stage), cleaned, ...extras].filter(Boolean);
  return lines.join('\n');
}
