export function Nav() {
  return (
    <nav style={{ marginBottom: 20 }}>
      <a href="/" style={{ marginRight: 12 }}>Home</a>
      <a href="/diagnostics" style={{ marginRight: 12 }}>Diagnostics</a>
      <a href="/leads?companyId=test-company" style={{ marginRight: 12 }}>Leads</a>
      <a href="/conversations?companyId=test-company" style={{ marginRight: 12 }}>Conversations</a>
      <a href="/events?companyId=test-company">Events</a>
    </nav>
  );
}
