import { cookies } from 'next/headers';
import {
  LAST_COMPANY_ID_COOKIE,
  LAST_COMPANY_NAME_COOKIE,
  type PersistedCompanyContext
} from './company-context.shared';

export async function getPersistedCompanyContext(): Promise<PersistedCompanyContext | null> {
  const cookieStore = await cookies();
  const companyId = cookieStore.get(LAST_COMPANY_ID_COOKIE)?.value?.trim();
  const companyName = cookieStore.get(LAST_COMPANY_NAME_COOKIE)?.value?.trim();

  if (!companyId) {
    return null;
  }

  return {
    companyId,
    companyName: companyName || undefined
  };
}
