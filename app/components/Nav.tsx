type NavProps = {
  companyId?: string;
  current?: 'home' | 'companies' | 'diagnostics' | 'leads' | 'conversations' | 'bookings' | 'events';
};

export function Nav({ companyId, current }: NavProps) {
  const withCompany = (path: string) =>
    companyId ? `${path}?companyId=${encodeURIComponent(companyId)}` : path;

  const linkClass = (name: NavProps['current']) =>
    `nav-pill${current === name ? ' is-active' : ''}`;

  return (
    <div className="hero-nav-wrap">
      <nav className="hero-nav">
        <a className={linkClass('home')} href="/">
          Home
        </a>
        <a className={linkClass('companies')} href="/companies">
          Companies
        </a>
        <a className={linkClass('leads')} href={withCompany('/leads')}>
          Leads
        </a>
        <a className={linkClass('conversations')} href={withCompany('/conversations')}>
          Conversations
        </a>
        <a className={linkClass('bookings')} href={withCompany('/bookings')}>
          Bookings
        </a>
        <a className={linkClass('events')} href={withCompany('/events')}>
          Events
        </a>
      </nav>
      <div className="hero-nav-utility">
        <a className={`nav-utility-link${current === 'diagnostics' ? ' is-active' : ''}`} href="/diagnostics">
          Diagnostics
        </a>
      </div>
    </div>
  );
}
