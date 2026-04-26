import { ReactNode } from 'react';
import Link from 'next/link';
import { BrandLogo } from './BrandLogo';
import { PersistCompanyContext } from './PersistCompanyContext';
import { Nav } from './Nav';

export async function LayoutShell({
  title,
  description,
  children,
  companyId,
  companyName,
  section,
  variant = 'default',
  hidePageHeader = false
}: {
  title: string;
  description?: string;
  children: ReactNode;
  companyId?: string;
  companyName?: string;
  section?: 'home' | 'clients' | 'leads' | 'meetings' | 'system' | 'activity' | 'diagnostics' | 'our-leads';
  variant?: 'default' | 'workspace';
  hidePageHeader?: boolean;
}) {
  const showPageHeader = section !== 'home' && !hidePageHeader;

  return (
    <main className="app-shell">
      {companyId && <PersistCompanyContext companyId={companyId} companyName={companyName} />}

      <div className="app-frame">
        <aside className="app-sidebar" aria-label="Workspace navigation">
          <Link className="app-sidebar-brand" href="/" aria-label="Fix Your Leads">
            <span className="app-sidebar-brand-mark">
              <BrandLogo />
            </span>
            <span className="app-sidebar-brand-copy">
              <strong>Fix Your Leads</strong>
              <span>Workspace</span>
            </span>
          </Link>
          <Nav current={section} variant="sidebar" />
        </aside>

        <div className="app-main">
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
        </div>
      </div>

      <Nav current={section} variant="mobile" />
    </main>
  );
}
