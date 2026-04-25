import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { enqueueLeadCrmSync } from '@/lib/crm-router';
import {
  sendVoiceDemoOwnerNotification,
  sendVoiceDemoProspectNotification
} from '@/lib/notifications';
import { normalizePhone } from '@/lib/phone';
import type { StandardLead } from '@/lib/crm-adapters/types';
import { createLeadFlow } from '@/services/leads';

export type VoiceDemoBookingInput = {
  fullName: string;
  email: string;
  phone: string;
  businessName: string;
  businessType?: string;
  preferredTime?: string;
  reason?: string;
  companyId?: string;
  telnyxAssistantId?: string;
  calledNumber?: string;
  callId?: string;
  transcriptUrl?: string;
  rawPayload?: unknown;
};

type VoiceDemoBookingResult = {
  success: true;
  message: string;
  companyId: string;
  leadId: string;
  contactId: string;
  conversationId: string;
  calendlyUrl: string;
  duplicate: boolean;
  prospectEmailStatus: string;
  ownerEmailStatus: string;
  crmSyncQueued: boolean;
};

function clean(value?: string | null) {
  const cleaned = String(value || '').trim();
  return cleaned || undefined;
}

function configuredCalendlyUrl() {
  return clean(process.env.CALENDLY_DEMO_URL) || clean(process.env.VOICE_DEMO_CALENDLY_URL);
}

function configuredOwnerEmail(companyNotificationEmail?: string | null) {
  return (
    clean(process.env.VOICE_DEMO_OWNER_EMAIL) ||
    clean(process.env.DEFAULT_CLIENT_NOTIFICATION_EMAIL) ||
    clean(companyNotificationEmail) ||
    clean(process.env.NOTIFICATION_FROM_EMAIL) ||
    clean(process.env.SMTP_USER)
  );
}

function appUrl(path: string) {
  const baseUrl = clean(process.env.APP_BASE_URL);

  if (!baseUrl) {
    return undefined;
  }

  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

async function resolveVoiceDemoCompany(input: Pick<VoiceDemoBookingInput, 'companyId' | 'telnyxAssistantId' | 'calledNumber'>) {
  const directCompanyId = clean(input.companyId);

  if (directCompanyId) {
    const company = await db.company.findUnique({ where: { id: directCompanyId } });

    if (company) {
      return company;
    }
  }

  const assistantId = clean(input.telnyxAssistantId);

  if (assistantId) {
    const company = await db.company.findUnique({ where: { telnyxAssistantId: assistantId } });

    if (company) {
      return company;
    }
  }

  const calledNumber = normalizePhone(input.calledNumber || '');

  if (calledNumber) {
    const company = await db.company.findFirst({
      where: {
        OR: [
          { telnyxInboundNumber: calledNumber },
          {
            telnyxInboundNumbers: {
              some: {
                number: calledNumber
              }
            }
          }
        ]
      }
    });

    if (company) {
      return company;
    }
  }

  const configuredCompanyId = clean(process.env.VOICE_DEMO_COMPANY_ID);

  if (configuredCompanyId) {
    const company = await db.company.findUnique({ where: { id: configuredCompanyId } });

    if (company) {
      return company;
    }
  }

  const existing = await db.company.findFirst({
    where: {
      OR: [
        { name: 'Fix Your Leads' },
        { name: 'FixYourLeads' },
        { name: 'Fixyour leads' },
        { website: 'fixyourleads.com' },
        { website: 'https://fixyourleads.com' }
      ]
    },
    orderBy: { createdAt: 'asc' }
  });

  if (existing) {
    return existing;
  }

  return db.company.create({
    data: {
      name: 'Fix Your Leads',
      website: 'fixyourleads.com',
      notificationEmail: configuredOwnerEmail()
    }
  });
}

export async function bookVoiceDemo(input: VoiceDemoBookingInput): Promise<VoiceDemoBookingResult> {
  const calendlyUrl = configuredCalendlyUrl();

  if (!calendlyUrl) {
    throw new Error('calendly_demo_url_missing');
  }

  const company = await resolveVoiceDemoCompany(input);
  const callId = clean(input.callId) || randomUUID();
  const sourceExternalId = `voice-demo:${callId}`;
  const leadResult = await createLeadFlow({
    companyId: company.id,
    phone: input.phone,
    name: input.fullName,
    source: 'voice_demo',
    sourceExternalId
  });

  await db.contact.update({
    where: { id: leadResult.contact.id },
    data: {
      name: input.fullName,
      email: input.email
    }
  });

  const standardLead: StandardLead = {
    full_name: input.fullName,
    email: input.email,
    phone: input.phone,
    business_name: input.businessName,
    source: 'voice_agent',
    call_id: callId,
    transcript_url: input.transcriptUrl,
    notes: [input.reason, input.preferredTime ? `Preferred time: ${input.preferredTime}` : null]
      .filter(Boolean)
      .join('\n'),
    created_at: new Date().toISOString()
  };
  const crmSync = await enqueueLeadCrmSync(company.id, standardLead, {
    leadId: leadResult.lead.id,
    contactId: leadResult.contact.id
  });

  const leadUrl = appUrl(`/conversations/${leadResult.conversation.id}`);
  const ownerEmail = configuredOwnerEmail(company.notificationEmail);
  const [prospectEmail, ownerEmailResult] = await Promise.all([
    sendVoiceDemoProspectNotification({
      to: input.email,
      fullName: input.fullName,
      calendlyUrl
    }),
    sendVoiceDemoOwnerNotification({
      to: ownerEmail,
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      businessName: input.businessName,
      businessType: input.businessType,
      preferredTime: input.preferredTime,
      reason: input.reason,
      calendlyUrl,
      leadUrl
    })
  ]);

  await db.eventLog.create({
    data: {
      companyId: company.id,
      eventType: 'voice_demo_requested',
      payload: {
        leadId: leadResult.lead.id,
        contactId: leadResult.contact.id,
        conversationId: leadResult.conversation.id,
        businessName: input.businessName,
        businessType: input.businessType || null,
        preferredTime: input.preferredTime || null,
        reason: input.reason || null,
        email: input.email,
        phone: input.phone,
        calendlyUrl,
        crmSync,
        standardLead,
        prospectEmail,
        ownerEmail: ownerEmailResult,
        rawPayload: input.rawPayload ?? null
      }
    }
  });

  return {
    success: true,
    message:
      prospectEmail.status === 'sent'
        ? "You're set. Confirmation email coming. Talk soon."
        : "Got your info. We'll reach out within the hour.",
    companyId: company.id,
    leadId: leadResult.lead.id,
    contactId: leadResult.contact.id,
    conversationId: leadResult.conversation.id,
    calendlyUrl,
    duplicate: leadResult.duplicate,
    prospectEmailStatus: prospectEmail.status,
    ownerEmailStatus: ownerEmailResult.status,
    crmSyncQueued: crmSync.queued
  };
}
