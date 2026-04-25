export type StandardLead = {
  full_name: string;
  email: string;
  phone: string;
  business_name?: string;
  source: 'voice_agent';
  call_id: string;
  transcript_url?: string;
  notes?: string;
  created_at: string;
};

export type CrmCredentials = Record<string, unknown>;
export type CrmFieldMapping = Partial<Record<keyof StandardLead, string>>;

export type CrmPushResult = {
  success: boolean;
  externalId?: string;
  response?: unknown;
  error?: string;
};

export type CrmAdapter = {
  pushLead(
    credentials: CrmCredentials,
    fieldMapping: CrmFieldMapping,
    lead: StandardLead
  ): Promise<CrmPushResult>;
};

export function credentialString(credentials: CrmCredentials, keys: string[]) {
  for (const key of keys) {
    const value = credentials[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

export function mappedLeadFields(fieldMapping: CrmFieldMapping, lead: StandardLead) {
  const mapped: Record<string, string> = {};

  for (const [leadKey, crmKey] of Object.entries(fieldMapping)) {
    const value = lead[leadKey as keyof StandardLead];

    if (crmKey && typeof value === 'string' && value.trim()) {
      mapped[crmKey] = value.trim();
    }
  }

  return mapped;
}

export function splitFullName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts.shift() || '';
  const lastName = parts.join(' ');

  return { firstName, lastName };
}

export function responseErrorText(provider: string, status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return `${provider}_request_failed:${status}:${text.slice(0, 500)}`;
}
