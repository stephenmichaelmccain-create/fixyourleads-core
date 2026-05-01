"use server";

import { AssistantMetricWindow } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import {
  approveAssistantArtifact,
  createClientOverrideVersion,
  createMetricSnapshot,
  publishAssistantArtifact,
  queueAssistantDraftBuild
} from '@/lib/assistant-builder';

function builderPath(companyId: string, params: Record<string, string | null | undefined> = {}) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (!value) {
      continue;
    }
    query.set(key, value);
  }

  const search = query.toString();
  return search ? `/clients/${companyId}/assistant-builder?${search}` : `/clients/${companyId}/assistant-builder`;
}

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value || '').trim();
  return text || null;
}

function payloadText(payload: unknown, key: string) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return '';
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

function splitLines(value: string | null) {
  if (!value) {
    return [];
  }

  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function toPercentValue(value: string | null) {
  if (!value) {
    return null;
  }
  const parsed = Number(value.replace('%', '').trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function revalidateBuilder(companyId: string) {
  revalidatePath(`/clients/${companyId}`);
  revalidatePath(`/clients/${companyId}/assistant-builder`);
  revalidatePath(`/clients/${companyId}/live-log`);
  revalidatePath(`/clients/${companyId}/workflow`);
  revalidatePath(`/events?companyId=${companyId}`);
}

export async function saveClientAssistantOverrideAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  if (!companyId) {
    throw new Error('company_id_required');
  }

  const notes = optionalText(formData.get('notes'));
  const payload = {
    businessContext: optionalText(formData.get('businessContext')),
    toneGuidelines: optionalText(formData.get('toneGuidelines')),
    customCallFlowFocus: optionalText(formData.get('customCallFlowFocus')),
    qualificationCriteria: splitLines(optionalText(formData.get('qualificationCriteria'))),
    disallowedClaims: splitLines(optionalText(formData.get('disallowedClaims'))),
    escalationContacts: splitLines(optionalText(formData.get('escalationContacts')))
  };

  await createClientOverrideVersion({
    companyId,
    actor: 'operator',
    notes,
    overridePayload: payload
  });

  revalidateBuilder(companyId);
  redirect(builderPath(companyId, { notice: 'override_saved' }));
}

export async function generateAssistantDraftAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  if (!companyId) {
    throw new Error('company_id_required');
  }

  const model = optionalText(formData.get('model'));
  const run = await queueAssistantDraftBuild({
    companyId,
    requestedBy: 'operator',
    model
  });

  revalidateBuilder(companyId);
  redirect(builderPath(companyId, { notice: 'draft_queued', runId: run.id }));
}

export async function approveAssistantDraftAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  const artifactVersionId = String(formData.get('artifactVersionId') || '').trim();

  if (!companyId || !artifactVersionId) {
    throw new Error('company_id_and_artifact_version_id_required');
  }

  await approveAssistantArtifact({
    companyId,
    artifactVersionId,
    actor: 'operator'
  });

  revalidateBuilder(companyId);
  redirect(builderPath(companyId, { notice: 'draft_approved' }));
}

export async function publishAssistantDraftAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  const artifactVersionId = String(formData.get('artifactVersionId') || '').trim();

  if (!companyId || !artifactVersionId) {
    throw new Error('company_id_and_artifact_version_id_required');
  }

  await publishAssistantArtifact({
    companyId,
    artifactVersionId,
    actor: 'operator'
  });

  revalidateBuilder(companyId);
  redirect(builderPath(companyId, { notice: 'draft_published' }));
}

function parseMetricWindow(value: string | null) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === AssistantMetricWindow.LAST_7_DAYS) {
    return AssistantMetricWindow.LAST_7_DAYS;
  }
  if (normalized === AssistantMetricWindow.LAST_30_DAYS) {
    return AssistantMetricWindow.LAST_30_DAYS;
  }
  return AssistantMetricWindow.LIFETIME;
}

function parseInteger(value: string | null) {
  if (!value) {
    return null;
  }
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.round(parsed);
}

export async function saveAssistantMetricSnapshotAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  const artifactVersionId = String(formData.get('artifactVersionId') || '').trim();

  if (!companyId || !artifactVersionId) {
    throw new Error('company_id_and_artifact_version_id_required');
  }

  await createMetricSnapshot({
    companyId,
    artifactVersionId,
    window: parseMetricWindow(optionalText(formData.get('window'))),
    bookingRate: toPercentValue(optionalText(formData.get('bookingRate'))),
    qualificationAccuracy: toPercentValue(optionalText(formData.get('qualificationAccuracy'))),
    escalationRate: toPercentValue(optionalText(formData.get('escalationRate'))),
    latencyPerceptionScore: toPercentValue(optionalText(formData.get('latencyPerceptionScore'))),
    complianceFlags: parseInteger(optionalText(formData.get('complianceFlags'))),
    sampleSize: parseInteger(optionalText(formData.get('sampleSize'))),
    notes: optionalText(formData.get('notes'))
  });

  revalidateBuilder(companyId);
  redirect(builderPath(companyId, { notice: 'metric_saved' }));
}

export async function saveAssistantPromptNotesAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  if (!companyId) {
    throw new Error('company_id_required');
  }

  const notes = optionalText(formData.get('notes')) || '';

  await db.eventLog.create({
    data: {
      companyId,
      eventType: 'assistant_prompt_notes_saved',
      payload: {
        notes,
        savedBy: 'operator',
        source: 'assistant_builder_notes_page'
      }
    }
  });

  revalidateBuilder(companyId);
  redirect(builderPath(companyId, { notice: 'notes_saved' }));
}

export async function pullLatestSignupContextAction(formData: FormData) {
  const companyId = String(formData.get('companyId') || '').trim();
  if (!companyId) {
    throw new Error('company_id_required');
  }

  const [company, latestSignupEvent] = await Promise.all([
    db.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        website: true,
        primaryContactName: true,
        primaryContactEmail: true,
        primaryContactPhone: true,
        notificationEmail: true,
        notificationPhone: true
      }
    }),
    db.eventLog.findFirst({
      where: {
        companyId,
        eventType: {
          in: ['client_signup_received', 'client_onboarding_received', 'client_signup_approved']
        }
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        eventType: true,
        payload: true,
        createdAt: true
      }
    })
  ]);

  if (!company) {
    throw new Error('company_not_found');
  }

  if (!latestSignupEvent) {
    revalidateBuilder(companyId);
    redirect(builderPath(companyId, { notice: 'signup_context_missing' }));
  }

  const payload = latestSignupEvent.payload;
  const contextNotes = [
    `# Startup Sequence Prefill`,
    ``,
    `Source event: ${latestSignupEvent.eventType} (${latestSignupEvent.id})`,
    `Captured at: ${latestSignupEvent.createdAt.toISOString()}`,
    ``,
    `## Step 1 - Business + Call Context`,
    `Business name: ${payloadText(payload, 'clinicName') || company.name || '[NEEDS_INPUT]'}`,
    `Industry: [NEEDS_INPUT]`,
    `Service area: [NEEDS_INPUT]`,
    `Call direction: [NEEDS_INPUT]`,
    `Exact call type: [NEEDS_INPUT]`,
    ``,
    `## Signup Contact Snapshot`,
    `Contact name: ${payloadText(payload, 'contactName') || company.primaryContactName || '[NEEDS_INPUT]'}`,
    `Notification email: ${payloadText(payload, 'notificationEmail') || company.notificationEmail || company.primaryContactEmail || '[NEEDS_INPUT]'}`,
    `Phone: ${payloadText(payload, 'phone') || company.notificationPhone || company.primaryContactPhone || '[NEEDS_INPUT]'}`,
    `Website: ${payloadText(payload, 'website') || company.website || '[NEEDS_INPUT]'}`,
    `Signup source: ${payloadText(payload, 'source') || '[NEEDS_INPUT]'}`,
    `Source external ID: ${payloadText(payload, 'sourceExternalId') || '[NEEDS_INPUT]'}`,
    ``,
    `## Next Intake Steps`,
    `- Fill missing Step 1 values`,
    `- Continue with Step 2: Outcomes + Scope`,
    `- Continue with Step 3: Tools + System Actions`
  ].join('\n');

  await db.eventLog.create({
    data: {
      companyId,
      eventType: 'assistant_prompt_notes_saved',
      payload: {
        notes: contextNotes,
        savedBy: 'operator',
        source: 'assistant_builder_signup_context_pull',
        signupEventId: latestSignupEvent.id
      }
    }
  });

  revalidateBuilder(companyId);
  redirect(builderPath(companyId, { notice: 'signup_context_pulled' }));
}
