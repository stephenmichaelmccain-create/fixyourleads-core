import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { safeLoad } from '@/lib/ui-data';
import { createCompanyAction, updateCompanyAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function CompaniesPage() {
  const companies = await safeLoad(
    () =>
      db.company.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: {
              leads: true,
              conversations: true,
              appointments: true
            }
          }
        }
      }),
    []
  );

  return (
    <LayoutShell title="Companies">
      <p>Use this page to keep client records and booking notification emails inside the app instead of shell scripts.</p>

      <form
        action={createCompanyAction}
        style={{
          border: '1px solid #ddd',
          borderRadius: 12,
          padding: 16,
          display: 'grid',
          gap: 10,
          marginBottom: 24
        }}
      >
        <strong>Create company</strong>
        <input name="name" placeholder="Clinic or client name" style={{ padding: 10 }} />
        <input name="notificationEmail" placeholder="Client notification email (optional)" style={{ padding: 10 }} />
        <button type="submit" style={{ width: 'fit-content', padding: '8px 12px', cursor: 'pointer' }}>
          Create company
        </button>
      </form>

      <div style={{ display: 'grid', gap: 12 }}>
        {companies.length === 0 && <p>No companies yet.</p>}

        {companies.map((company) => (
          <form
            key={company.id}
            action={updateCompanyAction}
            style={{
              border: '1px solid #ddd',
              borderRadius: 12,
              padding: 16,
              display: 'grid',
              gap: 10
            }}
          >
            <input type="hidden" name="companyId" value={company.id} />
            <div style={{ color: '#666', fontSize: 12 }}>Company ID: {company.id}</div>
            <input name="name" defaultValue={company.name} style={{ padding: 10 }} />
            <input
              name="notificationEmail"
              defaultValue={company.notificationEmail || ''}
              placeholder="Client notification email"
              style={{ padding: 10 }}
            />
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', color: '#666', fontSize: 14 }}>
              <span>Leads: {company._count.leads}</span>
              <span>Conversations: {company._count.conversations}</span>
              <span>Appointments: {company._count.appointments}</span>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button type="submit" style={{ padding: '8px 12px', cursor: 'pointer' }}>
                Save company
              </button>
              <a href={`/leads?companyId=${company.id}`}>Open leads</a>
              <a href={`/conversations?companyId=${company.id}`}>Open conversations</a>
              <a href={`/events?companyId=${company.id}`}>Open events</a>
            </div>
          </form>
        ))}
      </div>
    </LayoutShell>
  );
}
