export const DEMO_PREFIX = '[DEMO] ';
export const DEMO_PROSPECT_COMPANY_ID = 'fixyourleads-demo';

export function isDemoLabel(value?: string | null) {
  return Boolean(value?.startsWith(DEMO_PREFIX));
}

export function labelAsDemo(value: string) {
  return value.startsWith(DEMO_PREFIX) ? value : `${DEMO_PREFIX}${value}`;
}
