type WorkspaceReadinessBannerProps = {
  companyId: string;
  companyName?: string | null;
  telnyxInboundNumber?: string | null;
  notificationEmail?: string | null;
  includeNotificationHint?: boolean;
};

export function WorkspaceReadinessBanner({
  companyId,
  companyName,
  telnyxInboundNumber,
  notificationEmail,
  includeNotificationHint = false
}: WorkspaceReadinessBannerProps) {
  const missingRouting = !telnyxInboundNumber;
  const missingNotifications = !notificationEmail;

  if (!missingRouting && !missingNotifications) {
    return null;
  }

  return (
    <section className="panel panel-stack readiness-banner">
      <div className="metric-label">Workspace readiness</div>
      <div className="record-header">
        <div className="panel-stack">
          <h2 className="form-title">
            {companyName || 'This workspace'} still needs setup before operators can trust every reply and booking.
          </h2>
          <div className="workspace-readiness">
            <span className={`readiness-pill${missingRouting ? '' : ' is-ready'}`}>
              {missingRouting ? 'Inbound routing missing' : 'Inbound routing ready'}
            </span>
            <span className={`readiness-pill${missingNotifications ? '' : ' is-ready'}`}>
              {missingNotifications ? 'Clinic email missing' : 'Clinic email ready'}
            </span>
          </div>
          <div className="text-muted">
            {missingRouting && missingNotifications
              ? 'Add the Telnyx inbound number and clinic notification email in Companies before using this workspace for live replies and booking notifications.'
              : missingRouting
                ? 'Add the Telnyx inbound number in Companies so inbound replies route back to this client.'
                : 'Add the clinic notification email in Companies before relying on booking emails.'}
            {includeNotificationHint && ' SMTP also needs to be configured globally before booking emails will actually send.'}
          </div>
        </div>
        <div className="action-cluster">
          <a className="button" href={`/companies#company-${companyId}`}>
            Fix in Companies
          </a>
          {missingNotifications && includeNotificationHint && (
            <a className="button-ghost" href="/diagnostics">
              Check SMTP
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
