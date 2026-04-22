type WorkspaceReadinessBannerProps = {
  companyId: string;
  companyName?: string | null;
  telnyxInboundNumbers?: { number: string }[] | null;
  telnyxInboundNumber?: string | null;
  notificationEmail?: string | null;
  includeNotificationHint?: boolean;
};

function hasCompanyRouting(company: {
  telnyxInboundNumber?: string | null;
  telnyxInboundNumbers?: { number: string }[] | null;
}) {
  return Boolean(company.telnyxInboundNumber) || Boolean(company.telnyxInboundNumbers?.length);
}

export function WorkspaceReadinessBanner({
  companyId,
  companyName,
  telnyxInboundNumber,
  telnyxInboundNumbers,
  notificationEmail,
  includeNotificationHint = false
}: WorkspaceReadinessBannerProps) {
  const hasInboundRouting = hasCompanyRouting({ telnyxInboundNumber, telnyxInboundNumbers });
  const missingRouting = !hasInboundRouting;
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
              ? 'Add the client number and clinic notification email in Clients before using this workspace for live replies and booking notifications.'
              : missingRouting
                ? 'Add the client number in Clients so inbound replies route back to this client.'
                : 'Add the clinic notification email in Clients before relying on booking emails.'}
            {includeNotificationHint && ' SMTP also needs to be configured globally before booking emails will actually send.'}
          </div>
        </div>
        <div className="action-cluster">
          <a className="button" href={`/clients/${companyId}#setup`}>
            Fix in Client Profile
          </a>
          {missingNotifications && includeNotificationHint && (
            <a className="button-ghost" href="/admin/system">
              Check SMTP
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
