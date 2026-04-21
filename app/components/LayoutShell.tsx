import { ReactNode } from 'react';
import { Nav } from './Nav';

export function LayoutShell({
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
  return (
    <main className="app-shell">
      <section className="shell-hero">
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
          {companyName && (
            <span className="hero-chip">
              <strong>Company</strong> {companyName}
            </span>
          )}
          {companyId && companyName && (
            <span className="hero-chip hero-chip-subtle">
              <strong>ID</strong> {companyId}
            </span>
          )}
          {companyId && !companyName && (
            <span className="hero-chip">
              <strong>Company</strong> {companyId}
            </span>
          )}
        </div>
        <Nav companyId={companyId} current={section} />
      </section>

      <section className="shell-body">
        <div className="page-stack">{children}</div>
      </section>
    </main>
  );
}
