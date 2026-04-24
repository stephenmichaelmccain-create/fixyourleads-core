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

function isMissingCompanyColumnError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  // Postgres: column "website" of relation "Company" does not exist
  return message.toLowerCase().includes('does not exist') && message.toLowerCase().includes('company');
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

  const legacyData = {
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
  } as const;

  const extendedData = {
    ...legacyData,
    website,
    primaryContactName,
    primaryContactEmail,
    primaryContactPhone,
    retainerCents,
    downPaymentCents
  };

  const company = await (async () => {
    try {
      return await db.company.create({
        data: extendedData,
        select: { id: true }
      });
    } catch (error) {
      if (!isMissingCompanyColumnError(error)) {
        throw error;
      }

      // Backward compatible: DB migration hasn't landed yet.
      return await db.company.create({
        data: legacyData,
        select: { id: true }
      });
    }
  })();

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

  const legacyData = {
    name,
    notificationEmail,
    telnyxInboundNumber: normalizedInboundNumber,
    telnyxInboundNumbers: {
      deleteMany: {},
      create: inboundNumbers.map((number) => ({ number }))
    }
  } as const;

  const extendedData = {
    ...legacyData,
    website,
    primaryContactName,
    primaryContactEmail,
    primaryContactPhone,
    retainerCents,
    downPaymentCents
  };

  try {
    await db.company.update({
      where: { id: companyId },
      data: extendedData,
      select: { id: true }
    });
  } catch (error) {
    if (!isMissingCompanyColumnError(error)) {
      throw error;
    }

    await db.company.update({
      where: { id: companyId },
      data: legacyData,
      select: { id: true }
    });
  }

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

  redirect(`/clients/${companyId}?notice=updated#setup`);
}
