import { LayoutShell } from './components/LayoutShell';

export default function HomePage() {
  return (
    <LayoutShell title="Fix Your Leads Core">
      <p>Simple internal UI pages:</p>
      <ul>
        <li><a href="/leads?companyId=test-company">/leads?companyId=...</a></li>
        <li><a href="/conversations?companyId=test-company">/conversations?companyId=...</a></li>
        <li><a href="/events?companyId=test-company">/events?companyId=...</a></li>
        <li><a href="/diagnostics">/diagnostics</a></li>
        <li><a href="/api/health">/api/health</a></li>
      </ul>
    </LayoutShell>
  );
}
