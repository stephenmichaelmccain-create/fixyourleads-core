import type { CrmAdapter } from './types';
import { credentialString, mappedLeadFields, responseErrorText, splitFullName } from './types';

export const hubspotCrmAdapter: CrmAdapter = {
  async pushLead(credentials, fieldMapping, lead) {
    const token = credentialString(credentials, ['privateAppToken', 'accessToken', 'token']);

    if (!token) {
      return {
        success: false,
        error: 'hubspot_token_missing'
      };
    }

    const { firstName, lastName } = splitFullName(lead.full_name);
    const properties: Record<string, string> = {
      email: lead.email,
      phone: lead.phone,
      firstname: firstName,
      lastname: lastName,
      company: lead.business_name || '',
      ...mappedLeadFields(fieldMapping, lead)
    };

    Object.keys(properties).forEach((key) => {
      if (!properties[key]) {
        delete properties[key];
      }
    });

    const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ properties })
    });

    const responseBody = await response.json().catch(async () => response.text());

    if (!response.ok) {
      return {
        success: false,
        error: responseErrorText('hubspot', response.status, responseBody),
        response: responseBody
      };
    }

    const externalId =
      responseBody && typeof responseBody === 'object' && 'id' in responseBody
        ? String(responseBody.id)
        : undefined;

    return {
      success: true,
      externalId,
      response: responseBody
    };
  }
};
