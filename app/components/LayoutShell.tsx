import { ReactNode } from 'react';
import { PersistCompanyContext } from './PersistCompanyContext';
import { Nav } from './Nav';
import { getPersistedCompanyContext } from './company-context.server';

export async function LayoutShell({
  title,
  description,
  children,
  companyId,
  companyName,
  section
}: {
  title: string;
  description?: string;
  children: ReactNode;
  companyId?: string;
  companyName?: string;
  section?: 'home' | 'companies' | 'diagnostics' | 'leads' | 'conversations' | 'bookings' | 'events';
}) {
  const persistedCompany = await getPersistedCompanyContext();
  const activeCompanyId = companyId || persistedCompany?.companyId;
  const activeCompanyName = companyName || persistedCompany?.companyName;
  const usingRememberedCompany = !companyId && Boolean(persistedCompany?.companyId);

  return (
    <main className="app-shell">
      <section className="shell-hero">
        {companyId && <PersistCompanyContext companyId={companyId} companyName={companyName} />}
        <div className="hero-eyebrow">Fix Your Leads Control</div>
        <h1 className="hero-title">{title}</h1>
        <p className="hero-copy">
          {description ||
            'Internal ops for instant follow-up, bookings, and clean client communication without adding front-desk busywork.'}
        </p>
        <div className="hero-meta">
          <span className="hero-chip">
            <strong>Mode</strong> Internal CRM
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
