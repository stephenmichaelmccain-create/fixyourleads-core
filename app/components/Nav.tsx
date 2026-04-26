import Link from 'next/link';

type NavProps = {
  current?: 'home' | 'clients' | 'leads' | 'messages' | 'system' | 'activity' | 'diagnostics' | 'our-leads';
  variant?: 'sidebar' | 'mobile';
};

type NavKey = 'activity' | 'leads' | 'clients' | 'system';

const desktopPrimaryItems: Array<{ key: NavKey; href: string; label: string }> = [
  { key: 'activity', href: '/', label: 'Activity' },
  { key: 'leads', href: '/leads', label: 'Leads' },
  { key: 'clients', href: '/clients', label: 'Clients' }
];

const desktopUtilityItems: Array<{ key: NavKey; href: string; label: string }> = [
  { key: 'system', href: '/admin/system', label: 'Settings' }
];

const mobileItems = [...desktopPrimaryItems, ...desktopUtilityItems];

function normalizeCurrent(current?: NavProps['current']): NavKey | undefined {
  if (!current) {
    return undefined;
  }

  if (current === 'home') {
    return 'activity';
  }

  if (current === 'our-leads') {
    return 'leads';
  }

  if (current === 'diagnostics') {
    return 'system';
  }

  if (current === 'messages') {
    return 'clients';
  }

  return current;
}

function NavIcon({ name }: { name: NavKey }) {
  if (name === 'activity') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12h3l2.2-5 4.2 10 2.2-5H20" />
      </svg>
    );
  }

  if (name === 'leads') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="4" />
        <path d="M8 12h8M12 8v8" />
      </svg>
    );
  }

  if (name === 'clients') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15.5 19a3.5 3.5 0 0 0-7 0" />
        <circle cx="12" cy="9" r="3.25" />
        <path d="M19.5 18.5a3 3 0 0 0-3-2.75M17.2 6.8a3.1 3.1 0 0 1 0 5.9" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.25" />
      <path d="M12 4.5v2.25M12 17.25v2.25M19.5 12h-2.25M6.75 12H4.5M17.3 6.7l-1.6 1.6M8.3 15.7l-1.6 1.6M17.3 17.3l-1.6-1.6M8.3 8.3 6.7 6.7" />
    </svg>
  );
}

function NavLink({
  href,
  label,
  icon,
  isActive,
  className
}: {
  href: string;
  label: string;
  icon: NavKey;
  isActive: boolean;
  className: string;
}) {
  return (
    <Link className={`${className}${isActive ? ' is-active' : ''}`} href={href} aria-current={isActive ? 'page' : undefined}>
      <span className="nav-link-icon" aria-hidden="true">
        <NavIcon name={icon} />
      </span>
      <span className="nav-link-label">{label}</span>
    </Link>
  );
}

export function Nav({ current, variant = 'sidebar' }: NavProps) {
  const normalizedCurrent = normalizeCurrent(current);

  if (variant === 'mobile') {
    return (
      <nav
        className="app-bottom-nav"
        aria-label="Primary"
        style={{ gridTemplateColumns: `repeat(${mobileItems.length}, minmax(0, 1fr))` }}
      >
        {mobileItems.map((item) => (
          <NavLink
            key={item.key}
            href={item.href}
            label={item.label}
            icon={item.key}
            isActive={normalizedCurrent === item.key}
            className="mobile-nav-link"
          />
        ))}
      </nav>
    );
  }

  return (
    <div className="app-nav-wrap">
      <nav className="app-nav" aria-label="Primary">
        {desktopPrimaryItems.map((item) => (
          <NavLink
            key={item.key}
            href={item.href}
            label={item.label}
            icon={item.key}
            isActive={normalizedCurrent === item.key}
            className="nav-link"
          />
        ))}
      </nav>
      <div className="app-nav-utility">
        {desktopUtilityItems.map((item) => (
          <NavLink
            key={item.key}
            href={item.href}
            label={item.label}
            icon={item.key}
            isActive={normalizedCurrent === item.key}
            className="nav-utility-link"
          />
        ))}
      </div>
    </div>
  );
}
