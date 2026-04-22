type NavProps = {
  companyId?: string;
  companyName?: string;
  usingRememberedCompany?: boolean;
  current?: 'home' | 'clients' | 'leads' | 'messages' | 'system' | 'activity' | 'diagnostics' | 'our-leads';
};

export function Nav({ companyId, companyName, usingRememberedCompany, current }: NavProps) {
  const linkClass = (name: NavProps['current']) =>
    `nav-pill${current === name ? ' is-active' : ''}`;

  return (
    <div className="hero-nav-wrap">
      <nav className="hero-nav">
        <a className={linkClass('home')} href="/">
          Home
        </a>
        <a className={linkClass('clients')} href="/clients">
          Clients
        </a>
        <a className={linkClass(current === 'our-leads' ? 'our-leads' : 'leads')} href="/leads">
          Leads
        </a>
        <a className={linkClass('messages')} href="/messages">
          Messages
        </a>
      </nav>
      <div className="hero-nav-utility">
        <a
          className={`nav-utility-link${current === 'system' || current === 'diagnostics' ? ' is-active' : ''}`}
          href="/admin/system"
        >
          System Status
        </a>
        <a className={`nav-utility-link${current === 'activity' ? ' is-active' : ''}`} href="/admin/activity">
          Activity Log
        </a>
      </div>
    </div>
  );
}
