import { LayoutShell } from '@/app/components/LayoutShell';

export default function Loading() {
  return (
    <LayoutShell title="Leads" section="leads" hidePageHeader>
      <div className="loading-queue-layout">
        <section className="panel panel-stack">
          <div className="loading-action-row" style={{ justifyContent: 'space-between' }}>
            <div className="loading-line loading-line-medium loading-skeleton" style={{ maxWidth: 320, width: '100%', height: 40 }} />
            <div className="loading-action-row">
              <div className="loading-pill loading-skeleton" />
              <div className="loading-pill loading-skeleton" />
            </div>
          </div>

          <div className="loading-queue-list">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="loading-queue-card loading-skeleton" />
            ))}
          </div>
        </section>

        <section className="panel panel-stack">
          <div className="loading-card-stack">
            <div className="loading-line loading-line-short loading-skeleton" />
            <div className="loading-line loading-line-medium loading-skeleton" />
            <div className="loading-line loading-line-long loading-skeleton" />
            <div className="loading-line loading-line-long loading-skeleton" />
          </div>
        </section>
      </div>
    </LayoutShell>
  );
}
