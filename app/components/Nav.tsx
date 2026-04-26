import Link from 'next/link';

type NavProps = {
  current?: 'home' | 'clients' | 'leads' | 'messages' | 'system' | 'activity' | 'diagnostics' | 'our-leads';
};

export function Nav({ current }: NavProps) {
  const linkClass = (name: NavProps['current']) =>
    `nav-link${current === name ? ' is-active' : ''}`;

  return (
    <div className="app-nav-wrap">
      <nav className="app-nav" aria-label="Primary">
        <Link className={linkClass('activity')} href="/">
          Activity
        </Link>
        <Link className={linkClass(current === 'our-leads' ? 'our-leads' : 'leads')} href="/leads">
          Leads
        </Link>
        <Link className={linkClass('clients')} href="/clients">
          Clients
        </Link>
      </nav>
      <div className="app-nav-utility">
        <Link className={`nav-utility-link${current === 'messages' ? ' is-active' : ''}`} href="/messages">
          Messages
        </Link>
        <Link
          className={`nav-utility-link${current === 'system' || current === 'diagnostics' ? ' is-active' : ''}`}
          href="/admin/system"
        >
          Settings
        </Link>
      </div>
    </div>
  );
}
