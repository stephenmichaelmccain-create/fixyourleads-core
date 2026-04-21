"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value || '').trim();
  return text || null;
}

export async function createCompanyAction(formData: FormData) {
  const name = String(formData.get('name') || '').trim();
  const notificationEmail = optionalText(formData.get('notificationEmail'));
  const telnyxInboundNumber = optionalText(formData.get('telnyxInboundNumber'));
  const nextSurface = String(formData.get('nextSurface') || '').trim();

  if (!name) {
    throw new Error('company_name_required');
  }

  const company = await db.company.create({
    data: {
      name,
      notificationEmail,
      telnyxInboundNumber: telnyxInboundNumber ? normalizePhone(telnyxInboundNumber) : null
    }
  });

  revalidatePath('/companies');
  revalidatePath('/');

  if (nextSurface === 'conversations') {
    redirect(`/conversations?companyId=${company.id}`);
  }
}

export async function updateCompanyAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  const name = String(formData.get('name') || '').trim();
  const notificationEmail = optionalText(formData.get('notificationEmail'));
  const telnyxInboundNumber = optionalText(formData.get('telnyxInboundNumber'));

  if (!companyId || !name) {
    throw new Error('company_id_and_name_required');
  }

  await db.company.update({
    where: { id: companyId },
    data: {
      name,
      notificationEmail,
      telnyxInboundNumber: telnyxInboundNumber ? normalizePhone(telnyxInboundNumber) : null
    }
  });

  revalidatePath('/companies');
  revalidatePath('/');
  revalidatePath(`/leads?companyId=${companyId}`);
  revalidatePath(`/conversations?companyId=${companyId}`);
  revalidatePath(`/events?companyId=${companyId}`);
}
