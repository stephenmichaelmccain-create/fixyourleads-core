import { AssistantArtifactStatus, AssistantBuildStatus, AssistantMetricWindow, Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getAssistantBuilderQueue } from '@/lib/queue';

const DEFAULT_MODEL = 'gpt-5.4-mini';

type ArtifactDraft = {
  systemPrompt: string;
  callFlow: string[];
  qualificationLogic: string[];
  fallbackRules: string[];
  postCallOutputSchema: Record<string, unknown>;
  testingChecklist: string[];
};

type ValidationCheck = {
  key:
    | 'identity_honesty'
    | 'no_fake_tool_success'
    | 'regulated_advice_boundaries'
    | 'high_stakes_verification'
    | 'dnc_handling'
    | 'post_call_schema_valid';
  passed: boolean;
  detail: string;
};

const DEFAULT_BASE_SKILL_CONTENT = {
  role: 'Fix Your Leads booking operator',
  goals: [
    'Help qualified leads schedule appointments quickly.',
    'Avoid misleading claims and protect the customer from risky guidance.',
    'Escalate to human operators whenever policy confidence is low.'
  ],
  callFlowTemplate: [
    'Greeting and identity disclosure',
    'Contact and intent confirmation',
    'Qualification questions',
    'Booking options and confirmation',
    'Wrap-up with next-step summary'
  ],
  hardRules: [
    'Always disclose this is an AI assistant.',
    'Never claim tool actions succeeded without confirmation.',
    'Do not provide regulated advice.',
    'Verify all high-stakes data before any write action.',
    'Honor do-not-contact requests immediately.'
  ]
};

const DEFAULT_VALIDATION_RULES = {
  requiredChecks: [
    'identity_honesty',
    'no_fake_tool_success',
    'regulated_advice_boundaries',
    'high_stakes_verification',
    'dnc_handling',
    'post_call_schema_valid'
  ],
  minimumSchemaFields: ['callOutcome', 'leadQualified', 'nextAction', 'escalationReason']
};

function asJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function ensureString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function ensureBaseSkillVersion(seedActor = 'system') {
  const latest = await db.globalAssistantSkillVersion.findFirst({
    orderBy: { version: 'desc' }
  });

  if (latest) {
    return latest;
  }

  return db.globalAssistantSkillVersion.create({
    data: {
      version: 1,
      name: 'Base Skill',
      content: toPrismaJson(DEFAULT_BASE_SKILL_CONTENT),
      validationRules: toPrismaJson(DEFAULT_VALIDATION_RULES),
      createdBy: seedActor
    }
  });
}

export async function createClientOverrideVersion(input: {
  companyId: string;
  actor: string;
  notes?: string | null;
  overridePayload: Record<string, unknown>;
}) {
  const latest = await db.clientAssistantOverrideVersion.findFirst({
    where: { companyId: input.companyId },
    orderBy: { version: 'desc' },
    select: { version: true }
  });

  const nextVersion = (latest?.version || 0) + 1;

  return db.clientAssistantOverrideVersion.create({
    data: {
      companyId: input.companyId,
      version: nextVersion,
      createdBy: input.actor,
      notes: input.notes || null,
      overridePayload: toPrismaJson(input.overridePayload)
    }
  });
}

export async function createMetricSnapshot(input: {
  companyId: string;
  artifactVersionId: string;
  window: AssistantMetricWindow;
  bookingRate?: number | null;
  qualificationAccuracy?: number | null;
  escalationRate?: number | null;
  latencyPerceptionScore?: number | null;
  complianceFlags?: number | null;
  sampleSize?: number | null;
  notes?: string | null;
}) {
  return db.assistantArtifactMetricSnapshot.create({
    data: {
      companyId: input.companyId,
      artifactVersionId: input.artifactVersionId,
      window: input.window,
      bookingRate: input.bookingRate ?? null,
      qualificationAccuracy: input.qualificationAccuracy ?? null,
      escalationRate: input.escalationRate ?? null,
      latencyPerceptionScore: input.latencyPerceptionScore ?? null,
      complianceFlags: input.complianceFlags ?? null,
      sampleSize: input.sampleSize ?? null,
      notes: input.notes || null
    }
  });
}

function buildFallbackDraft(company: { name: string; website: string | null }, overridePayload: Record<string, unknown>): ArtifactDraft {
  const qualifier = asStringArray(overridePayload.qualificationCriteria);
  const escalationContacts = asStringArray(overridePayload.escalationContacts);

  return {
    systemPrompt: `You are the AI booking operator for ${company.name}. Always disclose you are an AI assistant. Never claim a tool action succeeded unless the tool confirms success. Do not provide legal, medical, or financial advice. Before any write action, verify high-stakes details (date, time, contact, and service) with the customer. If the customer requests removal or do-not-contact, confirm and stop outreach immediately.`,
    callFlow: [
      'Open call, disclose AI identity, and ask permission to continue.',
      'Confirm lead intent and collect context needed for qualification.',
      'Ask concise qualification questions and summarize answers back.',
      'Offer appointment windows and confirm final booking details.',
      'Send confirmation summary and explain escalation path when needed.'
    ],
    qualificationLogic: qualifier.length > 0
      ? qualifier
      : ['Service need matches client offer', 'Lead has decision-maker availability', 'Timeline is actionable within 30 days'],
    fallbackRules: [
      'Escalate immediately if confidence is low or caller asks for a human.',
      'Escalate for billing, legal, medical, or policy disputes.',
      `Escalation contacts: ${escalationContacts.join(', ') || 'Use default operator escalation channel.'}`
    ],
    postCallOutputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        callOutcome: { type: 'string' },
        leadQualified: { type: 'boolean' },
        nextAction: { type: 'string' },
        escalationReason: { type: 'string' },
        bookingRequest: {
          type: 'object',
          additionalProperties: false,
          properties: {
            requestedDateTime: { type: 'string' },
            timezone: { type: 'string' }
          },
          required: ['requestedDateTime', 'timezone']
        }
      },
      required: ['callOutcome', 'leadQualified', 'nextAction', 'escalationReason', 'bookingRequest']
    },
    testingChecklist: [
      'Identity disclosure spoken before qualification.',
      'DNC/removal phrase triggers immediate suppression confirmation.',
      'Tool failure branch does not claim success.',
      'High-stakes writes require customer readback verification.',
      `Booking result payload can be parsed and stored for ${company.website || company.name}.`
    ]
  };
}

function buildGenerationPrompt(input: {
  company: { name: string; website: string | null; primaryContactName: string | null };
  baseSkillContent: Record<string, unknown>;
  clientOverridePayload: Record<string, unknown>;
}) {
  return [
    `Company: ${input.company.name}`,
    `Website: ${input.company.website || 'n/a'}`,
    `Primary contact: ${input.company.primaryContactName || 'n/a'}`,
    '',
    'Base skill (JSON):',
    JSON.stringify(input.baseSkillContent, null, 2),
    '',
    'Client overrides (JSON):',
    JSON.stringify(input.clientOverridePayload, null, 2),
    '',
    'Generate booking-assistant artifacts with these constraints:',
    '1) Identity honesty: explicit AI disclosure.',
    '2) Never fake tool success.',
    '3) Regulated advice boundaries (no legal/medical/financial advice).',
    '4) Verify high-stakes data before write actions.',
    '5) Handle do-not-contact and removal requests immediately.',
    '6) Provide a strict post-call JSON schema for parsing.'
  ].join('\n');
}

async function generateWithOpenAI(model: string, prompt: string) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: 'Return only valid JSON that matches the provided schema.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'assistant_artifact_draft',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              systemPrompt: { type: 'string' },
              callFlow: {
                type: 'array',
                items: { type: 'string' }
              },
              qualificationLogic: {
                type: 'array',
                items: { type: 'string' }
              },
              fallbackRules: {
                type: 'array',
                items: { type: 'string' }
              },
              postCallOutputSchema: {
                type: 'object',
                additionalProperties: true
              },
              testingChecklist: {
                type: 'array',
                items: { type: 'string' }
              }
            },
            required: [
              'systemPrompt',
              'callFlow',
              'qualificationLogic',
              'fallbackRules',
              'postCallOutputSchema',
              'testingChecklist'
            ]
          }
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`openai_generation_failed_${response.status}`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = asJsonObject(first?.message);
  const content = message.content;

  if (typeof content === 'string') {
    return asJsonObject(JSON.parse(content));
  }

  if (Array.isArray(content)) {
    const textPart = content.find((item) => asJsonObject(item).type === 'text');
    const text = ensureString(asJsonObject(textPart).text, '');
    if (text) {
      return asJsonObject(JSON.parse(text));
    }
  }

  throw new Error('openai_response_unreadable');
}

function validatePostCallSchema(schema: Record<string, unknown>) {
  if (schema.type !== 'object') {
    return false;
  }
  const properties = asJsonObject(schema.properties);
  const required = schema.required;
  if (Object.keys(properties).length === 0 || !Array.isArray(required)) {
    return false;
  }
  return required.every((field) => typeof field === 'string' && field in properties);
}

export function validateArtifactDraft(draft: ArtifactDraft) {
  const checks: ValidationCheck[] = [];
  const prompt = draft.systemPrompt.toLowerCase();
  const fallbackText = draft.fallbackRules.join(' ').toLowerCase();

  checks.push({
    key: 'identity_honesty',
    passed: prompt.includes('ai assistant'),
    detail: 'System prompt must disclose AI identity.'
  });
  checks.push({
    key: 'no_fake_tool_success',
    passed: prompt.includes('never claim') && prompt.includes('tool'),
    detail: 'System prompt must forbid fake tool-success claims.'
  });
  checks.push({
    key: 'regulated_advice_boundaries',
    passed: prompt.includes('legal') && prompt.includes('medical') && prompt.includes('financial'),
    detail: 'System prompt must block regulated advice.'
  });
  checks.push({
    key: 'high_stakes_verification',
    passed: prompt.includes('verify') && prompt.includes('write action'),
    detail: 'System prompt must require verification before write actions.'
  });
  checks.push({
    key: 'dnc_handling',
    passed: prompt.includes('do-not-contact') || prompt.includes('removal') || fallbackText.includes('do-not-contact'),
    detail: 'Prompt or fallback rules must define DNC/removal handling.'
  });
  checks.push({
    key: 'post_call_schema_valid',
    passed: validatePostCallSchema(draft.postCallOutputSchema),
    detail: 'Post-call output schema must be a valid object schema with required fields.'
  });

  return {
    passed: checks.every((check) => check.passed),
    checks
  };
}

function normalizeDraft(input: Record<string, unknown>, fallbackDraft: ArtifactDraft): ArtifactDraft {
  return {
    systemPrompt: ensureString(input.systemPrompt, fallbackDraft.systemPrompt),
    callFlow: asStringArray(input.callFlow).length > 0 ? asStringArray(input.callFlow) : fallbackDraft.callFlow,
    qualificationLogic:
      asStringArray(input.qualificationLogic).length > 0 ? asStringArray(input.qualificationLogic) : fallbackDraft.qualificationLogic,
    fallbackRules: asStringArray(input.fallbackRules).length > 0 ? asStringArray(input.fallbackRules) : fallbackDraft.fallbackRules,
    postCallOutputSchema: {
      ...fallbackDraft.postCallOutputSchema,
      ...asJsonObject(input.postCallOutputSchema)
    },
    testingChecklist:
      asStringArray(input.testingChecklist).length > 0 ? asStringArray(input.testingChecklist) : fallbackDraft.testingChecklist
  };
}

export async function queueAssistantDraftBuild(input: {
  companyId: string;
  requestedBy: string;
  model?: string | null;
}) {
  const company = await db.company.findUnique({
    where: { id: input.companyId },
    select: {
      id: true,
      name: true,
      website: true,
      primaryContactName: true
    }
  });

  if (!company) {
    throw new Error('company_not_found');
  }

  const baseSkillVersion = await ensureBaseSkillVersion(input.requestedBy || 'system');
  const latestOverride = await db.clientAssistantOverrideVersion.findFirst({
    where: { companyId: input.companyId },
    orderBy: { version: 'desc' }
  });

  const buildRun = await db.assistantBuildRun.create({
    data: {
      companyId: input.companyId,
      baseSkillVersionId: baseSkillVersion.id,
      clientOverrideVersionId: latestOverride?.id || null,
      requestedBy: input.requestedBy,
      status: AssistantBuildStatus.QUEUED,
      model: input.model?.trim() || DEFAULT_MODEL,
      inputPayload: toPrismaJson({
        company,
        baseSkillVersion: baseSkillVersion.version,
        overrideVersion: latestOverride?.version || null
      })
    }
  });

  await getAssistantBuilderQueue().add(
    'assistant_builder_generate',
    {
      buildRunId: buildRun.id
    },
    {
      attempts: 2,
      removeOnComplete: 50,
      removeOnFail: 50
    }
  );

  await db.eventLog.create({
    data: {
      companyId: input.companyId,
      eventType: 'assistant_builder_queued',
      payload: {
        buildRunId: buildRun.id,
        baseSkillVersion: baseSkillVersion.version,
        overrideVersion: latestOverride?.version || null,
        model: buildRun.model
      }
    }
  });

  return buildRun;
}

export async function processAssistantBuildRun(buildRunId: string) {
  const buildRun = await db.assistantBuildRun.findUnique({
    where: { id: buildRunId },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          website: true,
          primaryContactName: true
        }
      },
      baseSkillVersion: true,
      clientOverrideVersion: true
    }
  });

  if (!buildRun) {
    return null;
  }

  await db.assistantBuildRun.update({
    where: { id: buildRun.id },
    data: {
      status: AssistantBuildStatus.RUNNING,
      startedAt: new Date()
    }
  });

  const company = buildRun.company;
  const baseSkillContent = asJsonObject(buildRun.baseSkillVersion.content);
  const overridePayload = asJsonObject(buildRun.clientOverrideVersion?.overridePayload);
  const fallbackDraft = buildFallbackDraft(company, overridePayload);
  const prompt = buildGenerationPrompt({
    company,
    baseSkillContent,
    clientOverridePayload: overridePayload
  });

  let rawOutput: Record<string, unknown> | null = null;
  let generationSource = 'fallback_template';

  try {
    const generated = await generateWithOpenAI(buildRun.model, prompt);
    if (generated) {
      rawOutput = generated;
      generationSource = 'openai';
    }
  } catch (error) {
    rawOutput = {
      generationError: error instanceof Error ? error.message : 'unknown_generation_error'
    };
  }

  const normalizedDraft = normalizeDraft(rawOutput || {}, fallbackDraft);
  const validation = validateArtifactDraft(normalizedDraft);

  if (!validation.passed) {
    await db.assistantBuildRun.update({
      where: { id: buildRun.id },
      data: {
        status: AssistantBuildStatus.FAILED,
        completedAt: new Date(),
        outputPayload: toPrismaJson({
          source: generationSource,
          raw: rawOutput,
          draft: normalizedDraft
        }),
        validationPayload: toPrismaJson(validation),
        errorMessage: 'hard_rule_validation_failed'
      }
    });

    await db.eventLog.create({
      data: {
        companyId: buildRun.companyId,
        eventType: 'assistant_builder_validation_failed',
        payload: {
          buildRunId: buildRun.id,
          checks: validation.checks
        }
      }
    });

    return null;
  }

  const latestArtifact = await db.assistantArtifactVersion.findFirst({
    where: { companyId: buildRun.companyId },
    orderBy: { version: 'desc' },
    select: { version: true }
  });
  const nextVersion = (latestArtifact?.version || 0) + 1;

  const artifact = await db.assistantArtifactVersion.create({
    data: {
      companyId: buildRun.companyId,
      buildRunId: buildRun.id,
      baseSkillVersionId: buildRun.baseSkillVersionId,
      clientOverrideVersionId: buildRun.clientOverrideVersionId,
      version: nextVersion,
      status: AssistantArtifactStatus.NEEDS_REVIEW,
      systemPrompt: normalizedDraft.systemPrompt,
      callFlow: toPrismaJson(normalizedDraft.callFlow),
      qualificationLogic: toPrismaJson(normalizedDraft.qualificationLogic),
      fallbackRules: toPrismaJson(normalizedDraft.fallbackRules),
      postCallOutputSchema: toPrismaJson(normalizedDraft.postCallOutputSchema),
      testingChecklist: toPrismaJson(normalizedDraft.testingChecklist),
      validationPayload: toPrismaJson(validation)
    }
  });

  await db.assistantBuildRun.update({
    where: { id: buildRun.id },
    data: {
      status: AssistantBuildStatus.NEEDS_REVIEW,
      completedAt: new Date(),
      outputPayload: toPrismaJson({
        source: generationSource,
        raw: rawOutput,
        draft: normalizedDraft,
        artifactVersion: nextVersion
      }),
      validationPayload: toPrismaJson(validation)
    }
  });

  await db.eventLog.create({
    data: {
      companyId: buildRun.companyId,
      eventType: 'assistant_builder_draft_ready',
      payload: {
        buildRunId: buildRun.id,
        artifactVersionId: artifact.id,
        artifactVersion: artifact.version,
        source: generationSource
      }
    }
  });

  return artifact;
}

export async function approveAssistantArtifact(input: {
  companyId: string;
  artifactVersionId: string;
  actor: string;
}) {
  const artifact = await db.assistantArtifactVersion.findFirst({
    where: {
      id: input.artifactVersionId,
      companyId: input.companyId
    },
    select: { id: true, status: true, buildRunId: true, version: true }
  });

  if (!artifact) {
    throw new Error('artifact_not_found');
  }

  if (artifact.status !== AssistantArtifactStatus.NEEDS_REVIEW) {
    return artifact;
  }

  await db.$transaction([
    db.assistantArtifactVersion.update({
      where: { id: artifact.id },
      data: {
        status: AssistantArtifactStatus.APPROVED,
        approvedAt: new Date(),
        approvedBy: input.actor
      }
    }),
    db.assistantBuildRun.update({
      where: { id: artifact.buildRunId },
      data: {
        status: AssistantBuildStatus.APPROVED
      }
    }),
    db.eventLog.create({
      data: {
        companyId: input.companyId,
        eventType: 'assistant_builder_approved',
        payload: {
          artifactVersionId: artifact.id,
          artifactVersion: artifact.version,
          actor: input.actor
        }
      }
    })
  ]);

  return artifact;
}

export async function publishAssistantArtifact(input: {
  companyId: string;
  artifactVersionId: string;
  actor: string;
}) {
  const artifact = await db.assistantArtifactVersion.findFirst({
    where: {
      id: input.artifactVersionId,
      companyId: input.companyId
    },
    select: { id: true, status: true, version: true, buildRunId: true }
  });

  if (!artifact) {
    throw new Error('artifact_not_found');
  }

  if (artifact.status !== AssistantArtifactStatus.APPROVED && artifact.status !== AssistantArtifactStatus.PUBLISHED) {
    throw new Error('artifact_not_approved');
  }

  await db.$transaction([
    db.assistantArtifactVersion.updateMany({
      where: {
        companyId: input.companyId,
        status: AssistantArtifactStatus.PUBLISHED,
        NOT: { id: artifact.id }
      },
      data: {
        status: AssistantArtifactStatus.ARCHIVED
      }
    }),
    db.assistantArtifactVersion.update({
      where: { id: artifact.id },
      data: {
        status: AssistantArtifactStatus.PUBLISHED,
        publishedAt: new Date(),
        publishedBy: input.actor
      }
    }),
    db.assistantBuildRun.update({
      where: { id: artifact.buildRunId },
      data: {
        status: AssistantBuildStatus.PUBLISHED
      }
    }),
    db.eventLog.create({
      data: {
        companyId: input.companyId,
        eventType: 'assistant_builder_published',
        payload: {
          artifactVersionId: artifact.id,
          artifactVersion: artifact.version,
          actor: input.actor
        }
      }
    })
  ]);

  return artifact;
}
