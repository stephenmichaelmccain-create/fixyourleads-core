"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { enqueueReviewRequestTest } from '@/services/reviews';

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value || '').trim();
  return text || null;
}

export async function sendReviewAutomationTestAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  const contactPhone = String(formData.get('contactPhone') || '').trim();
  const contactName = optionalText(formData.get('contactName'));

  if (!companyId || !contactPhone) {
    redirect(`/clients/${companyId}/booking?notice=review-test-failed&detail=company_and_phone_required`);
  }

  try {
    await enqueueReviewRequestTest({
      companyId,
      contactName,
      contactPhone
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'review_test_failed';
    redirect(`/clients/${companyId}/booking?notice=review-test-failed&detail=${encodeURIComponent(detail)}`);
  }

  revalidatePath(`/clients/${companyId}`);
  revalidatePath(`/clients/${companyId}/booking`);
  revalidatePath(`/clients/${companyId}/operator`);
  revalidatePath(`/events?companyId=${companyId}`);
  revalidatePath(`/c/${companyId}`);

  redirect(`/clients/${companyId}/booking?notice=review-test-queued`);
}
