"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createAppointmentFlow, resolveAppointmentStartTime } from '@/services/booking';
import { sendOutboundMessage } from '@/services/messaging';

function revalidateConversationPaths(companyId: string, conversationId: string) {
  revalidatePath(`/conversations/${conversationId}`);
  revalidatePath(`/conversations?companyId=${companyId}`);
  revalidatePath(`/events?companyId=${companyId}`);
  revalidatePath(`/leads?companyId=${companyId}`);
}

function conversationRedirectPath(conversationId: string, values: Record<string, string | null | undefined>) {
  const params = new URLSearchParams();

  Object.entries(values).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });

  const search = params.toString();
  return search ? `/conversations/${conversationId}?${search}` : `/conversations/${conversationId}`;
}

export async function sendConversationMessageAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  const contactId = String(formData.get('contactId') || '').trim();
  const conversationId = String(formData.get('conversationId') || '').trim();
  const text = String(formData.get('text') || '').trim();

  if (!companyId || !contactId || !conversationId || !text) {
    throw new Error('companyId_contactId_conversationId_text_required');
  }

  try {
    const result = await sendOutboundMessage(companyId, contactId, text);
    revalidateConversationPaths(companyId, conversationId);
    redirect(
      conversationRedirectPath(conversationId, {
        send: 'sent',
        detail: result.message.externalId ? 'accepted_by_telnyx' : 'logged_without_external_id'
      })
    );
  } catch (error) {
    redirect(
      conversationRedirectPath(conversationId, {
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

  if (!companyId || !contactId || !conversationId) {
    throw new Error('companyId_contactId_conversationId_required');
  }

  if (!startTimeValue) {
    redirect(conversationRedirectPath(conversationId, {
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

  redirect(conversationRedirectPath(conversationId, redirectValues));
}
