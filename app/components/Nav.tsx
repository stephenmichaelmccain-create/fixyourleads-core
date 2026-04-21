type NavProps = {
  companyId?: string;
};

export function Nav({ companyId }: NavProps) {
  const withCompany = (path: string) =>
    companyId ? `${path}?companyId=${encodeURIComponent(companyId)}` : path;

  return (
    <nav style={{ marginBottom: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <a href="/">Home</a>
      <a href="/companies">Companies</a>
      <a href="/diagnostics">Diagnostics</a>
      <a href={withCompany('/leads')}>Leads</a>
      <a href={withCompany('/conversations')}>Conversations</a>
      <a href={withCompany('/events')}>Events</a>
    </nav>
  );
}
