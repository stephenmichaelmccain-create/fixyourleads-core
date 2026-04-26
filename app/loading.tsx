import { LayoutShell } from '@/app/components/LayoutShell';

export default function Loading() {
  return (
    <LayoutShell title="Activity" section="activity" hidePageHeader>
      <section className="panel panel-stack">
        <div className="loading-card-stack">
          <div className="loading-line loading-line-short loading-skeleton" />
          <div className="loading-line loading-line-medium loading-skeleton" />
        </div>
      </section>

      <section className="panel panel-stack">
        <div className="record-grid">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="record-card panel-stack">
              <div className="loading-line loading-line-short loading-skeleton" />
              <div className="loading-line loading-line-medium loading-skeleton" />
              <div className="loading-line loading-line-long loading-skeleton" />
            </div>
          ))}
        </div>
      </section>
    </LayoutShell>
  );
}
