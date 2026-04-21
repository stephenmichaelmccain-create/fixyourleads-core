"use server";

import { revalidatePath } from 'next/cache';
import { LeadStatus } from '@prisma/client';
import { db } from '@/lib/db';

export async function updateLeadStatusAction(formData: FormData) {
  const leadId = String(formData.get('leadId') || '');
  const companyId = String(formData.get('companyId') || '');
  const status = String(formData.get('status') || '');

  if (!leadId || !companyId || !status) {
    throw new Error('leadId_companyId_status_required');
  }

  if (!Object.values(LeadStatus).includes(status as LeadStatus)) {
    throw new Error('invalid_status');
  }

  await db.lead.update({
    where: { id: leadId },
    data: { status: status as LeadStatus }
  });

  revalidatePath(`/leads?companyId=${companyId}`);
  revalidatePath(`/leads/${leadId}`);
}
