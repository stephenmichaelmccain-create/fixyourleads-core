import { LayoutShell } from '@/app/components/LayoutShell';
import { CompanyWorkspaceTabs } from '@/app/components/CompanyWorkspaceTabs';
import { db } from '@/lib/db';
import { safeLoad } from '@/lib/ui-data';
import { isGoogleMapsConfigured } from '@/lib/google-maps';
import { normalizePhone } from '@/lib/phone';
import { LeadStatusButton } from './LeadStatusButton';
import { importGoogleMapsLeadsAction, quickAddLeadAction } from './actions';

export const dynamic = 'force-dynamic';

const leadStatuses = [
  { label: 'All leads', value: '' },
  { label: 'New', value: 'NEW' },
  { label: 'Contacted', value: 'CONTACTED' },
  { label: 'Replied', value: 'REPLIED' },
  { label: 'Booked', value: 'BOOKED' },
  { label: 'Suppressed', value: 'SUPPRESSED' }
] as const;

function buildLeadFilterHref({
  companyId,
  status,
  source
}: {
  companyId?: string;
  status?: string;
  source?: string;
}) {
  const params = new URLSearchParams();

  if (companyId) {
    params.set('companyId', companyId);
  }

  if (status) {
    params.set('status', status);
  }

  if (source) {
    params.set('source', source);
  }

  const query = params.toString();
  return query ? `/leads?${query}` : '/leads';
}

export default async function LeadsPage({
  searchParams
}: {
  searchParams?: Promise<{
    companyId?: string;
    status?: string;
    source?: string;
    importQuery?: string;
    imported?: string;
    duplicates?: string;
    suppressedDuplicates?: string;
    skippedNoPhone?: string;
    importError?: string;
  }>;
}) {
  const params = (await searchParams) || {};
  const requestedCompanyId = params.companyId || '';
  const status = params.status || '';
  const source = params.source || '';
  const importQuery = params.importQuery || '';
  const imported = Number(params.imported || 0);
  const duplicates = Number(params.duplicates || 0);
  const suppressedDuplicates = Number(params.suppressedDuplicates || 0);
  const skippedNoPhone = Number(params.skippedNoPhone || 0);
  const importError = params.importError || '';
  const googleMapsConfigured = isGoogleMapsConfigured();

  const companies = await safeLoad(
    () =>
      db.company.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true
        }
      }),
    []
  );

  const selectedCompany = companies.find((company) => company.id === requestedCompanyId) || null;
  const companyId = selectedCompany?.id || '';
  const leadWhere = {
    ...(companyId ? { companyId } : {}),
    ...(source ? { source } : {})
  };

  const allLeads = await safeLoad(
    () =>
      db.lead.findMany({
        where: leadWhere,
        include: {
          company: {
            select: {
              id: true,
              name: true
            }
          },
          contact: {
            include: {
              _count: {
                select: {
                  leads: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 150
      }),
    []
  );

  const sourceRows = await safeLoad(
    () =>
      db.lead.findMany({
        where: companyId ? { companyId } : {},
        select: { source: true },
        orderBy: { createdAt: 'desc' },
        take: 250
      }),
    []
  );

  const sourceOptions = Array.from(
    new Set(
      sourceRows
        .map((row) => row.source?.trim())
        .filter((value): value is string => Boolean(value))
    )
  ).sort((left, right) => left.localeCompare(right));

  const statusCounts = {
    NEW: allLeads.filter((lead) => lead.status === 'NEW').length,
    CONTACTED: allLeads.filter((lead) => lead.status === 'CONTACTED').length,
    REPLIED: allLeads.filter((lead) => lead.status === 'REPLIED').length,
    BOOKED: allLeads.filter((lead) => lead.status === 'BOOKED').length,
    SUPPRESSED: allLeads.filter((lead) => lead.status === 'SUPPRESSED').length
  };

  const visibleLeads = status ? allLeads.filter((lead) => lead.status === status) : allLeads;
  const conversationClauses = Array.from(
    new Set(allLeads.map((lead) => `${lead.companyId}:${lead.contactId}`))
  ).map((key) => {
    const [companyIdValue, contactId] = key.split(':');

    return {
      companyId: companyIdValue,
      contactId
    };
  });

  const conversations = conversationClauses.length
    ? await safeLoad(
        () =>
          db.conversation.findMany({
            where: {
              OR: conversationClauses
            },
            select: {
              id: true,
              companyId: true,
              contactId: true
            }
          }),
        []
      )
    : [];

  const conversationByKey = new Map(
    conversations.map((conversation) => [`${conversation.companyId}:${conversation.contactId}`, conversation.id])
  );

  const priorityRank = (leadStatus: string) => {
    if (leadStatus === 'NEW') {
      return 0;
    }

    if (leadStatus === 'CONTACTED') {
      return 1;
    }

    if (leadStatus === 'REPLIED') {
      return 2;
    }

    if (leadStatus === 'BOOKED') {
      return 3;
    }

    return 4;
  };

  const callableLeads = visibleLeads.filter((lead) => lead.status !== 'SUPPRESSED' && lead.status !== 'BOOKED');
  const nextLead =
    [...callableLeads].sort((left, right) => {
      const leftRank = priorityRank(left.status);
      const rightRank = priorityRank(right.status);

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    })[0] ||
    visibleLeads[0] ||
    null;

  return (
    <LayoutShell
      title="Leads"
      description="Work every lead from one place, then drop into a company workspace only when you need that client’s exact booking or follow-up lane."
      companyId={companyId}
      companyName={selectedCompany?.name || undefined}
      section="leads"
    >
      {selectedCompany && (
        <CompanyWorkspaceTabs companyId={selectedCompany.id} companyName={selectedCompany.name} active="leads" />
      )}

      <section className="panel panel-stack">
        <div className="metric-label">{selectedCompany ? 'Company leads' : 'All leads'}</div>
        <div className="inline-row justify-between">
          <div className="panel-stack">
            <h2 className="form-title">
              {selectedCompany
                ? `Lead queue for ${selectedCompany.name}`
                : 'Global lead queue across every company'}
            </h2>
            <p className="page-copy">
              Filter by company, status, or source, then move straight into the exact thread instead of hunting around the app.
            </p>
          </div>
          <div className="company-summary-strip company-summary-strip-compact">
            <div className="company-summary-item">
              <span className="key-value-label">Visible</span>
              <strong>{visibleLeads.length}</strong>
            </div>
            <div className="company-summary-item">
              <span className="key-value-label">Ready</span>
              <strong>{statusCounts.NEW + statusCounts.CONTACTED + statusCounts.REPLIED}</strong>
            </div>
            <div className="company-summary-item">
              <span className="key-value-label">Companies</span>
              <strong>{companyId ? 1 : companies.length}</strong>
            </div>
          </div>
        </div>

        <form action="/leads" className="workspace-filter-form">
          <div className="workspace-filter-row">
            <div className="field-stack">
              <label className="key-value-label" htmlFor="lead-company-filter">
                Company
              </label>
              <select id="lead-company-filter" name="companyId" className="select-input" defaultValue={companyId}>
                <option value="">All companies</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-stack">
              <label className="key-value-label" htmlFor="lead-status-filter">
                Status
              </label>
              <select id="lead-status-filter" name="status" className="select-input" defaultValue={status}>
                {leadStatuses.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-stack">
              <label className="key-value-label" htmlFor="lead-source-filter">
                Source
              </label>
              <select id="lead-source-filter" name="source" className="select-input" defaultValue={source}>
                <option value="">All sources</option>
                {sourceOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="workspace-filter-actions">
            <button type="submit" className="button">
              Apply filters
            </button>
            <a className="button-ghost" href="/leads">
              Clear filters
            </a>
          </div>
        </form>
      </section>

      {companyId && (
        <section className="panel panel-stack">
          <div className="metric-label">Quick add</div>
          <h2 className="form-title">Drop a lead into {selectedCompany?.name} and open the thread.</h2>
          <form action={quickAddLeadAction} className="panel-stack">
            <input type="hidden" name="companyId" value={companyId} />
            <div className="field-row">
              <input className="text-input" name="name" placeholder="Clinic or contact name" />
              <input className="text-input" name="phone" placeholder="Phone number" />
            </div>
            <div className="field-row">
              <input className="text-input" name="source" placeholder="Source label" defaultValue="manual_operator" />
            </div>
            <div className="inline-actions">
              <button type="submit" className="button">
                Create lead and open thread
              </button>
              <span className="tiny-muted">Quick add stays company-specific so the lead lands in the right workspace.</span>
            </div>
          </form>
        </section>
      )}

      {companyId && (
        <section className="panel panel-stack">
          <div className="metric-label">Google Maps import</div>
          <h2 className="form-title">Import clinics into {selectedCompany?.name}</h2>
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
                  ? 'Imports directly into the selected company.'
                  : 'Google Maps import is disabled until GOOGLE_MAPS_API_KEY or GOOGLE_API_KEY is set.'}
              </span>
            </div>
          </form>

          {importError && <div className="empty-state">Lead import error: {importError}</div>}

          {!importError && importQuery && (
            <div className="inline-row text-muted">
              <span>Last import: {importQuery}</span>
              <span>Imported: {imported}</span>
              <span>Duplicates: {duplicates}</span>
              <span>Suppressed: {suppressedDuplicates}</span>
              <span>Skipped no phone: {skippedNoPhone}</span>
            </div>
          )}
        </section>
      )}

      {nextLead && (
        <section className="panel panel-stack">
          <div className="metric-label">Next lead</div>
          <div className="inline-row justify-between">
            <div className="panel-stack">
              <h2 className="form-title">
                {selectedCompany ? 'Work the next lead inside this company workspace.' : 'Work the next lead from the global queue.'}
              </h2>
              <div className="inline-row text-muted">
                <span>New: {statusCounts.NEW}</span>
                <span>Contacted: {statusCounts.CONTACTED}</span>
                <span>Replied: {statusCounts.REPLIED}</span>
                <span>Booked: {statusCounts.BOOKED}</span>
                <span>Suppressed: {statusCounts.SUPPRESSED}</span>
              </div>
            </div>
            <div className="inline-actions">
              {normalizePhone(nextLead.contact?.phone || '') && (
                <a className="button-secondary" href={`tel:${normalizePhone(nextLead.contact?.phone || '')}`}>
                  Call next lead
                </a>
              )}
              <a
                className="button"
                href={
                  conversationByKey.get(`${nextLead.companyId}:${nextLead.contactId}`)
                    ? `/conversations/${conversationByKey.get(`${nextLead.companyId}:${nextLead.contactId}`)}`
                    : `/leads/${nextLead.id}`
                }
              >
                {conversationByKey.get(`${nextLead.companyId}:${nextLead.contactId}`) ? 'Open next thread' : 'Open next lead'}
              </a>
            </div>
          </div>
        </section>
      )}

      {allLeads.length > 0 && (
        <section className="panel panel-stack">
          <div className="metric-label">Status filters</div>
          <div className="filter-bar">
            {leadStatuses.map((filter) => {
              const count =
                filter.value === ''
                  ? allLeads.length
                  : statusCounts[filter.value as keyof typeof statusCounts];

              return (
                <a
                  key={filter.label}
                  className={`filter-chip${status === filter.value ? ' is-active' : ''}`}
                  href={buildLeadFilterHref({
                    companyId,
                    source,
                    status: filter.value
                  })}
                >
                  <strong>{filter.label}</strong>
                  <span>{count}</span>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {allLeads.length === 0 && (
        <div className="empty-state">
          {selectedCompany
            ? `No leads found yet for ${selectedCompany.name}.`
            : 'No leads found yet across any company.'}
        </div>
      )}

      {allLeads.length > 0 && visibleLeads.length === 0 && (
        <div className="empty-state">No leads match the current filters.</div>
      )}

      <div className="record-grid">
        {visibleLeads.map((lead) => {
          const conversationId = conversationByKey.get(`${lead.companyId}:${lead.contactId}`);
          const normalizedPhone = normalizePhone(lead.contact?.phone || '');

          return (
            <section key={lead.id} className="record-card">
              <div className="record-header">
                <div>
                  <div className="metric-label">Lead</div>
                  <strong className="record-title">
                    <a href={`/leads/${lead.id}`}>{lead.contact?.name || 'Unnamed contact'}</a>
                  </strong>
                  <div className="record-subtitle">{lead.contact?.phone || 'No phone'}</div>
                </div>
                <span
                  className={`status-chip ${lead.status === 'REPLIED' ? 'status-chip-attention' : lead.status === 'SUPPRESSED' ? 'status-chip-muted' : ''}`}
                >
                  <strong>Status</strong> {lead.status}
                </span>
              </div>
              <div className="inline-row text-muted">
                {!selectedCompany && <span>Company: {lead.company?.name || 'Unknown company'}</span>}
                {lead.contact?._count?.leads ? <span>Contact touches: {lead.contact._count.leads}</span> : null}
                {lead.source && <span>Source: {lead.source}</span>}
                {lead.sourceExternalId && <span>External ID: {lead.sourceExternalId}</span>}
              </div>
              <div className="inline-row text-muted">
                <span>Lead ID: {lead.id}</span>
                <span>Company ID: {lead.companyId}</span>
              </div>
              <div className="record-links">
                {conversationId ? (
                  <a className="button" href={`/conversations/${conversationId}`}>
                    Open thread
                  </a>
                ) : (
                  <a className="button-secondary" href={`/leads/${lead.id}`}>
                    Open lead
                  </a>
                )}
                {normalizedPhone && (
                  <>
                    <a className="button-ghost" href={`tel:${normalizedPhone}`}>
                      Call clinic
                    </a>
                    <a className="button-link" href={`sms:${normalizedPhone}`}>
                      Open text
                    </a>
                  </>
                )}
                <LeadStatusButton leadId={lead.id} companyId={lead.companyId} />
              </div>
            </section>
          );
        })}
      </div>
    </LayoutShell>
  );
}
