import { notFound } from 'next/navigation';
import { LayoutShell } from '@/app/components/LayoutShell';
import { CompanyWorkspaceTabs } from '@/app/components/CompanyWorkspaceTabs';
import { db } from '@/lib/db';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

export default async function CompanyTextSequencesPage({
  params
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const company = await safeLoad(
    () =>
      db.company.findUnique({
        where: { id: companyId },
        select: { id: true, name: true }
      }),
    null
  );

  if (!company) {
    notFound();
  }

  return (
    <LayoutShell
      title={`${company.name} Text Sequences`}
      description="Keep the repeatable text follow-up steps for this company in one place."
      companyId={company.id}
      companyName={company.name}
      section="companies"
    >
      <CompanyWorkspaceTabs companyId={company.id} companyName={company.name} active="text-sequences" />

      <section className="panel panel-stack">
        <div className="metric-label">Text sequences</div>
        <h2 className="section-title">This workspace is ready for the company’s repeatable text paths.</h2>
        <p className="text-muted">
          Keep first-touch, no-response, booking reminder, and reactivation copy organized by company instead of rebuilding it every time.
        </p>
        <ul className="list-clean text-muted">
          <li>First outbound text</li>
          <li>No-response follow-up</li>
          <li>Booking reminder or confirmation</li>
          <li>Reactivation or check-in text</li>
        </ul>
        <div className="action-cluster">
          <a className="button" href={`/conversations?companyId=${company.id}`}>
            Open conversations
          </a>
          <a className="button-secondary" href={`/companies/${company.id}/call-sequences`}>
            Open call sequences
          </a>
        </div>
      </section>
    </LayoutShell>
  );
}
