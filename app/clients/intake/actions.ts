"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { normalizeClinicKey } from '@/lib/client-intake';

function readText(formData: FormData, key: string) {
  return String(formData.get(key) || '').trim();
}

export async function createClientFromProspectAction(formData: FormData) {
  const prospectId = readText(formData, 'prospectId');

  if (!prospectId) {
    redirect('/clients/intake');
  }

  const prospect = await db.prospect.findUnique({
    where: { id: prospectId },
    select: {
      id: true,
      name: true,
      notes: true
    }
  });

  if (!prospect) {
    redirect('/clients/intake');
  }

  const normalizedKey = normalizeClinicKey(prospect.name);
  const companies = await db.company.findMany({
    select: {
      id: true,
      name: true
    }
  });
  const existing = companies.find((company) => normalizeClinicKey(company.name) === normalizedKey) || null;

  if (existing) {
    redirect(`/clients/${existing.id}`);
  }

  const company = await db.company.create({
    data: {
      name: prospect.name
    },
    select: { id: true }
  });

  await db.prospect.update({
    where: { id: prospect.id },
    data: {
      notes: [prospect.notes, `Client workspace created: ${new Date().toISOString()}`].filter(Boolean).join('\n')
    }
  });

  revalidatePath('/clients');
  revalidatePath('/clients/intake');
  revalidatePath('/');
  revalidatePath('/our-leads');
  revalidatePath(`/clients/${company.id}`);

  redirect(`/clients/${company.id}?notice=created`);
}
