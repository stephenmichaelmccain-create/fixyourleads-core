type ClientWorkspaceTabsProps = {
  companyId: string;
  active: 'profile' | 'comms' | 'telnyx';
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
          className={`workspace-tab-link ${active === 'comms' ? 'is-active' : ''}`}
          href={`/clients/${companyId}/operator?lab=sms#comms-lab`}
        >
          Comms Lab
        </a>
        <a
          className={`workspace-tab-link ${active === 'telnyx' ? 'is-active' : ''}`}
          href={`/clients/${companyId}/telnyx`}
        >
          Telnyx Setup
        </a>
      </div>
    </section>
  );
}
