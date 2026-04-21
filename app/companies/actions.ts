"use server";

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value || '').trim();
  return text || null;
}

export async function createCompanyAction(formData: FormData) {
  const name = String(formData.get('name') || '').trim();
  const notificationEmail = optionalText(formData.get('notificationEmail'));

  if (!name) {
    throw new Error('company_name_required');
  }

  await db.company.create({
    data: {
      name,
      notificationEmail
    }
  });

  revalidatePath('/companies');
  revalidatePath('/');
}

export async function updateCompanyAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  const name = String(formData.get('name') || '').trim();
  const notificationEmail = optionalText(formData.get('notificationEmail'));

  if (!companyId || !name) {
    throw new Error('company_id_and_name_required');
  }

  await db.company.update({
    where: { id: companyId },
    data: {
      name,
      notificationEmail
    }
  });

  revalidatePath('/companies');
  revalidatePath('/');
  revalidatePath(`/leads?companyId=${companyId}`);
  revalidatePath(`/conversations?companyId=${companyId}`);
  revalidatePath(`/events?companyId=${companyId}`);
}
