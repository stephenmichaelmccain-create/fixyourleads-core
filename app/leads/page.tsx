import { db } from '@/lib/db';
import { LayoutShell } from '@/app/components/LayoutShell';
import { CompanySelectorBar } from '@/app/components/CompanySelectorBar';
import { LeadStatusButton } from './LeadStatusButton';
import { safeLoad } from '@/lib/ui-data';
import { isGoogleMapsConfigured } from '@/lib/google-maps';
import { importGoogleMapsLeadsAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function LeadsPage({
  searchParams
}: {
  searchParams?: Promise<{
    companyId?: string;
    status?: string;
    importQuery?: string;
    imported?: string;
    duplicates?: string;
    suppressedDuplicates?: string;
    skippedNoPhone?: string;
    importError?: string;
  }>;
}) {
  const params = (await searchParams) || {};
  const companyId = params.companyId || '';
  const status = params.status || '';
  const importQuery = params.importQuery || '';
  const imported = Number(params.imported || 0);
  const duplicates = Number(params.duplicates || 0);
  const suppressedDuplicates = Number(params.suppressedDuplicates || 0);
  const skippedNoPhone = Number(params.skippedNoPhone || 0);
  const importError = params.importError || '';
  const googleMapsConfigured = isGoogleMapsConfigured();
  const selectedCompany = companyId
    ? await safeLoad(
        () =>
          db.company.findUnique({
            where: { id: companyId },
            select: { id: true, name: true }
          }),
        null
      )
    : null;
  const conversations = companyId
    ? await safeLoad(
        () =>
          db.conversation.findMany({
            where: { companyId },
            select: {
              id: true,
              contactId: true
            }
          }),
        []
      )
    : [];

  const leads = companyId
    ? await safeLoad(
        () =>
          db.lead.findMany({
            where: { companyId },
            include: { contact: true },
            orderBy: { createdAt: 'desc' },
            take: 100
          }),
        []
      )
    : [];
  const visibleLeads = status ? leads.filter((lead) => lead.status === status) : leads;
  const conversationByContactId = new Map(conversations.map((conversation) => [conversation.contactId, conversation.id]));
  const actionableLeads = visibleLeads.filter((lead) => lead.status !== 'SUPPRESSED' && lead.status !== 'BOOKED');
  const nextLead = actionableLeads[0] || visibleLeads[0] || null;
  const statusCounts = {
    NEW: leads.filter((lead) => lead.status === 'NEW').length,
    CONTACTED: leads.filter((lead) => lead.status === 'CONTACTED').length,
    REPLIED: leads.filter((lead) => lead.status === 'REPLIED').length,
    BOOKED: leads.filter((lead) => lead.status === 'BOOKED').length,
    SUPPRESSED: leads.filter((lead) => lead.status === 'SUPPRESSED').length
  };

  return (
    <LayoutShell
      title="Leads"
      description="Work the top of the funnel without contacting the same clinic twice. Every lead here should map cleanly to one company, one contact, and one conversation path."
      companyId={companyId}
      companyName={selectedCompany?.name || undefined}
      section="leads"
    >
      <CompanySelectorBar action="/leads" initialCompanyId={companyId} />

      {!companyId && <div className="empty-state">Choose a company by name to load the lead workspace.</div>}

      {companyId && (
        <section className="panel panel-stack">
          <div className="metric-label">Google Maps import</div>
          <h2 className="form-title">Import clinics into {selectedCompany?.name || 'this company'}</h2>
          <p className="page-copy">
            Keep the path thin: search clinics, normalize phones, suppress duplicates, and only create leads that can be worked.
          </p>
          <form action={importGoogleMapsLeadsAction} className="panel-stack">
            <input type="hidden" name="companyId" value={companyId} />
            <div className="field-row">
              <input
                className="text-input"
                name="query"
                placeholder="Example: med spa in Denver CO"
                defaultValue={importQuery}
              />
              <input className="text-input" name="limit" type="number" min="1" max="20" defaultValue="10" />
            </div>
            <div className="inline-actions">
              <button type="submit" className="button" disabled={!googleMapsConfigured}>
                Import from Google Maps
              </button>
              <span className="tiny-muted">
                {googleMapsConfigured
                  ? 'Uses the configured Google Maps / Places API key without exposing it in the UI.'
                  : 'Google Maps import is disabled until GOOGLE_MAPS_API_KEY or GOOGLE_API_KEY is set.'}
              </span>
            </div>
          </form>

          {importError && <div className="empty-state">Google Maps import error: {importError}</div>}

          {!importError && importQuery && (
            <div className="inline-row text-muted">
              <span>Last import: {importQuery}</span>
              <span>Imported: {imported}</span>
              <span>Duplicates: {duplicates}</span>
              <span>Suppressed: {suppressedDuplicates}</span>
              <span>Skipped without usable phone: {skippedNoPhone}</span>
            </div>
          )}
        </section>
      )}

      {companyId && nextLead && (
        <section className="panel panel-stack">
          <div className="metric-label">Lead work queue</div>
          <div className="inline-row justify-between">
            <div className="panel-stack">
              <h2 className="form-title">Work the next lead without losing context.</h2>
              <div className="inline-row text-muted">
                <span>New: {statusCounts.NEW}</span>
                <span>Contacted: {statusCounts.CONTACTED}</span>
                <span>Replied: {statusCounts.REPLIED}</span>
                <span>Booked: {statusCounts.BOOKED}</span>
                <span>Suppressed: {statusCounts.SUPPRESSED}</span>
              </div>
            </div>
            <a
              className="button"
              href={
                conversationByContactId.get(nextLead.contactId)
                  ? `/conversations/${conversationByContactId.get(nextLead.contactId)}`
                  : `/leads/${nextLead.id}`
              }
            >
              {conversationByContactId.get(nextLead.contactId) ? 'Open next thread' : 'Open next lead'}
            </a>
          </div>
        </section>
      )}

      {companyId && leads.length > 0 && (
        <section className="panel panel-stack">
          <div className="metric-label">Lead status filters</div>
          <div className="filter-bar">
            {[
              { label: 'All leads', value: '', count: leads.length },
              { label: 'New', value: 'NEW', count: statusCounts.NEW },
              { label: 'Contacted', value: 'CONTACTED', count: statusCounts.CONTACTED },
              { label: 'Replied', value: 'REPLIED', count: statusCounts.REPLIED },
              { label: 'Booked', value: 'BOOKED', count: statusCounts.BOOKED },
              { label: 'Suppressed', value: 'SUPPRESSED', count: statusCounts.SUPPRESSED }
            ].map((filter) => {
              const href = filter.value ? `/leads?companyId=${companyId}&status=${filter.value}` : `/leads?companyId=${companyId}`;

              return (
                <a
                  key={filter.label}
                  className={`filter-chip${status === filter.value ? ' is-active' : ''}`}
                  href={href}
                >
                  <strong>{filter.label}</strong>
                  <span>{filter.count}</span>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {companyId && leads.length === 0 && (
        <div className="empty-state">No leads found yet, or the database is not ready for lead queries.</div>
      )}

      {companyId && leads.length > 0 && visibleLeads.length === 0 && (
        <div className="empty-state">No leads match the current status filter.</div>
      )}

      <div className="record-grid">
        {visibleLeads.map((lead) => (
          <section key={lead.id} className="record-card">
            <div className="record-header">
              <div>
                <div className="metric-label">Lead</div>
                <strong className="record-title">
                  <a href={`/leads/${lead.id}`}>{lead.contact?.name || 'Unnamed contact'}</a>
                </strong>
                <div className="record-subtitle">{lead.contact?.phone || 'No phone'}</div>
              </div>
              <span className={`status-chip ${lead.status === 'REPLIED' ? 'status-chip-attention' : lead.status === 'SUPPRESSED' ? 'status-chip-muted' : ''}`}>
                <strong>Status</strong> {lead.status}
              </span>
            </div>
            <div className="inline-row text-muted">
              <span>Lead ID: {lead.id}</span>
              {lead.source && <span>Source: {lead.source}</span>}
              {lead.sourceExternalId && <span>External ID: {lead.sourceExternalId}</span>}
            </div>
            <div className="record-links">
              {conversationByContactId.get(lead.contactId) ? (
                <a className="button" href={`/conversations/${conversationByContactId.get(lead.contactId)}`}>
                  Open thread
                </a>
              ) : (
                <a className="button-secondary" href={`/leads/${lead.id}`}>
                  Open lead
                </a>
              )}
              <a className="button-ghost" href={`/leads/${lead.id}`}>
                Open lead
              </a>
              <LeadStatusButton leadId={lead.id} companyId={lead.companyId} />
            </div>
          </section>
        ))}
      </div>
    </LayoutShell>
  );
}
