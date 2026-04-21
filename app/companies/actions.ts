"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value || '').trim();
  return text || null;
}

function companiesPath(values: { notice?: string; targetCompanyId?: string } = {}) {
  const params = new URLSearchParams();

  if (values.notice) {
    params.set('notice', values.notice);
  }

  if (values.targetCompanyId) {
    params.set('companyId', values.targetCompanyId);
  }

  const search = params.toString();
  const base = search ? `/companies?${search}` : '/companies';

  return values.targetCompanyId ? `${base}#company-${values.targetCompanyId}` : base;
}

export async function createCompanyAction(formData: FormData) {
  const name = String(formData.get('name') || '').trim();
  const notificationEmail = optionalText(formData.get('notificationEmail'));
  const telnyxInboundNumber = optionalText(formData.get('telnyxInboundNumber'));
  const nextSurface = String(formData.get('nextSurface') || '').trim();
  const normalizedInboundNumber = telnyxInboundNumber ? normalizePhone(telnyxInboundNumber) : null;

  if (!name) {
    throw new Error('company_name_required');
  }

  if (normalizedInboundNumber) {
    const existingCompany = await db.company.findFirst({
      where: { telnyxInboundNumber: normalizedInboundNumber },
      select: { id: true }
    });

    if (existingCompany) {
      redirect(companiesPath({ notice: 'duplicate_routing', targetCompanyId: existingCompany.id }));
    }
  }

  const company = await db.company.create({
    data: {
      name,
      notificationEmail,
      telnyxInboundNumber: normalizedInboundNumber
    }
  });

  revalidatePath('/companies');
  revalidatePath('/');

  if (nextSurface === 'conversations') {
    redirect(`/conversations?companyId=${company.id}`);
  }

  redirect(companiesPath({ notice: 'created', targetCompanyId: company.id }));
}

export async function updateCompanyAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  const name = String(formData.get('name') || '').trim();
  const notificationEmail = optionalText(formData.get('notificationEmail'));
  const telnyxInboundNumber = optionalText(formData.get('telnyxInboundNumber'));
  const normalizedInboundNumber = telnyxInboundNumber ? normalizePhone(telnyxInboundNumber) : null;

  if (!companyId || !name) {
    throw new Error('company_id_and_name_required');
  }

  if (normalizedInboundNumber) {
    const existingCompany = await db.company.findFirst({
      where: {
        telnyxInboundNumber: normalizedInboundNumber,
        NOT: { id: companyId }
      },
      select: { id: true }
    });

    if (existingCompany) {
      redirect(companiesPath({ notice: 'duplicate_routing', targetCompanyId: companyId }));
    }
  }

  await db.company.update({
    where: { id: companyId },
    data: {
      name,
      notificationEmail,
      telnyxInboundNumber: normalizedInboundNumber
    }
  });

  revalidatePath('/companies');
  revalidatePath('/');
  revalidatePath(`/leads?companyId=${companyId}`);
  revalidatePath(`/conversations?companyId=${companyId}`);
  revalidatePath(`/bookings?companyId=${companyId}`);
  revalidatePath(`/events?companyId=${companyId}`);

  redirect(companiesPath({ notice: 'updated', targetCompanyId: companyId }));
}
