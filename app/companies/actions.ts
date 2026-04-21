"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { parseInboundNumberList } from '@/lib/inbound-numbers';

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
  const telnyxInboundInput = formData.get('telnyxInboundNumber');
  const nextSurface = String(formData.get('nextSurface') || '').trim();
  const inboundNumbers = parseInboundNumberList(telnyxInboundInput);
  const normalizedInboundNumber = inboundNumbers[0] || null;

  if (!name) {
    throw new Error('company_name_required');
  }

  if (inboundNumbers.length > 0) {
    const existingCompany = await db.company.findFirst({
      where: {
        OR: [
          { telnyxInboundNumber: { in: inboundNumbers } },
          {
            telnyxInboundNumbers: {
              some: {
                number: { in: inboundNumbers }
              }
            }
          }
        ]
      },
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
      telnyxInboundNumber: normalizedInboundNumber,
      ...(inboundNumbers.length > 0
        ? {
            telnyxInboundNumbers: {
              create: inboundNumbers.map((number) => ({ number }))
            }
          }
        : {})
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
  const telnyxInboundInput = formData.get('telnyxInboundNumber');
  const inboundNumbers = parseInboundNumberList(telnyxInboundInput);
  const normalizedInboundNumber = inboundNumbers[0] || null;

  if (!companyId || !name) {
    throw new Error('company_id_and_name_required');
  }

  if (inboundNumbers.length > 0) {
    const existingCompany = await db.company.findFirst({
      where: {
        NOT: { id: companyId },
        OR: [
          { telnyxInboundNumber: { in: inboundNumbers } },
          {
            telnyxInboundNumbers: {
              some: {
                number: { in: inboundNumbers }
              }
            }
          }
        ]
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
      telnyxInboundNumber: normalizedInboundNumber,
      telnyxInboundNumbers: {
        deleteMany: {},
        create: inboundNumbers.map((number) => ({ number }))
      }
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
