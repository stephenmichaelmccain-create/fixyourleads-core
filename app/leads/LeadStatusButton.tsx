import { updateLeadStatusAction } from './actions';

export function LeadStatusButton({
  leadId,
  companyId,
  status = 'CONTACTED',
  label = 'Mark Contacted'
}: {
  leadId: string;
  companyId: string;
  status?: string;
  label?: string;
}) {
  return (
    <form action={updateLeadStatusAction} style={{ marginTop: 8 }}>
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" style={{ padding: '6px 10px', cursor: 'pointer' }}>
        {label}
      </button>
    </form>
  );
}
