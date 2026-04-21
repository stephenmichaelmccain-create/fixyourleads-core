export const LAST_COMPANY_ID_COOKIE = 'fyl_last_company_id';
export const LAST_COMPANY_NAME_COOKIE = 'fyl_last_company_name';

export type PersistedCompanyContext = {
  companyId: string;
  companyName?: string;
};

export function withCompanyContext(path: string, companyId?: string | null) {
  if (!companyId) {
    return path;
  }

  const [pathWithoutHash, hash = ''] = path.split('#');
  const url = new URL(pathWithoutHash, 'https://fixyourleads.local');
  url.searchParams.set('companyId', companyId);

  const resolvedPath = `${url.pathname}${url.search}`;
  return hash ? `${resolvedPath}#${hash}` : resolvedPath;
}
