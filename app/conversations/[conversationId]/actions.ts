"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createAppointmentFlow, resolveAppointmentStartTime } from '@/services/booking';
import { sendOutboundMessage } from '@/services/messaging';

function sanitizeReturnTo(value: string | null | undefined, fallback: string) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }

  if (value.startsWith('/conversations/') || value.startsWith('/clients/')) {
    return value;
  }

  return fallback;
}

function revalidateConversationPaths(companyId: string, conversationId: string) {
  revalidatePath(`/conversations/${conversationId}`);
  revalidatePath(`/conversations?companyId=${companyId}`);
  revalidatePath(`/events?companyId=${companyId}`);
  revalidatePath(`/leads?companyId=${companyId}`);
  revalidatePath(`/clients/${companyId}`);
  revalidatePath(`/clients/${companyId}/operator`);
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

export async function sendConversationMessageAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  const contactId = String(formData.get('contactId') || '').trim();
  const conversationId = String(formData.get('conversationId') || '').trim();
  const text = String(formData.get('text') || '').trim();
  const returnTo = sanitizeReturnTo(
    String(formData.get('returnTo') || '').trim(),
    conversationId ? `/conversations/${conversationId}` : `/clients/${companyId}/operator`
  );

  if (!companyId || !contactId || !text) {
    throw new Error('companyId_contactId_text_required');
  }

  try {
    const result = await sendOutboundMessage(companyId, contactId, text);
    revalidateConversationPaths(companyId, conversationId || result.conversation.id);
    redirect(
      redirectPathWithValues(returnTo, {
        conversationId: returnTo.startsWith('/clients/') ? result.conversation.id : undefined,
        send: 'sent',
        detail: result.message.externalId ? 'accepted_by_telnyx' : 'logged_without_external_id'
      })
    );
  } catch (error) {
    redirect(
      redirectPathWithValues(returnTo, {
        send: 'error',
        detail: error instanceof Error ? error.message : 'send_failed'
      })
    );
  }
}

export async function bookConversationAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  const contactId = String(formData.get('contactId') || '').trim();
  const conversationId = String(formData.get('conversationId') || '').trim();
  const startTimeValue = String(formData.get('startTime') || '').trim();
  const returnTo = sanitizeReturnTo(
    String(formData.get('returnTo') || '').trim(),
    `/conversations/${conversationId}`
  );

  if (!companyId || !contactId || !conversationId) {
    throw new Error('companyId_contactId_conversationId_required');
  }

  if (!startTimeValue) {
    redirect(redirectPathWithValues(returnTo, {
      booking: 'error',
      detail: 'startTime_required'
    }));
  }

  let redirectValues: Record<string, string | null | undefined>;

  try {
    const result = await createAppointmentFlow({
      companyId,
      contactId,
      startTime: resolveAppointmentStartTime(new Date(startTimeValue))
    });

    revalidateConversationPaths(companyId, conversationId);

    redirectValues = {
      booking: result.bookingStatus,
      detail: result.appointment.startTime.toISOString(),
      notification: result.notification.status,
      notificationDetail: result.notification.detail,
      confirmation: result.confirmationStatus,
      confirmationDetail: result.confirmationDetail
    };
  } catch (error) {
    redirectValues = {
      booking: 'error',
      detail: error instanceof Error ? error.message : 'booking_failed'
    };
  }

  redirect(redirectPathWithValues(returnTo, redirectValues));
}
