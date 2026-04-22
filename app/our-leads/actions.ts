"use server";

import { ProspectStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';

const INTERNAL_COMPANY_ID = 'fixyourleads';

function readText(formData: FormData, key: string) {
  return String(formData.get(key) || '').trim();
}

export async function createProspectAction(formData: FormData) {
  const name = readText(formData, 'name');
  const rawPhone = readText(formData, 'phone');
  const city = readText(formData, 'city') || null;
  const website = readText(formData, 'website') || null;
  const ownerName = readText(formData, 'ownerName') || null;
  const notes = readText(formData, 'notes') || null;
  const requestedStatus = readText(formData, 'status');
  const nextActionRaw = readText(formData, 'nextActionAt');

  if (!name) {
    redirect('/our-leads?error=name_required#add-prospect');
  }

  const status = Object.values(ProspectStatus).includes(requestedStatus as ProspectStatus)
    ? (requestedStatus as ProspectStatus)
    : ProspectStatus.NEW;
  const normalizedPhone = rawPhone ? normalizePhone(rawPhone) || rawPhone : null;
  const nextActionAt = nextActionRaw ? new Date(nextActionRaw) : null;

  if (nextActionAt && Number.isNaN(nextActionAt.getTime())) {
    redirect('/our-leads?error=invalid_next_action#add-prospect');
  }

  const prospect = await db.prospect.create({
    data: {
      companyId: INTERNAL_COMPANY_ID,
      name,
      phone: normalizedPhone,
      city,
      website,
      ownerName,
      status,
      nextActionAt,
      notes
    }
  });

  revalidatePath('/our-leads');
  redirect(`/our-leads?prospectId=${encodeURIComponent(prospect.id)}&added=1`);
}
