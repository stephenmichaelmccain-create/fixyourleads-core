type NavProps = {
  current?: 'home' | 'clients' | 'leads' | 'messages' | 'system' | 'activity' | 'diagnostics' | 'our-leads';
};

export function Nav({ current }: NavProps) {
  const linkClass = (name: NavProps['current']) =>
    `nav-link${current === name ? ' is-active' : ''}`;

  return (
    <div className="app-nav-wrap">
      <nav className="app-nav" aria-label="Primary">
        <a className={linkClass('activity')} href="/">
          Activity
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
        </div>
      </div>
    </div>
  );
}
