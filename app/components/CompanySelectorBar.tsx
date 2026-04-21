export function CompanySelectorBar({
  action = '/leads',
  initialCompanyId = '',
  label = 'Company ID'
}: {
  action?: string;
  initialCompanyId?: string;
  label?: string;
}) {
  return (
    <form action={action} method="get" style={{ display: 'flex', gap: 8, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
      <label style={{ fontSize: 14, color: '#555' }}>{label}</label>
      <input
        type="text"
        name="companyId"
        defaultValue={initialCompanyId}
        placeholder="Enter Company ID"
        style={{ padding: 10, border: '1px solid #ccc', minWidth: 280, borderRadius: 8 }}
      />
      <button
        type="submit"
        style={{ padding: '10px 14px', background: '#111', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
      >
        Load
      </button>
    </form>
  );
}
