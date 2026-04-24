import { LayoutShell } from './components/LayoutShell';

export default function NotFoundPage() {
  return (
    <LayoutShell
      title="Page not found"
      description="The page you are looking for is not available in this workspace."
    >
      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">404</div>
            <h2 className="section-title section-title-large">This page is not available.</h2>
            <p className="text-muted">
              The link may be outdated, or the record may no longer exist. Use one of the workspace pages below to get
              back to live data.
            </p>
          </div>
          <div className="inline-actions">
            <a className="button" href="/">
              Activity
            </a>
            <a className="button-secondary" href="/clients">
              Clients
            </a>
            <a className="button-ghost" href="/leads">
              Leads
            </a>
          </div>
        </div>
      </section>
    </LayoutShell>
  );
}
