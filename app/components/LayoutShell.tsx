import { ReactNode } from 'react';
import { BrandLogo } from './BrandLogo';
import { PersistCompanyContext } from './PersistCompanyContext';
import { Nav } from './Nav';
import { getPersistedCompanyContext } from './company-context.server';

export async function LayoutShell({
  title,
  description,
  children,
  companyId,
  companyName,
  section,
  variant = 'default'
}: {
  title: string;
  description?: string;
  children: ReactNode;
  companyId?: string;
  companyName?: string;
  section?: 'home' | 'clients' | 'leads' | 'messages' | 'system' | 'activity' | 'diagnostics' | 'our-leads';
  variant?: 'default' | 'workspace';
}) {
  const persistedCompany = await getPersistedCompanyContext();
  const activeCompanyId = companyId || persistedCompany?.companyId;
  const activeCompanyName = companyName || persistedCompany?.companyName;
  const usingRememberedCompany = !companyId && Boolean(persistedCompany?.companyId);
  const showPageHeader = section !== 'home';

  return (
    <main className="app-shell">
      <header className="app-header">
        {companyId && <PersistCompanyContext companyId={companyId} companyName={companyName} />}
        <a className="app-header-brand" href="/" aria-label="Fix Your Leads">
          <BrandLogo />
        </a>
        <Nav
          companyId={activeCompanyId}
          companyName={activeCompanyName}
          usingRememberedCompany={usingRememberedCompany}
          current={section}
        />
      </header>

      <section className="shell-body">
        <div className="page-stack">
          {showPageHeader ? (
            <section className={`page-heading${variant === 'workspace' ? ' page-heading-compact' : ''}`}>
              <div className="page-heading-copy">
                <h1 className="page-title">{title}</h1>
                {description ? <p className="page-copy">{description}</p> : null}
              </div>
            </section>
          ) : null}
          {children}
        </div>
      </section>
    </main>
  );
}
