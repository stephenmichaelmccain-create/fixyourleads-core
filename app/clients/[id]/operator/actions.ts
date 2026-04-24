"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { companyPrimaryInboundNumber } from '@/lib/inbound-numbers';
import { normalizePhone } from '@/lib/phone';
import { sendSms } from '@/lib/telnyx';

function sanitizeReturnTo(value: string | null | undefined, fallback: string) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }

  if (value.startsWith('/clients/')) {
    return value;
  }

  return fallback;
}

function redirectPathWithValues(path: string, values: Record<string, string | null | undefined>) {
  const url = new URL(path, 'http://localhost');

  Object.entries(values).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    }
  });

  const search = url.searchParams.toString();
  return search ? `${url.pathname}?${search}` : url.pathname;
}

function classifyMessagingTestError(error: unknown) {
  if (!(error instanceof Error)) {
    return 'messaging_test_failed';
  }

  if (error.message === 'Missing Telnyx configuration') {
    return 'sender_missing';
  }

  if (error.message.startsWith('Telnyx send failed:')) {
    return 'telnyx_send_failed';
  }

  return 'messaging_test_failed';
}

export async function sendClientMessagingTestAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  const targetPhone = normalizePhone(String(formData.get('targetPhone') || ''));
  const text = String(formData.get('text') || '').trim();
  const fallbackPath = companyId ? `/clients/${companyId}/operator` : '/clients';
  const returnTo = sanitizeReturnTo(String(formData.get('returnTo') || '').trim(), fallbackPath);

  if (!companyId || !targetPhone || !text) {
    redirect(
      `${redirectPathWithValues(returnTo, {
        lab: 'sms',
        test: 'error',
        testDetail: 'companyId_targetPhone_text_required'
      })}#comms-lab`
    );
  }

  const company = await db.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      telnyxInboundNumber: true,
      telnyxInboundNumbers: {
        select: { number: true }
      }
    }
  });

  if (!company) {
    redirect(
      `${redirectPathWithValues(returnTo, {
        lab: 'sms',
        test: 'error',
        testDetail: 'company_not_found'
      })}#comms-lab`
    );
  }

  const senderNumber = companyPrimaryInboundNumber(company) || process.env.TELNYX_FROM_NUMBER?.trim() || null;

  if (!senderNumber) {
    await db.eventLog.create({
      data: {
        companyId,
        eventType: 'operator_messaging_test_failed',
        payload: {
          targetPhone,
          text,
          detail: 'sender_missing'
        }
      }
    });

    revalidatePath(`/clients/${companyId}`);
    revalidatePath(`/clients/${companyId}/operator`);

    redirect(
      `${redirectPathWithValues(returnTo, {
        lab: 'sms',
        test: 'error',
        testDetail: 'sender_missing'
      })}#comms-lab`
    );
  }

  try {
    const telnyxResult = await sendSms(targetPhone, text, senderNumber);

    await db.eventLog.create({
      data: {
        companyId,
        eventType: 'operator_messaging_test_sent',
        payload: {
          targetPhone,
          text,
          from: senderNumber,
          externalId: telnyxResult?.data?.id || null
        }
      }
    });

    revalidatePath(`/clients/${companyId}`);
    revalidatePath(`/clients/${companyId}/operator`);
    revalidatePath(`/events?companyId=${companyId}`);

    redirect(
      `${redirectPathWithValues(returnTo, {
        lab: 'sms',
        test: 'sent',
        testDetail: telnyxResult?.data?.id ? 'accepted_by_telnyx' : 'logged_without_external_id',
        testTarget: targetPhone
      })}#comms-lab`
    );
  } catch (error) {
    await db.eventLog.create({
      data: {
        companyId,
        eventType: 'operator_messaging_test_failed',
        payload: {
          targetPhone,
          text,
          from: senderNumber,
          detail: classifyMessagingTestError(error),
          error: error instanceof Error ? error.message : 'unknown error'
        }
      }
    });

    revalidatePath(`/clients/${companyId}`);
    revalidatePath(`/clients/${companyId}/operator`);
    revalidatePath(`/events?companyId=${companyId}`);

    redirect(
      `${redirectPathWithValues(returnTo, {
        lab: 'sms',
        test: 'error',
        testDetail: classifyMessagingTestError(error),
        testTarget: targetPhone
      })}#comms-lab`
    );
  }
}
