"use server";

import { revalidatePath } from 'next/cache';
import { createAppointmentFlow } from '@/services/booking';
import { sendOutboundMessage } from '@/services/messaging';

function revalidateConversationPaths(companyId: string, conversationId: string) {
  revalidatePath(`/conversations/${conversationId}`);
  revalidatePath(`/conversations?companyId=${companyId}`);
  revalidatePath(`/events?companyId=${companyId}`);
  revalidatePath(`/leads?companyId=${companyId}`);
}

export async function sendConversationMessageAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  const contactId = String(formData.get('contactId') || '').trim();
  const conversationId = String(formData.get('conversationId') || '').trim();
  const text = String(formData.get('text') || '').trim();

  if (!companyId || !contactId || !conversationId || !text) {
    throw new Error('companyId_contactId_conversationId_text_required');
  }

  await sendOutboundMessage(companyId, contactId, text);
  revalidateConversationPaths(companyId, conversationId);
}

export async function bookConversationAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  const contactId = String(formData.get('contactId') || '').trim();
  const conversationId = String(formData.get('conversationId') || '').trim();
  const startTimeValue = String(formData.get('startTime') || '').trim();

  if (!companyId || !contactId || !conversationId) {
    throw new Error('companyId_contactId_conversationId_required');
  }

  await createAppointmentFlow({
    companyId,
    contactId,
    startTime: startTimeValue ? new Date(startTimeValue) : undefined
  });

  revalidateConversationPaths(companyId, conversationId);
}
