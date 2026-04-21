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

      {companyId && leads.length === 0 && (
        <div className="empty-state">No leads found yet, or the database is not ready for lead queries.</div>
      )}

      <div className="record-grid">
        {leads.map((lead) => (
          <section key={lead.id} className="record-card">
            <div className="record-header">
              <div>
                <div className="metric-label">Lead</div>
                <strong>
                  <a href={`/leads/${lead.id}`}>{lead.contact?.name || 'Unnamed contact'}</a>
                </strong>
              </div>
              <span className="status-chip">
                <strong>Status</strong> {lead.status}
              </span>
            </div>
            <div className="record-subtitle">{lead.contact?.phone || 'No phone'}</div>
            <div className="tiny-muted">Lead ID: {lead.id}</div>
            <div className="record-links">
              <a className="button-secondary" href={`/leads/${lead.id}`}>
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
