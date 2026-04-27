import Link from 'next/link';

type ClientWorkspaceTabsProps = {
  companyId: string;
  active: 'live-log' | 'profile' | 'n8n' | 'telnyx';
};

export function ClientWorkspaceTabs({ companyId, active }: ClientWorkspaceTabsProps) {
  return (
    <section className="panel panel-stack">
      <div className="workspace-tab-row">
        <Link
          className={`workspace-tab-link ${active === 'live-log' ? 'is-active' : ''}`}
          href={`/clients/${companyId}/live-log`}
        >
          Live log
        </Link>
        <Link
          className={`workspace-tab-link ${active === 'profile' ? 'is-active' : ''}`}
          href={`/clients/${companyId}/profile`}
        >
          Client profile
        </Link>
        <Link
          className={`workspace-tab-link ${active === 'n8n' ? 'is-active' : ''}`}
          href={`/clients/${companyId}/n8n`}
        >
          n8n
        </Link>
        <Link
          className={`workspace-tab-link ${active === 'telnyx' ? 'is-active' : ''}`}
          href={`/clients/${companyId}/telnyx`}
        >
          Telnyx
        </Link>
      </div>
    </section>
  );
}
