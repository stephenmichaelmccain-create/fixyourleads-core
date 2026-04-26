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

function clientProfilePath(companyId: string, notice?: string) {
  const params = new URLSearchParams();

  if (notice) {
    params.set('notice', notice);
  }

  const search = params.toString();
  return search ? `/clients/${companyId}/profile?${search}` : `/clients/${companyId}/profile`;
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

  const data = {
    name,
    notificationEmail,
    telnyxInboundNumber: normalizedInboundNumber,
    website,
    primaryContactName,
    primaryContactEmail,
    primaryContactPhone,
    retainerCents,
    downPaymentCents,
    ...(inboundNumbers.length > 0
      ? {
          telnyxInboundNumbers: {
            create: inboundNumbers.map((number) => ({ number }))
          }
        }
      : {})
  } as const;

  const company = await db.company.create({
    data,
    select: { id: true }
  });

  revalidatePath('/clients');
  revalidatePath('/');
  revalidatePath(`/clients/${company.id}`);
  revalidatePath(`/clients/${company.id}/telnyx`);
  revalidatePath(`/clients/${company.id}/calendar`);
  revalidatePath(`/clients/${company.id}/booking`);
  revalidatePath(`/clients/${company.id}/crm`);

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
  const telnyxInboundProvided = formData.has('telnyxInboundNumber');
  const telnyxInboundInput = telnyxInboundProvided ? formData.get('telnyxInboundNumber') : null;
  const inboundNumbers = telnyxInboundProvided ? parseInboundNumberList(telnyxInboundInput) : [];
  const normalizedInboundNumber = inboundNumbers[0] || null;

  if (!companyId || !name) {
    throw new Error('company_id_and_name_required');
  }

  if (telnyxInboundProvided && inboundNumbers.length > 0) {
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

  const data = {
    name,
    notificationEmail,
    website,
    primaryContactName,
    primaryContactEmail,
    primaryContactPhone,
    retainerCents,
    downPaymentCents,
    ...(telnyxInboundProvided
      ? {
          telnyxInboundNumber: normalizedInboundNumber,
          telnyxInboundNumbers: {
            deleteMany: {},
            create: inboundNumbers.map((number) => ({ number }))
          }
        }
      : {})
  } as const;

  await db.company.update({
    where: { id: companyId },
    data,
    select: { id: true }
  });

  revalidatePath('/clients');
  revalidatePath('/');
  revalidatePath(`/clients/${companyId}`);
  revalidatePath(`/clients/${companyId}/telnyx`);
  revalidatePath(`/clients/${companyId}/calendar`);
  revalidatePath(`/clients/${companyId}/booking`);
  revalidatePath(`/clients/${companyId}/crm`);
  revalidatePath(`/leads?companyId=${companyId}`);
  revalidatePath(`/conversations?companyId=${companyId}`);
  revalidatePath(`/bookings?companyId=${companyId}`);
  revalidatePath(`/events?companyId=${companyId}`);

  redirect(`${clientProfilePath(companyId, 'updated')}#setup`);
}

export async function deleteCompanyAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();

  if (!companyId) {
    redirect(clientsPath());
  }

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true
    }
  });

  if (!company) {
    redirect(clientsPath({ notice: 'deleted' }));
  }

  await db.company.delete({
    where: { id: companyId }
  });

  revalidatePath('/clients');
  revalidatePath('/clients/intake');
  revalidatePath('/');
  revalidatePath('/leads');
  revalidatePath('/bookings');
  revalidatePath('/events');

  redirect(clientsPath({ notice: 'deleted' }));
}
