import { db } from '@/lib/db';
import { safeLoad } from '@/lib/ui-data';

type CompanySelectorBarProps = {
  action?: '/leads' | '/conversations' | '/events';
  initialCompanyId?: string;
  label?: string;
};

export async function CompanySelectorBar({
  action = '/leads',
  initialCompanyId = '',
  label = 'Workspace'
}: CompanySelectorBarProps) {
  const companies = await safeLoad(
    () =>
      db.company.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          telnyxInboundNumber: true,
          _count: {
            select: {
              leads: true,
              conversations: true,
              appointments: true
            }
          }
        }
      }),
    []
  );

  const currentCompany = companies.find((company) => company.id === initialCompanyId) || null;
  const suggestedCompany = currentCompany || (companies.length === 1 ? companies[0] : null);
  const initialSelection = initialCompanyId || (companies.length === 1 ? companies[0].id : '');

  return (
    <section className="panel panel-stack">
      <div className="inline-row justify-between">
        <div className="panel-stack">
          <div className="metric-label">{label}</div>
          <div className="text-muted">
            Pick the clinic by name once, then keep moving through leads, conversations, and events without retyping IDs.
          </div>
        </div>
        {suggestedCompany && (
          <div className="status-chip">
            <strong>{currentCompany ? 'Active' : 'Suggested'}</strong> {suggestedCompany.name}
          </div>
        )}
      </div>

      <form action={action} method="get" className="context-form">
        <div className="field-stack context-field">
          <label className="key-value-label" htmlFor="companyId">
            {label}
          </label>
          <select id="companyId" name="companyId" defaultValue={initialSelection} className="text-input select-input">
            <option value="">Choose a company</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </div>
        <div className="inline-actions">
          <button type="submit" className="button">
            {currentCompany ? 'Switch workspace' : suggestedCompany ? `Open ${suggestedCompany.name}` : 'Load workspace'}
          </button>
          {initialCompanyId && (
            <a className="button-ghost" href={action}>
              Clear
            </a>
          )}
        </div>
      </form>

      {companies.length === 0 && (
        <div className="empty-state">No companies yet. Add a company first so operators can work a real clinic workspace.</div>
      )}

      {suggestedCompany && (
        <div className="context-summary">
          <div className="context-summary-card">
            <span className="key-value-label">{currentCompany ? 'Current company' : 'Suggested company'}</span>
            <strong>{suggestedCompany.name}</strong>
            <span className="tiny-muted">{suggestedCompany.id}</span>
          </div>
          <div className="context-summary-card">
            <span className="key-value-label">Inbound number</span>
            <strong>{suggestedCompany.telnyxInboundNumber || 'Not set yet'}</strong>
            <span className="tiny-muted">Used for multi-tenant Telnyx routing.</span>
          </div>
          <div className="context-summary-card">
            <span className="key-value-label">Queue size</span>
            <div className="inline-row text-muted">
              <span>Leads: {suggestedCompany._count.leads}</span>
              <span>Threads: {suggestedCompany._count.conversations}</span>
              <span>Bookings: {suggestedCompany._count.appointments}</span>
            </div>
          </div>
          <div className="context-summary-links">
            <a className={`button-secondary${action === '/leads' ? ' is-current-view' : ''}`} href={`/leads?companyId=${suggestedCompany.id}`}>
              Leads
            </a>
            <a className={`button-secondary${action === '/conversations' ? ' is-current-view' : ''}`} href={`/conversations?companyId=${suggestedCompany.id}`}>
              Conversations
            </a>
            <a className={`button-ghost${action === '/events' ? ' is-current-view' : ''}`} href={`/events?companyId=${suggestedCompany.id}`}>
              Events
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
