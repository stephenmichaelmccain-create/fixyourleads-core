import { notFound } from 'next/navigation';
import { LayoutShell } from '@/app/components/LayoutShell';
import { CompanyWorkspaceTabs } from '@/app/components/CompanyWorkspaceTabs';
import { db } from '@/lib/db';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

export default async function CompanyCallSequencesPage({
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
      title={`${company.name} Call Sequences`}
      description="Keep the repeatable call structure for this company in one place."
      companyId={company.id}
      companyName={company.name}
      section="companies"
    >
      <CompanyWorkspaceTabs companyId={company.id} companyName={company.name} active="call-sequences" />

      <section className="panel panel-stack">
        <div className="metric-label">Call sequences</div>
        <h2 className="section-title">This workspace is ready for the company’s call playbook.</h2>
        <p className="text-muted">
          Keep the call flow simple: first touch, follow-up after no answer, booking callback, and escalation to a human if needed.
        </p>
        <ul className="list-clean text-muted">
          <li>Opening call script for first contact</li>
          <li>No-answer retry timing</li>
          <li>Booking callback path</li>
          <li>Escalation path for human handoff</li>
        </ul>
        <div className="action-cluster">
          <a className="button" href={`/conversations?companyId=${company.id}`}>
            Open conversations
          </a>
          <a className="button-secondary" href={`/companies/${company.id}/text-sequences`}>
            Open text sequences
          </a>
        </div>
      </section>
    </LayoutShell>
  );
}
