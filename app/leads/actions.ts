"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { LeadStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { importGoogleMapsLeads } from '@/services/leads';

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

export async function importGoogleMapsLeadsAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  const query = String(formData.get('query') || '').trim();
  const limit = Number(formData.get('limit') || 10);

  if (!companyId || !query) {
    redirect(`/leads?companyId=${encodeURIComponent(companyId)}&importError=company_and_query_required`);
  }

  try {
    const result = await importGoogleMapsLeads({ companyId, query, limit });
    revalidatePath(`/leads?companyId=${companyId}`);

    const params = new URLSearchParams({
      companyId,
      importQuery: query,
      imported: String(result.imported),
      duplicates: String(result.duplicates),
      suppressedDuplicates: String(result.suppressedDuplicates),
      skippedNoPhone: String(result.skippedNoPhone)
    });

    redirect(`/leads?${params.toString()}`);
  } catch (error) {
    const importError = error instanceof Error ? error.message : 'google_maps_import_failed';
    redirect(`/leads?companyId=${encodeURIComponent(companyId)}&importError=${encodeURIComponent(importError)}`);
  }
}
