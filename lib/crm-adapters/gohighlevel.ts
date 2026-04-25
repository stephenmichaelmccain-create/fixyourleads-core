import type { CrmAdapter } from './types';
import { credentialString, mappedLeadFields, responseErrorText, splitFullName } from './types';

export const gohighlevelCrmAdapter: CrmAdapter = {
  async pushLead(credentials, fieldMapping, lead) {
    const token = credentialString(credentials, ['accessToken', 'privateIntegrationToken', 'token']);
    const locationId = credentialString(credentials, ['locationId', 'subAccountId']);

    if (!token) {
      return {
        success: false,
        error: 'gohighlevel_token_missing'
      };
    }

    if (!locationId) {
      return {
        success: false,
        error: 'gohighlevel_location_id_missing'
      };
    }

    const { firstName, lastName } = splitFullName(lead.full_name);
    const body = {
      locationId,
      firstName,
      lastName,
      name: lead.full_name,
      email: lead.email,
      phone: lead.phone,
      source: 'voice_agent',
      companyName: lead.business_name,
      ...mappedLeadFields(fieldMapping, lead)
    };

    const response = await fetch('https://services.leadconnectorhq.com/contacts/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(body)
    });

    const responseBody = await response.json().catch(async () => response.text());

    if (!response.ok) {
      return {
        success: false,
        error: responseErrorText('gohighlevel', response.status, responseBody),
        response: responseBody
      };
    }

    const responseRecord =
      responseBody && typeof responseBody === 'object' ? (responseBody as Record<string, unknown>) : {};
    const contactRecord =
      responseRecord.contact && typeof responseRecord.contact === 'object'
        ? (responseRecord.contact as Record<string, unknown>)
        : {};
    const externalId = contactRecord.id || responseRecord.id;

    return {
      success: true,
      externalId: externalId ? String(externalId) : undefined,
      response: responseBody
    };
  }
};
