'use client';

import { useEffect } from 'react';
import { LAST_COMPANY_ID_COOKIE, LAST_COMPANY_NAME_COOKIE } from './company-context.shared';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

export function PersistCompanyContext({
  companyId,
  companyName
}: {
  companyId?: string;
  companyName?: string;
}) {
  useEffect(() => {
    if (!companyId) {
      return;
    }

    setCookie(LAST_COMPANY_ID_COOKIE, companyId);

    if (companyName) {
      setCookie(LAST_COMPANY_NAME_COOKIE, companyName);
    }
  }, [companyId, companyName]);

  return null;
}
