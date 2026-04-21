import { db } from '@/lib/db';
import { LayoutShell } from '@/app/components/LayoutShell';
import { LeadStatusButton } from '../LeadStatusButton';
import { safeLoad } from '@/lib/ui-data';

export default async function LeadDetailPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const lead = await safeLoad(
    () =>
      db.lead.findUnique({
        where: { id: leadId },
        include: {
          contact: true,
          company: {
            select: {
              name: true
            }
          }
        }
      }),
    null
  );
  const conversation = lead
    ? await safeLoad(
        () =>
          db.conversation.findUnique({
            where: {
              companyId_contactId: {
                companyId: lead.companyId,
                contactId: lead.contactId
              }
            },
            select: { id: true }
          }),
        null
      )
    : null;

  if (!lead) {
    return (
      <LayoutShell title="Lead Detail" description="The requested lead record could not be found." section="leads">
        <div className="empty-state">Lead not found.</div>
      </LayoutShell>
    );
  }

  return (
    <LayoutShell
      title={lead.contact?.name || 'Lead Detail'}
      description="Lead records should stay simple: one contact, one owner, one clear next action."
      companyId={lead.companyId}
      companyName={lead.company?.name || undefined}
      section="leads"
    >
      <section className="panel panel-stack">
        <div className="metric-label">Next action</div>
        <div className="record-header">
          <div className="panel-stack">
            <h2 className="form-title">
              {conversation ? 'Stay in the thread and move this lead toward booking.' : 'No thread exists yet. Start from the lead and open the first conversation path.'}
            </h2>
            <div className="inline-row">
              <span className={`status-chip ${lead.status === 'REPLIED' ? 'status-chip-attention' : lead.status === 'SUPPRESSED' ? 'status-chip-muted' : ''}`}>
                <strong>Status</strong> {lead.status}
              </span>
              {lead.source && (
                <span className="status-chip status-chip-muted">
                  <strong>Source</strong> {lead.source}
                </span>
              )}
            </div>
          </div>
          <div className="inline-actions">
            {conversation && (
              <a className="button" href={`/conversations/${conversation.id}`}>
                Open thread
              </a>
            )}
            <LeadStatusButton leadId={lead.id} companyId={lead.companyId} />
            <LeadStatusButton leadId={lead.id} companyId={lead.companyId} status="SUPPRESSED" label="Suppress lead" />
          </div>
        </div>
      </section>

      <div className="key-value-grid">
        <div className="key-value-card"><span className="key-value-label">Lead ID</span><span className="tiny-muted">{lead.id}</span></div>
        <div className="key-value-card"><span className="key-value-label">Status</span>{lead.status}</div>
        <div className="key-value-card"><span className="key-value-label">Contact</span>{lead.contact?.name || 'Unnamed'}</div>
        <div className="key-value-card"><span className="key-value-label">Phone</span>{lead.contact?.phone || 'No phone'}</div>
        <div className="key-value-card"><span className="key-value-label">Company</span>{lead.company?.name || 'Unknown company'}</div>
        <div className="key-value-card"><span className="key-value-label">Company ID</span><span className="tiny-muted">{lead.companyId}</span></div>
        {lead.source && <div className="key-value-card"><span className="key-value-label">Source</span>{lead.source}</div>}
        {lead.sourceExternalId && (
          <div className="key-value-card">
            <span className="key-value-label">Source external ID</span>
            <span className="tiny-muted">{lead.sourceExternalId}</span>
          </div>
        )}
        {lead.suppressedAt && (
          <div className="key-value-card">
            <span className="key-value-label">Suppressed</span>
            <span>{lead.suppressedAt.toLocaleString()}</span>
          </div>
        )}
        {lead.suppressionReason && (
          <div className="key-value-card">
            <span className="key-value-label">Suppression reason</span>
            <span>{lead.suppressionReason}</span>
          </div>
        )}
      </div>

      <p className="page-copy">
        Next useful step: {conversation ? 'work the active conversation and move toward booking.' : 'start the conversation flow for this lead.'}
      </p>
    </LayoutShell>
  );
}
