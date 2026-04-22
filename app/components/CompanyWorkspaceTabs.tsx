type CompanyWorkspaceTab =
  | 'leads'
  | 'conversations'
  | 'bookings'
  | 'call-sequences'
  | 'text-sequences';

const tabs: Array<{ key: CompanyWorkspaceTab; label: string; href: (companyId: string) => string }> = [
  { key: 'leads', label: 'Leads', href: (companyId) => `/leads?companyId=${encodeURIComponent(companyId)}` },
  { key: 'conversations', label: 'Conversations', href: (companyId) => `/conversations?companyId=${encodeURIComponent(companyId)}` },
  { key: 'bookings', label: 'Bookings', href: (companyId) => `/bookings?companyId=${encodeURIComponent(companyId)}` },
  { key: 'call-sequences', label: 'Call Sequences', href: (companyId) => `/companies/${companyId}/call-sequences` },
  { key: 'text-sequences', label: 'Text Sequences', href: (companyId) => `/companies/${companyId}/text-sequences` }
];

export function CompanyWorkspaceTabs({
  companyId,
  companyName,
  active
}: {
  companyId: string;
  companyName: string;
  active?: CompanyWorkspaceTab;
}) {
  return (
    <section className="panel panel-stack company-workspace-panel">
      <div className="company-workspace-tabs" role="tablist" aria-label={`${companyName} workspace tabs`}>
        {tabs.map((tab) => (
          <a
            key={tab.key}
            href={tab.href(companyId)}
            className={`company-workspace-tab${tab.key === active ? ' is-active' : ''}`}
            aria-current={tab.key === active ? 'page' : undefined}
          >
            {tab.label}
          </a>
        ))}
      </div>
    </section>
  );
}
