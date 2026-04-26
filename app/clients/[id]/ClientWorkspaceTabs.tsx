type ClientWorkspaceTabsProps = {
  companyId: string;
  active: 'profile' | 'workflow';
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
          className={`workspace-tab-link ${active === 'workflow' ? 'is-active' : ''}`}
          href={`/clients/${companyId}/workflow`}
        >
          Workflow
        </a>
      </div>
    </section>
  );
}
