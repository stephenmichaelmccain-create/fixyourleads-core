type CalendarSetupPayload = Record<string, unknown>;

export type CalendarChecklistKey =
  | 'bookingSourceConfirmed'
  | 'calendarModeChosen'
  | 'googleOauthConnected'
  | 'sharedCalendarCreated'
  | 'externalPlatformReviewed'
  | 'writebackConfigured'
  | 'syncTestPassed'
  | 'clientVisibilityConfirmed'
  | 'launchApproved';

export type ClientCalendarSetupState = {
  bookingSourceConfirmed: boolean;
  calendarModeChosen: boolean;
  googleOauthConnected: boolean;
  sharedCalendarCreated: boolean;
  externalPlatformReviewed: boolean;
  writebackConfigured: boolean;
  syncTestPassed: boolean;
  clientVisibilityConfirmed: boolean;
  launchApproved: boolean;
  connectionMode: string | null;
  googleAccountEmail: string | null;
  googleCalendarId: string | null;
  sharedCalendarName: string | null;
  sharedCalendarShareEmail: string | null;
  externalPlatformName: string | null;
  externalPlatformUrl: string | null;
  externalCalendarId: string | null;
  secondaryPlatformName: string | null;
  secondaryPlatformUrl: string | null;
  secondaryPlatformId: string | null;
  timezone: string | null;
  defaultDurationMinutes: string | null;
  reviewAutomationEnabled: boolean;
  reviewGoogleReviewUrl: string | null;
  reviewOwnerAlertContact: string | null;
  reviewWebhookSecret: string | null;
  reviewDelayHours: string | null;
  notes: string | null;
  updatedAt: string | null;
};

export const calendarChecklistOrder: Array<{ key: CalendarChecklistKey; label: string }> = [
  { key: 'bookingSourceConfirmed', label: 'Fix Your Leads is the booking source of truth' },
  { key: 'calendarModeChosen', label: 'Calendar mode chosen' },
  { key: 'googleOauthConnected', label: 'Google OAuth connected' },
  { key: 'sharedCalendarCreated', label: 'Shared FYL calendar created' },
  { key: 'externalPlatformReviewed', label: 'Existing booking platform reviewed' },
  { key: 'writebackConfigured', label: 'Booking writeback configured' },
  { key: 'syncTestPassed', label: 'Sync test passed' },
  { key: 'clientVisibilityConfirmed', label: 'Client can see bookings' },
  { key: 'launchApproved', label: 'Calendar launch approved' }
];

export const emptyClientCalendarSetupState: ClientCalendarSetupState = {
  bookingSourceConfirmed: false,
  calendarModeChosen: false,
  googleOauthConnected: false,
  sharedCalendarCreated: false,
  externalPlatformReviewed: false,
  writebackConfigured: false,
  syncTestPassed: false,
  clientVisibilityConfirmed: false,
  launchApproved: false,
  connectionMode: null,
  googleAccountEmail: null,
  googleCalendarId: null,
  sharedCalendarName: null,
  sharedCalendarShareEmail: null,
  externalPlatformName: null,
  externalPlatformUrl: null,
  externalCalendarId: null,
  secondaryPlatformName: null,
  secondaryPlatformUrl: null,
  secondaryPlatformId: null,
  timezone: null,
  defaultDurationMinutes: null,
  reviewAutomationEnabled: false,
  reviewGoogleReviewUrl: null,
  reviewOwnerAlertContact: null,
  reviewWebhookSecret: null,
  reviewDelayHours: null,
  notes: null,
  updatedAt: null
};

function payloadBoolean(payload: CalendarSetupPayload, key: CalendarChecklistKey) {
  return payload[key] === true;
}

function payloadText(payload: CalendarSetupPayload, key: keyof ClientCalendarSetupState) {
  const value = payload[key];
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

export function parseClientCalendarSetupPayload(payload: unknown): ClientCalendarSetupState {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return emptyClientCalendarSetupState;
  }

  const record = payload as CalendarSetupPayload;

  return {
    bookingSourceConfirmed: payloadBoolean(record, 'bookingSourceConfirmed'),
    calendarModeChosen: payloadBoolean(record, 'calendarModeChosen'),
    googleOauthConnected: payloadBoolean(record, 'googleOauthConnected'),
    sharedCalendarCreated: payloadBoolean(record, 'sharedCalendarCreated'),
    externalPlatformReviewed: payloadBoolean(record, 'externalPlatformReviewed'),
    writebackConfigured: payloadBoolean(record, 'writebackConfigured'),
    syncTestPassed: payloadBoolean(record, 'syncTestPassed'),
    clientVisibilityConfirmed: payloadBoolean(record, 'clientVisibilityConfirmed'),
    launchApproved: payloadBoolean(record, 'launchApproved'),
    connectionMode: payloadText(record, 'connectionMode'),
    googleAccountEmail: payloadText(record, 'googleAccountEmail'),
    googleCalendarId: payloadText(record, 'googleCalendarId'),
    sharedCalendarName: payloadText(record, 'sharedCalendarName'),
    sharedCalendarShareEmail: payloadText(record, 'sharedCalendarShareEmail'),
    externalPlatformName: payloadText(record, 'externalPlatformName'),
    externalPlatformUrl: payloadText(record, 'externalPlatformUrl'),
    externalCalendarId: payloadText(record, 'externalCalendarId'),
    secondaryPlatformName: payloadText(record, 'secondaryPlatformName'),
    secondaryPlatformUrl: payloadText(record, 'secondaryPlatformUrl'),
    secondaryPlatformId: payloadText(record, 'secondaryPlatformId'),
    timezone: payloadText(record, 'timezone'),
    defaultDurationMinutes: payloadText(record, 'defaultDurationMinutes'),
    reviewAutomationEnabled: record.reviewAutomationEnabled === true,
    reviewGoogleReviewUrl: payloadText(record, 'reviewGoogleReviewUrl'),
    reviewOwnerAlertContact: payloadText(record, 'reviewOwnerAlertContact'),
    reviewWebhookSecret: payloadText(record, 'reviewWebhookSecret'),
    reviewDelayHours: payloadText(record, 'reviewDelayHours'),
    notes: payloadText(record, 'notes'),
    updatedAt: payloadText(record, 'updatedAt')
  };
}

export function clientCalendarSetupProgress(state: ClientCalendarSetupState) {
  const completed = calendarChecklistOrder.filter((item) => state[item.key]).length;
  return { completed, total: calendarChecklistOrder.length };
}
