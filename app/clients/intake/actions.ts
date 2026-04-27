"use server";

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { findMatchingCompany } from '@/lib/intake-matching';
import { provisionClientAutomation } from '@/services/automation';

function readText(formData: FormData, key: string) {
  return String(formData.get(key) || '').trim();
}

function readPayloadRecord(payload: unknown) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

function payloadString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === 'string' ? value.trim() : '';
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
      notes: true,
      website: true
    }
  });

  if (!prospect) {
    redirect('/clients/intake');
  }

  const existing = await findMatchingCompany({
    clinicName: prospect.name,
    website: prospect.website || undefined
  });

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

export async function approveSignupSubmissionAction(formData: FormData) {
  const companyId = readText(formData, 'companyId');
  const signupEventId = readText(formData, 'signupEventId');

  if (!companyId) {
    redirect('/clients/intake');
  }

  const [company, signupEvent, existingApproval] = await Promise.all([
    db.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        website: true,
        notificationEmail: true,
        primaryContactName: true,
        primaryContactEmail: true,
        primaryContactPhone: true
      }
    }),
    signupEventId
      ? db.eventLog.findFirst({
          where: {
            id: signupEventId,
            companyId,
            eventType: 'client_signup_received'
          },
          select: {
            id: true,
            payload: true
          }
        })
      : null,
    db.eventLog.findFirst({
      where: {
        companyId,
        eventType: 'client_signup_approved'
      },
      select: { id: true }
    })
  ]);

  if (!company) {
    redirect('/clients/intake');
  }

  const payload = readPayloadRecord(signupEvent?.payload);
  const contactName = payloadString(payload, 'contactName');
  const notificationEmail = payloadString(payload, 'notificationEmail');
  const phone = payloadString(payload, 'phone');
  const website = payloadString(payload, 'website');

  await db.company.update({
    where: { id: companyId },
    data: {
      website: website || company.website || null,
      notificationEmail: notificationEmail || company.notificationEmail || null,
      primaryContactName: contactName || company.primaryContactName || null,
      primaryContactEmail: notificationEmail || company.primaryContactEmail || null,
      primaryContactPhone: phone || company.primaryContactPhone || null
    }
  });

  if (!existingApproval) {
    const approvedAt = new Date().toISOString();

    await db.eventLog.create({
      data: {
        companyId,
        eventType: 'client_signup_approved',
        payload: {
          companyId,
          signupEventId: signupEvent?.id || null,
          contactName: contactName || null,
          notificationEmail: notificationEmail || null,
          phone: phone || null,
          website: website || null,
          approvedAt
        }
      }
    });
  }

  await provisionClientAutomation(companyId, 'signup_approval');

  revalidatePath('/clients');
  revalidatePath('/clients/intake');
  revalidatePath('/');
  revalidatePath(`/clients/${companyId}`);
  revalidatePath(`/clients/${companyId}/workflow`);
  revalidatePath(`/clients/${companyId}/n8n`);
  revalidatePath('/diagnostics/voice');

  redirect('/clients?notice=approved');
}
