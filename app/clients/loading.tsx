import { LayoutShell } from '@/app/components/LayoutShell';

export default function Loading() {
  return (
    <LayoutShell title="Clients" section="clients" hidePageHeader>
      <section className="panel panel-stack">
        <div className="loading-action-row">
          <div className="loading-pill loading-skeleton" />
          <div className="loading-pill loading-skeleton" />
        </div>

        <div className="loading-table">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="loading-table-row">
              <div className="loading-dot loading-skeleton" />
              <div className="loading-card-stack">
                <div className="loading-line loading-line-medium loading-skeleton" />
                <div className="loading-line loading-line-short loading-skeleton" />
              </div>
              <div className="loading-line loading-line-short loading-skeleton" />
              <div className="loading-line loading-line-short loading-skeleton" />
              <div className="loading-line loading-line-short loading-skeleton" />
              <div className="loading-pill loading-skeleton" />
            </div>
          ))}
        </div>
      </section>
    </LayoutShell>
  );
}
