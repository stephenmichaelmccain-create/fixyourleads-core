type NavProps = {
  companyId?: string;
  companyName?: string;
  usingRememberedCompany?: boolean;
  current?: 'home' | 'clients' | 'leads' | 'messages' | 'system' | 'activity' | 'diagnostics' | 'our-leads';
};

export function Nav({ companyId, companyName, usingRememberedCompany, current }: NavProps) {
  const linkClass = (name: NavProps['current']) =>
    `nav-link${current === name ? ' is-active' : ''}`;

  return (
    <div className="app-nav-wrap">
      <nav className="app-nav" aria-label="Primary">
        <a className={linkClass('home')} href="/">
          Home
        </a>
        <a className={linkClass(current === 'our-leads' ? 'our-leads' : 'leads')} href="/leads">
          Leads
        </a>
        <a className={linkClass('clients')} href="/clients">
          Clients
        </a>
      </nav>
      <div className="app-nav-utility">
        <div className="app-nav-utility-group">
          <a className={`nav-utility-link${current === 'messages' ? ' is-active' : ''}`} href="/messages">
            Messages
          </a>
        </div>
        <div className="app-nav-utility-group">
          <a
            className={`nav-utility-link${current === 'system' || current === 'diagnostics' ? ' is-active' : ''}`}
            href="/admin/system"
          >
            System
          </a>
          <a className={`nav-utility-link${current === 'activity' ? ' is-active' : ''}`} href="/admin/activity">
            Activity
          </a>
        </div>
        {usingRememberedCompany && companyName && (
          <span className="nav-utility-link nav-utility-context">{companyName}</span>
        )}
      </div>
    </div>
  );
}
