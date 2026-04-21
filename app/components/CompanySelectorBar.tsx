import { db } from '@/lib/db';
import { safeLoad } from '@/lib/ui-data';
import { CompanySelectorForm } from './CompanySelectorForm';

type CompanySelectorBarProps = {
  action?: '/leads' | '/conversations' | '/bookings' | '/events';
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
          notificationEmail: true,
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
  const setupGaps = suggestedCompany
    ? [
        !suggestedCompany.telnyxInboundNumber ? 'Inbound routing number' : null,
        !suggestedCompany.notificationEmail ? 'Clinic notification email' : null
      ].filter(Boolean) as string[]
    : [];
  const missingSetupCount = companies.filter((company) => !company.telnyxInboundNumber || !company.notificationEmail).length;
  const companyOptions = companies.map((company) => ({
    id: company.id,
    name: company.name,
    isActive: company.id === initialSelection,
    needsRouting: !company.telnyxInboundNumber,
    needsEmail: !company.notificationEmail
  }));
  const compactMode = Boolean(currentCompany);

  return (
    <section className="panel panel-stack">
      <div className={`inline-row justify-between${compactMode ? ' context-header-compact' : ''}`}>
        <div className="panel-stack">
          <div className="metric-label">{label}</div>
          <div className="text-muted">
            {compactMode
              ? 'Your active clinic stays sticky here. Pick a different workspace and the page opens immediately.'
              : 'Pick the clinic by name once, then keep moving through leads, conversations, and events without retyping IDs.'}
          </div>
          {companies.length > 0 && (
            <div className="tiny-muted">
              {missingSetupCount === 0
                ? 'Every workspace currently has the basic routing and notification setup.'
                : `${missingSetupCount} workspace${missingSetupCount === 1 ? '' : 's'} still need routing or clinic notification setup.`}
            </div>
          )}
        </div>
        {suggestedCompany && (
          <div className={`status-chip ${setupGaps.length > 0 ? 'status-chip-attention' : ''}`}>
            <strong>{currentCompany ? 'Active' : 'Suggested'}</strong> {suggestedCompany.name}
          </div>
        )}
      </div>

      <CompanySelectorForm
        action={action}
        label={label}
        initialSelection={initialSelection}
        compact={compactMode}
        options={companyOptions}
      />

      {companies.length === 0 && (
        <div className="empty-state">No companies yet. Add a company first so operators can work a real clinic workspace.</div>
      )}

      {suggestedCompany && (
        <>
          {setupGaps.length > 0 && (
            <div className="context-alert context-alert-warn">
              <div className="panel-stack">
                <div className="metric-label">Workspace setup</div>
                <strong>{suggestedCompany.name} is not fully launch-ready yet.</strong>
                <div className="text-muted">
                  Fix {setupGaps.join(' and ')} before you trust inbound replies and clinic-facing booking follow-up.
                </div>
                <div className="readiness-pills">
                  <span className={`readiness-pill${suggestedCompany.telnyxInboundNumber ? ' is-ready' : ' is-warn'}`}>
                    {suggestedCompany.telnyxInboundNumber ? 'Inbound routing ready' : 'Inbound routing missing'}
                  </span>
                  <span className={`readiness-pill${suggestedCompany.notificationEmail ? ' is-ready' : ' is-warn'}`}>
                    {suggestedCompany.notificationEmail ? 'Clinic email ready' : 'Clinic email missing'}
                  </span>
                </div>
              </div>
              <div className="action-cluster">
                <a className="button" href={`/companies#company-${suggestedCompany.id}`}>
                  Fix workspace setup
                </a>
                <a className="button-ghost" href={`/companies`}>
                  Open companies
                </a>
              </div>
            </div>
          )}

          <div className="context-summary">
            {!compactMode && (
              <div className="context-summary-card">
                <span className="key-value-label">Suggested company</span>
                <strong>{suggestedCompany.name}</strong>
                <span className="tiny-muted">{suggestedCompany.id}</span>
              </div>
            )}
            <div className="context-summary-card">
              <span className="key-value-label">Launch readiness</span>
              <div className="readiness-pills">
                <span className={`readiness-pill${suggestedCompany.telnyxInboundNumber ? ' is-ready' : ' is-warn'}`}>
                  {suggestedCompany.telnyxInboundNumber ? 'Inbound routing set' : 'Needs routing'}
                </span>
                <span className={`readiness-pill${suggestedCompany.notificationEmail ? ' is-ready' : ' is-warn'}`}>
                  {suggestedCompany.notificationEmail ? 'Clinic email set' : 'Needs clinic email'}
                </span>
              </div>
              <span className="tiny-muted">Setup blockers should be obvious before operators start working the queue.</span>
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
              <a className={`button-secondary${action === '/bookings' ? ' is-current-view' : ''}`} href={`/bookings?companyId=${suggestedCompany.id}`}>
                Bookings
              </a>
              <a className={`button-ghost${action === '/events' ? ' is-current-view' : ''}`} href={`/events?companyId=${suggestedCompany.id}`}>
                Events
              </a>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
