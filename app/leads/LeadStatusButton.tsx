import { updateLeadStatusAction } from './actions';

export function LeadStatusButton({
  leadId,
  companyId,
  status = 'CONTACTED',
  label = 'Mark Contacted',
  returnTo
}: {
  leadId: string;
  companyId: string;
  status?: string;
  label?: string;
  returnTo?: string;
}) {
  const className =
    status === 'SUPPRESSED'
      ? 'button-danger'
      : status === 'CONTACTED'
        ? 'button-secondary'
        : 'button';

  return (
    <form action={updateLeadStatusAction}>
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="status" value={status} />
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <button type="submit" className={className}>
        {label}
      </button>
    </form>
  );
}
