import type { CrmAdapter } from './types';

export const noneCrmAdapter: CrmAdapter = {
  async pushLead(_credentials, _fieldMapping, lead) {
    return {
      success: true,
      externalId: `none:${lead.call_id}`,
      response: {
        detail: 'crm_provider_none_noop'
      }
    };
  }
};
