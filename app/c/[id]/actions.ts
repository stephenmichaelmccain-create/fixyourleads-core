"use server";

import { CrmProvider } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { encryptJson } from '@/lib/encrypted-json';
import { isValidClientViewToken } from '@/lib/client-view-auth';

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value || '').trim();
  return text || null;
}

function parseProvider(value: FormDataEntryValue | null) {
  const provider = String(value || '').trim().toUpperCase();

  if (Object.values(CrmProvider).includes(provider as CrmProvider)) {
    return provider as CrmProvider;
  }

  return CrmProvider.NONE;
}

function readPayloadRecord(payload: unknown) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

function clientPortalPath(companyId: string, token: string, notice?: string) {
  const params = new URLSearchParams();
  params.set('token', token);

  if (notice) {
    params.set('notice', notice);
  }

  return `/c/${companyId}?${params.toString()}`;
}

export async function saveClientPortalSetupAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  const token = String(formData.get('token') || '').trim();

  if (!companyId || !token || !isValidClientViewToken(companyId, token)) {
    redirect('/');
  }

  const name = String(formData.get('name') || '').trim();
  const website = optionalText(formData.get('website'));
  const primaryContactName = optionalText(formData.get('primaryContactName'));
  const primaryContactEmail = optionalText(formData.get('primaryContactEmail'));
  const primaryContactPhone = optionalText(formData.get('primaryContactPhone'));
  const notificationEmail = optionalText(formData.get('notificationEmail'));

  const crmProvider = parseProvider(formData.get('crmProvider'));
  const crmApiKey = optionalText(formData.get('crmApiKey'));
  const crmSecondaryKey = optionalText(formData.get('crmSecondaryKey'));

  const bookingPlatformName = optionalText(formData.get('bookingPlatformName'));
  const bookingPlatformUrl = optionalText(formData.get('bookingPlatformUrl'));
  const bookingApiKey = optionalText(formData.get('bookingApiKey'));
  const bookingSecondaryKey = optionalText(formData.get('bookingSecondaryKey'));

  if (!name) {
    redirect(clientPortalPath(companyId, token, 'name_required'));
  }

  const [company, latestBookingSetupEvent] = await Promise.all([
    db.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        crmCredentialsEncrypted: true
      }
    }),
    db.eventLog.findFirst({
      where: {
        companyId,
        eventType: 'client_calendar_setup_updated'
      },
      orderBy: { createdAt: 'desc' },
      select: {
        payload: true
      }
    })
  ]);

  if (!company) {
    redirect('/');
  }

  let crmCredentialsEncrypted = company.crmCredentialsEncrypted;

  try {
    if (crmProvider === CrmProvider.NONE) {
      crmCredentialsEncrypted = null;
    } else if (crmApiKey || crmSecondaryKey) {
      crmCredentialsEncrypted = encryptJson({
        apiKey: crmApiKey,
        secondaryKey: crmSecondaryKey
      });
    }
  } catch (error) {
    const notice = error instanceof Error && error.message === 'crm_encryption_key_missing'
      ? 'encryption_key_missing'
      : 'credentials_invalid';
    redirect(clientPortalPath(companyId, token, notice));
  }

  await db.company.update({
    where: { id: companyId },
    data: {
      name,
      website,
      primaryContactName,
      primaryContactEmail,
      primaryContactPhone,
      notificationEmail,
      crmProvider,
      crmCredentialsEncrypted
    }
  });

  const existingBookingPayload = readPayloadRecord(latestBookingSetupEvent?.payload);
  const existingEncryptedBookingCredentials =
    typeof existingBookingPayload.externalPlatformCredentialsEncrypted === 'string'
      ? existingBookingPayload.externalPlatformCredentialsEncrypted.trim()
      : '';

  let bookingCredentialsEncrypted = existingEncryptedBookingCredentials || null;

  try {
    if (bookingApiKey || bookingSecondaryKey) {
      bookingCredentialsEncrypted = encryptJson({
        apiKey: bookingApiKey,
        secondaryKey: bookingSecondaryKey
      });
    }
  } catch (error) {
    const notice = error instanceof Error && error.message === 'crm_encryption_key_missing'
      ? 'encryption_key_missing'
      : 'credentials_invalid';
    redirect(clientPortalPath(companyId, token, notice));
  }

  const shouldWriteBookingSetup = Boolean(
    latestBookingSetupEvent ||
      bookingPlatformName ||
      bookingPlatformUrl ||
      bookingApiKey ||
      bookingSecondaryKey
  );

  if (shouldWriteBookingSetup) {
    await db.eventLog.create({
      data: {
        companyId,
        eventType: 'client_calendar_setup_updated',
        payload: {
          ...existingBookingPayload,
          connectionMode:
            bookingPlatformName || bookingPlatformUrl || bookingCredentialsEncrypted
              ? 'external_booking'
              : typeof existingBookingPayload.connectionMode === 'string'
                ? existingBookingPayload.connectionMode
                : null,
          externalPlatformName:
            bookingPlatformName ||
            (typeof existingBookingPayload.externalPlatformName === 'string'
              ? existingBookingPayload.externalPlatformName
              : null),
          externalPlatformUrl:
            bookingPlatformUrl ||
            (typeof existingBookingPayload.externalPlatformUrl === 'string'
              ? existingBookingPayload.externalPlatformUrl
              : null),
          externalPlatformCredentialsEncrypted: bookingCredentialsEncrypted,
          updatedAt: new Date().toISOString()
        }
      }
    });
  }

  revalidatePath(`/c/${companyId}`);
  revalidatePath(`/clients/${companyId}`);
  revalidatePath(`/clients/${companyId}/crm`);
  revalidatePath(`/clients/${companyId}/booking`);

  redirect(clientPortalPath(companyId, token, 'saved'));
}
