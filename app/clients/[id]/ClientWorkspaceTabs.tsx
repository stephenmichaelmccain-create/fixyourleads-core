type ClientWorkspaceTabsProps = {
  companyId: string;
  active: 'profile' | 'crm' | 'comms' | 'telnyx' | 'booking';
};

export function ClientWorkspaceTabs({ companyId, active }: ClientWorkspaceTabsProps) {
  return (
    <section className="panel panel-stack">
      <div className="workspace-tab-row">
        <a
          className={`workspace-tab-link ${active === 'profile' ? 'is-active' : ''}`}
          href={`/clients/${companyId}`}
        >
          Client profile
        </a>
        <a
          className={`workspace-tab-link ${active === 'crm' ? 'is-active' : ''}`}
          href={`/clients/${companyId}/crm`}
        >
          CRM
        </a>
        <a
          className={`workspace-tab-link ${active === 'telnyx' ? 'is-active' : ''}`}
          href={`/clients/${companyId}/telnyx`}
        >
          AI Voice
        </a>
        <a
          className={`workspace-tab-link ${active === 'booking' ? 'is-active' : ''}`}
          href={`/clients/${companyId}/booking`}
        >
          Booking
        </a>
      </div>
    </section>
  );
}
