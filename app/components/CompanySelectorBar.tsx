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
    <form action={action} method="get" className="panel field-stack">
      <div className="inline-row justify-between">
        <div>
          <div className="metric-label">{label}</div>
          <div className="text-muted">Load the right clinic workspace before working leads, conversations, or events.</div>
        </div>
      </div>
      <div className="field-row">
        <label className="tiny-muted" htmlFor="companyId">
          {label}
        </label>
      </div>
      <div className="field-row">
      <input
        id="companyId"
        type="text"
        name="companyId"
        defaultValue={initialCompanyId}
        placeholder="Enter Company ID"
        className="text-input"
      />
      <button type="submit" className="button">
        Load
      </button>
      </div>
    </form>
  );
}
