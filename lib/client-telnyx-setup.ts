type TelnyxSetupPayload = Record<string, unknown>;

export type TelnyxSetupChecklistKey =
  | 'clientInfoCollected'
  | 'brandRegistered'
  | 'campaignCreated'
  | 'campaignApproved'
  | 'messagingProfileCreated'
  | 'numberAssigned'
  | 'webhookConfigured'
  | 'testSmsSent'
  | 'testReplyReceived'
  | 'complianceReviewed'
  | 'launchApproved';

export type TelnyxSetupState = {
  clientInfoCollected: boolean;
  brandRegistered: boolean;
  campaignCreated: boolean;
  campaignApproved: boolean;
  messagingProfileCreated: boolean;
  numberAssigned: boolean;
  webhookConfigured: boolean;
  testSmsSent: boolean;
  testReplyReceived: boolean;
  complianceReviewed: boolean;
  launchApproved: boolean;
  legalBusinessName: string | null;
  ein: string | null;
  businessAddress: string | null;
  businessEmail: string | null;
  businessPhone: string | null;
  website: string | null;
  brandId: string | null;
  brandStatus: string | null;
  campaignId: string | null;
  campaignStatus: string | null;
  messagingProfileId: string | null;
  messagingProfileStatus: string | null;
  phoneNumber: string | null;
  webhookUrl: string | null;
  automationUrl: string | null;
  intakeFormUrl: string | null;
  documentationUrl: string | null;
  sampleMessage: string | null;
  monthlyVolume: string | null;
  complianceNotes: string | null;
  notes: string | null;
  assistantId: string | null;
  assistantName: string | null;
  mcpServerId: string | null;
  mcpServerName: string | null;
  mcpServerType: string | null;
  mcpServerUrl: string | null;
  mcpAllowedTools: string[];
  updatedAt: string | null;
};

export const telnyxChecklistOrder: Array<{ key: TelnyxSetupChecklistKey; label: string }> = [
  { key: 'clientInfoCollected', label: 'Client intake collected' },
  { key: 'brandRegistered', label: 'Brand created' },
  { key: 'campaignCreated', label: 'Campaign created' },
  { key: 'campaignApproved', label: 'Campaign approved' },
  { key: 'messagingProfileCreated', label: 'Messaging profile created' },
  { key: 'numberAssigned', label: 'Number assigned' },
  { key: 'webhookConfigured', label: 'Webhook configured' },
  { key: 'testSmsSent', label: 'Test SMS sent' },
  { key: 'testReplyReceived', label: 'Test reply received' },
  { key: 'complianceReviewed', label: 'Compliance reviewed' },
  { key: 'launchApproved', label: 'Launch approved' }
];

export const emptyTelnyxSetupState: TelnyxSetupState = {
  clientInfoCollected: false,
  brandRegistered: false,
  campaignCreated: false,
  campaignApproved: false,
  messagingProfileCreated: false,
  numberAssigned: false,
  webhookConfigured: false,
  testSmsSent: false,
  testReplyReceived: false,
  complianceReviewed: false,
  launchApproved: false,
  legalBusinessName: null,
  ein: null,
  businessAddress: null,
  businessEmail: null,
  businessPhone: null,
  website: null,
  brandId: null,
  brandStatus: null,
  campaignId: null,
  campaignStatus: null,
  messagingProfileId: null,
  messagingProfileStatus: null,
  phoneNumber: null,
  webhookUrl: null,
  automationUrl: null,
  intakeFormUrl: null,
  documentationUrl: null,
  sampleMessage: null,
  monthlyVolume: null,
  complianceNotes: null,
  notes: null,
  assistantId: null,
  assistantName: null,
  mcpServerId: null,
  mcpServerName: null,
  mcpServerType: null,
  mcpServerUrl: null,
  mcpAllowedTools: [],
  updatedAt: null
};

function payloadBoolean(payload: TelnyxSetupPayload, key: TelnyxSetupChecklistKey) {
  return payload[key] === true;
}

function payloadText(payload: TelnyxSetupPayload, key: keyof TelnyxSetupState) {
  const value = payload[key];
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function payloadAnyText(payload: TelnyxSetupPayload, key: string) {
  const value = payload[key];
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function payloadStringList(payload: TelnyxSetupPayload, key: string) {
  const value = payload[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseTelnyxSetupPayload(payload: unknown): TelnyxSetupState {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return emptyTelnyxSetupState;
  }

  const record = payload as TelnyxSetupPayload;

  return {
    clientInfoCollected: payloadBoolean(record, 'clientInfoCollected'),
    brandRegistered: payloadBoolean(record, 'brandRegistered'),
    campaignCreated: payloadBoolean(record, 'campaignCreated'),
    campaignApproved: payloadBoolean(record, 'campaignApproved'),
    messagingProfileCreated: payloadBoolean(record, 'messagingProfileCreated'),
    numberAssigned: payloadBoolean(record, 'numberAssigned'),
    webhookConfigured: payloadBoolean(record, 'webhookConfigured'),
    testSmsSent: payloadBoolean(record, 'testSmsSent'),
    testReplyReceived: payloadBoolean(record, 'testReplyReceived'),
    complianceReviewed: payloadBoolean(record, 'complianceReviewed'),
    launchApproved: payloadBoolean(record, 'launchApproved'),
    legalBusinessName: payloadText(record, 'legalBusinessName'),
    ein: payloadText(record, 'ein'),
    businessAddress: payloadText(record, 'businessAddress'),
    businessEmail: payloadText(record, 'businessEmail'),
    businessPhone: payloadText(record, 'businessPhone'),
    website: payloadText(record, 'website'),
    brandId: payloadText(record, 'brandId'),
    brandStatus: payloadText(record, 'brandStatus'),
    campaignId: payloadText(record, 'campaignId'),
    campaignStatus: payloadText(record, 'campaignStatus'),
    messagingProfileId: payloadText(record, 'messagingProfileId'),
    messagingProfileStatus: payloadText(record, 'messagingProfileStatus'),
    phoneNumber: payloadText(record, 'phoneNumber'),
    webhookUrl: payloadText(record, 'webhookUrl'),
    automationUrl: payloadText(record, 'automationUrl') || payloadAnyText(record, 'makeScenarioUrl'),
    intakeFormUrl: payloadText(record, 'intakeFormUrl'),
    documentationUrl: payloadText(record, 'documentationUrl'),
    sampleMessage: payloadText(record, 'sampleMessage'),
    monthlyVolume: payloadText(record, 'monthlyVolume'),
    complianceNotes: payloadText(record, 'complianceNotes'),
    notes: payloadText(record, 'notes'),
    assistantId: payloadAnyText(record, 'assistantId'),
    assistantName: payloadAnyText(record, 'assistantName'),
    mcpServerId: payloadAnyText(record, 'mcpServerId'),
    mcpServerName: payloadAnyText(record, 'mcpServerName'),
    mcpServerType: payloadAnyText(record, 'mcpServerType'),
    mcpServerUrl: payloadAnyText(record, 'mcpServerUrl'),
    mcpAllowedTools: payloadStringList(record, 'mcpAllowedTools'),
    updatedAt: payloadText(record, 'updatedAt')
  };
}

export function telnyxSetupProgress(state: TelnyxSetupState) {
  const completed = telnyxChecklistOrder.filter((item) => state[item.key]).length;
  return { completed, total: telnyxChecklistOrder.length };
}
