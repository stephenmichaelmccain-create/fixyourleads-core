import type { CrmAdapter } from './types';

export function createStubCrmAdapter(provider: string): CrmAdapter {
  return {
    async pushLead() {
      return {
        success: false,
        error: `${provider.toLowerCase()}_adapter_not_implemented`
      };
    }
  };
}
