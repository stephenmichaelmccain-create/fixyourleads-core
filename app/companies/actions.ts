"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { parseInboundNumberList } from '@/lib/inbound-numbers';

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value || '').trim();
  return text || null;
}

function optionalMoneyCents(value: FormDataEntryValue | null) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  const match = text.replace(/[$,]/g, '').match(/-?\d+(\.\d+)?/);
  const parsed = match ? Number(match[0]) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.round(parsed * 100);
}

function clientsPath(values: { notice?: string; targetCompanyId?: string } = {}) {
  const params = new URLSearchParams();

  if (values.notice) {
    params.set('notice', values.notice);
  }

  if (values.targetCompanyId) {
    params.set('companyId', values.targetCompanyId);
  }

  const search = params.toString();
  const base = search ? `/clients?${search}` : '/clients';

  return values.targetCompanyId ? `${base}#client-${values.targetCompanyId}` : base;
}

export async function createCompanyAction(formData: FormData) {
  const name = String(formData.get('name') || '').trim();
  const notificationEmail = optionalText(formData.get('notificationEmail'));
  const website = optionalText(formData.get('website'));
  const primaryContactName = optionalText(formData.get('primaryContactName'));
  const primaryContactEmail = optionalText(formData.get('primaryContactEmail'));
  const primaryContactPhone = optionalText(formData.get('primaryContactPhone'));
  const retainerCents = optionalMoneyCents(formData.get('retainer'));
  const downPaymentCents = optionalMoneyCents(formData.get('downPayment'));
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
      redirect(clientsPath({ notice: 'duplicate_routing', targetCompanyId: existingCompany.id }));
    }
  }

  const company = await db.company.create({
    data: {
      name,
      notificationEmail,
      website,
      primaryContactName,
      primaryContactEmail,
      primaryContactPhone,
      retainerCents,
      downPaymentCents,
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

  revalidatePath('/clients');
  revalidatePath('/');
  revalidatePath(`/clients/${company.id}`);

  if (nextSurface === 'conversations') {
    redirect(`/clients/${company.id}`);
  }

  redirect(clientsPath({ notice: 'created', targetCompanyId: company.id }));
}

export async function updateCompanyAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  const name = String(formData.get('name') || '').trim();
  const notificationEmail = optionalText(formData.get('notificationEmail'));
  const website = optionalText(formData.get('website'));
  const primaryContactName = optionalText(formData.get('primaryContactName'));
  const primaryContactEmail = optionalText(formData.get('primaryContactEmail'));
  const primaryContactPhone = optionalText(formData.get('primaryContactPhone'));
  const retainerCents = optionalMoneyCents(formData.get('retainer'));
  const downPaymentCents = optionalMoneyCents(formData.get('downPayment'));
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
      redirect(clientsPath({ notice: 'duplicate_routing', targetCompanyId: companyId }));
    }
  }

  await db.company.update({
    where: { id: companyId },
    data: {
      name,
      notificationEmail,
      website,
      primaryContactName,
      primaryContactEmail,
      primaryContactPhone,
      retainerCents,
      downPaymentCents,
      telnyxInboundNumber: normalizedInboundNumber,
      telnyxInboundNumbers: {
        deleteMany: {},
        create: inboundNumbers.map((number) => ({ number }))
      }
    }
  });

  revalidatePath('/clients');
  revalidatePath('/');
  revalidatePath(`/clients/${companyId}`);
  revalidatePath(`/leads?companyId=${companyId}`);
  revalidatePath(`/conversations?companyId=${companyId}`);
  revalidatePath(`/bookings?companyId=${companyId}`);
  revalidatePath(`/events?companyId=${companyId}`);

  redirect(`/clients/${companyId}?notice=updated#setup`);
}
