import { ReactNode } from 'react';
import { PersistCompanyContext } from './PersistCompanyContext';
import { Nav } from './Nav';
import { getPersistedCompanyContext } from './company-context.server';
import { BrandLogo } from './BrandLogo';

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
  section?: 'home' | 'clients' | 'diagnostics' | 'our-leads';
  variant?: 'default' | 'workspace';
}) {
  const persistedCompany = await getPersistedCompanyContext();
  const activeCompanyId = companyId || persistedCompany?.companyId;
  const activeCompanyName = companyName || persistedCompany?.companyName;
  const usingRememberedCompany = !companyId && Boolean(persistedCompany?.companyId);
  const compactVariant = variant === 'workspace';

  return (
    <main className="app-shell">
      <section className={`shell-hero${compactVariant ? ' shell-hero-compact' : ''}`}>
        {companyId && <PersistCompanyContext companyId={companyId} companyName={companyName} />}
        {!compactVariant && (
          <>
            <BrandLogo priority className="hero-brand" />
            <div className="hero-eyebrow">Fix Your Leads Operating System</div>
            <h1 className="hero-title">{title}</h1>
            <p className="hero-copy">
              {description ||
                'Lead response, conversations, booking, and clinic notifications in one operating layer.'}
            </p>
            <div className="hero-meta">
              <span className="hero-chip">
                <strong>Mode</strong> Live operations
              </span>
              <span className="hero-chip">
                <strong>Focus</strong> Text, voice, booking
              </span>
              {activeCompanyName && (
                <span className="hero-chip">
                  <strong>{usingRememberedCompany ? 'Last workspace' : 'Company'}</strong> {activeCompanyName}
                </span>
              )}
              {activeCompanyId && activeCompanyName && (
                <span className="hero-chip hero-chip-subtle">
                  <strong>ID</strong> {activeCompanyId}
                </span>
              )}
              {activeCompanyId && !activeCompanyName && (
                <span className="hero-chip">
                  <strong>{usingRememberedCompany ? 'Last workspace' : 'Company'}</strong> {activeCompanyId}
                </span>
              )}
            </div>
          </>
        )}
        {compactVariant && (
          <div className="hero-compact-copy">
            <h1 className="hero-title hero-title-compact">{title}</h1>
            {description ? <p className="hero-copy hero-copy-compact">{description}</p> : null}
          </div>
        )}
        <Nav
          companyId={activeCompanyId}
          companyName={activeCompanyName}
          usingRememberedCompany={usingRememberedCompany}
          current={section}
        />
      </section>

      <section className="shell-body">
        <div className="page-stack">{children}</div>
      </section>
    </main>
  );
}
