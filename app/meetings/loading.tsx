import { LayoutShell } from '@/app/components/LayoutShell';

export default function Loading() {
  return (
    <LayoutShell title="Meetings" section="meetings" hidePageHeader>
      <section className="panel panel-stack">
        <div className="loading-action-row" style={{ justifyContent: 'space-between', alignItems: 'stretch' }}>
          <div className="loading-card-stack" style={{ maxWidth: 360, width: '100%' }}>
            <div className="loading-line loading-line-medium loading-skeleton" style={{ height: 56 }} />
            <div className="loading-pill loading-skeleton" />
            <div className="loading-line loading-line-long loading-skeleton" />
            <div className="loading-line loading-line-medium loading-skeleton" />
          </div>

          <div className="record-grid" style={{ flex: 1 }}>
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="record-card panel-stack">
                <div className="loading-line loading-line-short loading-skeleton" />
                <div className="loading-line loading-line-medium loading-skeleton" />
                <div className="loading-line loading-line-long loading-skeleton" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel panel-stack">
        <div className="loading-table">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="loading-table-row">
              <div className="loading-line loading-line-short loading-skeleton" />
              <div className="loading-line loading-line-medium loading-skeleton" />
              <div className="loading-line loading-line-medium loading-skeleton" />
              <div className="loading-line loading-line-long loading-skeleton" />
              <div className="loading-pill loading-skeleton" />
            </div>
          ))}
        </div>
      </section>
    </LayoutShell>
  );
}
