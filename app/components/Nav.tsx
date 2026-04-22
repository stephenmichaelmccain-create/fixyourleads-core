type NavProps = {
  companyId?: string;
  companyName?: string;
  usingRememberedCompany?: boolean;
  current?: 'home' | 'clients' | 'diagnostics' | 'our-leads';
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
        <a className={linkClass('our-leads')} href="/our-leads">
          Our Leads
        </a>
      </nav>
      <div className="hero-nav-utility">
        {usingRememberedCompany && companyName && (
          <span className="nav-context-label">
            Using {companyName}
          </span>
        )}
        <a className={`nav-utility-link${current === 'diagnostics' ? ' is-active' : ''}`} href="/diagnostics">
          Diagnostics
        </a>
      </div>
    </div>
  );
}
