"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { LeadStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { createLeadFlow, importGoogleMapsLeads } from '@/services/leads';

function sanitizeReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return null;
  }

  if (value.startsWith('/clients/') || value.startsWith('/leads/')) {
    return value;
  }

  return null;
}

export async function updateLeadStatusAction(formData: FormData) {
  const leadId = String(formData.get('leadId') || '');
  const companyId = String(formData.get('companyId') || '');
  const status = String(formData.get('status') || '');
  const returnTo = sanitizeReturnTo(String(formData.get('returnTo') || '').trim());

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
  revalidatePath(`/clients/${companyId}`);

  if (returnTo) {
    const url = new URL(returnTo, 'http://localhost');
    url.searchParams.set('statusUpdated', status);
    redirect(url.searchParams.toString() ? `${url.pathname}?${url.searchParams.toString()}` : url.pathname);
  }
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

export async function quickAddLeadAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  const name = String(formData.get('name') || '').trim();
  const phone = String(formData.get('phone') || '').trim();
  const source = String(formData.get('source') || '').trim() || 'manual_operator';

  if (!companyId || !phone) {
    redirect(`/leads?companyId=${encodeURIComponent(companyId)}&importError=${encodeURIComponent('company_and_phone_required')}`);
  }

  try {
    const result = await createLeadFlow({
      companyId,
      phone,
      name,
      source
    });

    revalidatePath(`/leads?companyId=${companyId}`);
    revalidatePath(`/conversations?companyId=${companyId}`);
    revalidatePath(`/leads/${result.lead.id}`);
    redirect(`/conversations/${result.conversation.id}`);
  } catch (error) {
    const leadCreateError = error instanceof Error ? error.message : 'manual_lead_create_failed';
    redirect(`/leads?companyId=${encodeURIComponent(companyId)}&importError=${encodeURIComponent(leadCreateError)}`);
  }
}
