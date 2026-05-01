import { AssistantArtifactStatus, AssistantBuildStatus, AssistantMetricWindow, Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getAssistantBuilderQueue } from '@/lib/queue';

const DEFAULT_MODEL = 'gpt-5.4-mini';

type ArtifactDraft = {
  systemPrompt: string;
  callFlow: {
    happyPathPhases: Array<{
      phase: string;
      objective: string;
      keySteps: string[];
    }>;
    namedBranches: Array<{
      name: string;
      trigger: string;
      handling: string[];
    }>;
    actionLadder: Array<{
      step: 'ask' | 'verify' | 'confirm' | 'act' | 'wait' | 'escalate';
      rule: string;
    }>;
  };
  qualificationLogic: {
    requiredFields: string[];
    collectionOrder: string[];
    verificationRules: string[];
    qualificationCriteria: string[];
    disqualificationHandling: string[];
    outcomes: string[];
  };
  fallbackRules: {
    uncertainty: string[];
    missingInformation: string[];
    toolFailures: string[];
    frustration: string[];
    regulatedQuestions: string[];
    humanRequests: string[];
    dncRemoval: string[];
    poorConnection: string[];
    escalationTriggers: string[];
    escalationContacts: string[];
  };
  postCallOutputSchema: Record<string, unknown>;
  testingChecklist: {
    launchChecklist: string[];
    diagnosticLayers: string[];
    revisionProtocol: string[];
  };
};

type ValidationCheck = {
  key:
    | 'identity_honesty'
    | 'no_fake_tool_success'
    | 'regulated_advice_boundaries'
    | 'high_stakes_verification'
    | 'dnc_handling'
    | 'post_call_schema_valid'
    | 'action_ladder_present'
    | 'system_prompt_architecture'
    | 'voice_quality_coverage';
  passed: boolean;
  detail: string;
};

const ACTION_LADDER_STEPS = ['ask', 'verify', 'confirm', 'act', 'wait', 'escalate'] as const;

const DEFAULT_DIAGNOSTIC_LAYERS = [
  'transcription',
  'prompt',
  'runtime context',
  'tool use',
  'model behavior',
  'voice output',
  'latency',
  'conversation design',
  'evaluation process'
];

const DEFAULT_VOICE_QUALITY_DIMENSIONS = ['clarity', 'naturalness', 'responsiveness', 'control', 'goal-orientation', 'recovery'];

const DEFAULT_BASE_SKILL_CONTENT = {
  role: 'Fix Your Leads booking operator',
  workflow: 'Telnyx AI voice booking operator',
  instructionLayers: ['system prompt', 'developer instructions', 'task prompts', 'runtime context', 'tools', 'memory'],
  qualityDimensions: DEFAULT_VOICE_QUALITY_DIMENSIONS,
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
    'Honor do-not-contact requests immediately.',
    'Use the explicit action ladder: ask, verify, confirm, act, wait, escalate.'
  ]
};

const DEFAULT_VALIDATION_RULES = {
  requiredChecks: [
    'identity_honesty',
    'no_fake_tool_success',
    'regulated_advice_boundaries',
    'high_stakes_verification',
    'dnc_handling',
    'post_call_schema_valid',
    'action_ladder_present',
    'system_prompt_architecture',
    'voice_quality_coverage'
  ],
  minimumSchemaFields: ['call_id', 'caller', 'lead', 'outcome', 'data_verified', 'flags']
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

function asStringRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => asJsonObject(item)).filter((item) => Object.keys(item).length > 0);
}

function buildDefaultPostCallSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      call_id: { type: 'string' },
      timestamp: { type: 'string' },
      direction: { type: 'string', enum: ['inbound', 'outbound'] },
      duration_seconds: { type: 'integer' },
      agent_version: { type: 'string' },
      business_name: { type: 'string' },
      agent_role: { type: 'string' },
      specific_call_type: { type: 'string' },
      lead_source: { type: ['string', 'null'] },
      caller: {
        type: 'object',
        additionalProperties: true,
        properties: {
          name: { type: ['string', 'null'] },
          phone: { type: 'string' },
          email: { type: ['string', 'null'] },
          address: { type: ['string', 'null'] }
        },
        required: ['phone']
      },
      lead: {
        type: 'object',
        additionalProperties: true,
        properties: {
          type: { type: ['string', 'null'] },
          service_requested: { type: ['string', 'null'] },
          urgency: { type: 'string' },
          in_service_area: { type: ['boolean', 'string'] },
          qualified: { type: ['boolean', 'string'] },
          qualification_reason: { type: ['string', 'null'] },
          disqualification_reason: { type: ['string', 'null'] }
        }
      },
      outcome: {
        type: 'object',
        additionalProperties: true,
        properties: {
          result: { type: 'string' },
          appointment_datetime: { type: ['string', 'null'] },
          appointment_type: { type: ['string', 'null'] },
          escalation_reason: { type: ['string', 'null'] },
          next_action: { type: 'string' },
          next_action_owner: { type: 'string' },
          follow_up_deadline: { type: ['string', 'null'] },
          needs_human_review: { type: 'boolean' }
        },
        required: ['result', 'next_action', 'next_action_owner', 'needs_human_review']
      },
      data_verified: {
        type: 'object',
        additionalProperties: true,
        properties: {
          phone_verified: { type: 'boolean' },
          email_verified: { type: 'boolean' },
          address_verified: { type: 'boolean' },
          appointment_confirmed: { type: 'boolean' }
        }
      },
      objections_raised: {
        type: 'array',
        items: { type: 'string' }
      },
      transfer: {
        type: 'object',
        additionalProperties: true,
        properties: {
          requested: { type: 'boolean' },
          completed: { type: 'boolean' }
        }
      },
      crm_fields: {
        type: 'object',
        additionalProperties: true
      },
      call_notes: { type: 'string' },
      flags: {
        type: 'object',
        additionalProperties: true,
        properties: {
          compliance: { type: 'string' },
          audio_quality: { type: 'string' },
          sentiment: { type: 'string' },
          repeat_caller: { type: ['boolean', 'string'] },
          escalation_required: { type: 'boolean' },
          pricing_requested: { type: 'boolean' },
          human_requested: { type: 'boolean' },
          urgent_flag: { type: 'boolean' }
        }
      }
    },
    required: ['call_id', 'timestamp', 'direction', 'caller', 'lead', 'outcome', 'data_verified', 'flags']
  };
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
  const disallowedClaims = asStringArray(overridePayload.disallowedClaims);
  const customFlowFocus = ensureString(overridePayload.customCallFlowFocus, '');
  const businessContext = ensureString(overridePayload.businessContext, '');
  const toneGuidelines = ensureString(overridePayload.toneGuidelines, 'warm, calm, professional, low-pressure');

  return {
    systemPrompt: [
      `ROLE`,
      `You are the AI booking operator for ${company.name}. You are an AI assistant and never claim to be human.`,
      '',
      `GOAL`,
      `Handle lead qualification and booking calls with clear spoken language, accurate tool use, and compliant escalation.`,
      '',
      `PRIORITIES`,
      `1. Caller safety and compliance.`,
      `2. Data accuracy over speed.`,
      `3. Scope discipline over improvisation.`,
      '',
      `HARD RULES`,
      `- Never claim to be human.`,
      `- Never claim a tool succeeded without tool evidence.`,
      `- Never provide legal, medical, or financial advice.`,
      `- Always verify high-stakes fields before write actions.`,
      `- Always honor do-not-call and removal requests immediately.`,
      `- Never promise outcomes the system cannot verify.`,
      ...(disallowedClaims.length > 0 ? disallowedClaims.map((line) => `- ${line}`) : []),
      '',
      `BOUNDARIES`,
      `- Do not provide legal, medical, financial, or other regulated advice.`,
      `- Do not promise pricing, coverage, or outcomes that cannot be verified.`,
      `- Escalate out-of-scope requests to a human owner.`,
      '',
      `TONE`,
      toneGuidelines,
      '',
      `DEVELOPER INSTRUCTIONS`,
      `- Keep routine turns to one or two sentences.`,
      `- Ask one question at a time when possible.`,
      `- Never mention internal tool names to callers.`,
      '',
      `TASK PROMPT`,
      `${customFlowFocus || 'Prioritize qualification and booking completion with minimal friction.'}`,
      '',
      `RUNTIME CONTEXT`,
      `Use only provided caller facts, conversation memory, and tool outputs for factual claims.`,
      '',
      `TOOLS`,
      `Use lookup tools before writes when context is uncertain. Confirm before write actions.`,
      '',
      `MEMORY`,
      `Retain caller-provided details within the call and avoid re-asking already confirmed fields.`,
      '',
      `BUSINESS CONTEXT`,
      businessContext || `${company.name}${company.website ? ` (${company.website})` : ''}`,
      '',
      `FALLBACK`,
      `If uncertain after one clarification, escalate. If tool call fails, state failure plainly and route to human follow-up.`,
      '',
      `EXAMPLES`,
      `Caller: "Can you move my appointment?"`,
      `Assistant: "Absolutely. Let me confirm your current appointment first, then I'll check options."`,
      '',
      `Caller: "Are you a real person?"`,
      `Assistant: "I'm an AI assistant for ${company.name}. I can help now, or get a person involved."`,
      '',
      `ACTION LADDER`,
      `ask -> verify -> confirm -> act -> wait -> escalate`
    ].join('\n'),
    callFlow: {
      happyPathPhases: [
        {
          phase: 'Open',
          objective: 'Start safely and disclose AI identity.',
          keySteps: ['Greet caller briefly.', 'Disclose AI assistant identity.', 'Ask permission to continue.']
        },
        {
          phase: 'Establish purpose',
          objective: 'Identify intent and call type quickly.',
          keySteps: ['Confirm caller reason for reaching out.', 'Determine if this is booking, follow-up, or support redirection.']
        },
        {
          phase: 'Collect information',
          objective: 'Gather minimum required fields in low-friction order.',
          keySteps: ['Collect name and callback phone.', 'Collect service details and location when relevant.']
        },
        {
          phase: 'Qualify or check',
          objective: 'Determine qualified status and risk flags.',
          keySteps: ['Run qualification criteria.', 'Verify high-stakes data before any write action.']
        },
        {
          phase: 'Convert',
          objective: 'Book or capture next action.',
          keySteps: ['Offer one to three booking options.', 'Confirm selected slot before booking tool write.']
        },
        {
          phase: 'Wrap up',
          objective: 'Close with clear next step and post-call integrity.',
          keySteps: ['Summarize outcome.', 'State confirmation delivery path or escalation owner.']
        }
      ],
      namedBranches: [
        {
          name: 'Emergency escalation',
          trigger: 'Caller describes emergency or unsafe situation.',
          handling: ['Stop routine flow.', 'Advise immediate human escalation.', 'Log urgent flag for follow-up.']
        },
        {
          name: 'Disqualified lead',
          trigger: 'Lead fails qualification criteria.',
          handling: ['Politely close with low-risk language.', 'Avoid detailed disqualification reasoning.', 'Log disqualification reason internally.']
        },
        {
          name: 'Callback requested',
          trigger: 'Caller asks for later follow-up.',
          handling: ['Confirm best callback number and time window.', 'Create follow-up action with owner and deadline.']
        },
        {
          name: 'Tool failure recovery',
          trigger: 'Lookup or write tool fails.',
          handling: ['Do not claim success.', 'Give one short apology.', 'Escalate to human owner with context.']
        },
        {
          name: 'Caller frustration',
          trigger: 'Caller shows repeated frustration or asks to stop.',
          handling: ['Acknowledge briefly.', 'Offer human handoff immediately.']
        },
        {
          name: 'Human-identity question',
          trigger: 'Caller asks whether assistant is a person.',
          handling: ['State AI identity honestly.', 'Offer to continue or transfer to person.']
        },
        {
          name: 'Removal / DNC request',
          trigger: 'Caller asks to be removed or not contacted.',
          handling: ['Confirm request in plain language.', 'Stop outreach flow.', 'Log suppression flag immediately.']
        },
        {
          name: 'Out-of-scope request',
          trigger: 'Caller asks for unsupported tasks or regulated advice.',
          handling: ['State boundary briefly.', 'Escalate to human follow-up.']
        }
      ],
      actionLadder: [
        { step: 'ask', rule: 'Ask when required information is missing.' },
        { step: 'verify', rule: 'Verify high-stakes fields before any write action.' },
        { step: 'confirm', rule: 'Confirm meaningful writes or commitments with caller.' },
        { step: 'act', rule: 'Act only when enough verified data is present.' },
        { step: 'wait', rule: 'During latency, provide a short progress signal.' },
        { step: 'escalate', rule: 'Escalate when blocked, risky, regulated, or requested by caller.' }
      ]
    },
    qualificationLogic: {
      requiredFields: ['full name', 'phone number', 'service requested', 'availability window'],
      collectionOrder: ['name', 'phone', 'address/service area (if needed)', 'service details', 'availability'],
      verificationRules: [
        'Read back phone in grouped digits before message/callback actions.',
        'Read back date and time in natural spoken format before booking writes.',
        'Verify address and city before location-dependent scheduling.'
      ],
      qualificationCriteria:
        qualifier.length > 0
          ? qualifier
          : ['Service need matches client offer', 'Lead has decision-maker availability', 'Timeline is actionable within 30 days'],
      disqualificationHandling: [
        'Use brief, low-pressure closeout language.',
        'Avoid argumentative or detailed rejection language.',
        'Offer safe next step if follow-up is possible.'
      ],
      outcomes: ['qualified_ready', 'qualified_follow_up', 'needs_human_review', 'not_qualified', 'insufficient_information']
    },
    fallbackRules: {
      uncertainty: ['Ask one clarifying question, then escalate if still uncertain.'],
      missingInformation: ['Request only missing required field.', 'If unavailable, capture callback path and escalate.'],
      toolFailures: ['Name the failure plainly without hedging.', 'Never claim success after failure.', 'Escalate with context payload.'],
      frustration: ['Acknowledge emotion briefly.', 'Offer immediate human handoff.'],
      regulatedQuestions: ['Do not provide regulated advice.', 'Route to authorized human follow-up.'],
      humanRequests: ['Transfer or capture callback for human operator immediately.'],
      dncRemoval: ['Confirm removal request.', 'Stop outreach and set suppression flag.'],
      poorConnection: ['Offer to repeat once.', 'If still poor, capture callback and escalate.'],
      escalationTriggers: [
        'Caller asks for a person',
        'Request is out of scope',
        'Regulated advice request',
        'Tool failure blocks approved flow',
        'Persistent uncertainty after one clarification'
      ],
      escalationContacts: escalationContacts.length > 0 ? escalationContacts : ['default_operator_channel']
    },
    postCallOutputSchema: buildDefaultPostCallSchema(),
    testingChecklist: {
      launchChecklist: [
        'AI identity disclosure appears before qualification in all opening variants.',
        'No tool-success language appears unless a success result is present.',
        'DNC/removal intent routes to suppression flow without extra questions.',
        'High-stakes fields are verified before booking or CRM writes.',
        'System prompt includes role, goal, priorities, hard rules, boundaries, fallback, and examples.',
        'Instruction layers are explicitly represented: system prompt, developer instructions, task prompt, runtime context, tools, memory.',
        'Voice quality checks cover clarity, naturalness, responsiveness, control, goal-orientation, and recovery.',
        `Post-call payload parses and stores for ${company.website || company.name}.`
      ],
      diagnosticLayers: DEFAULT_DIAGNOSTIC_LAYERS,
      revisionProtocol: [
        'Diagnose failure with nine-layer model and stop at first explanatory layer.',
        'Apply smallest possible change set (prompt, flow, tool rule, or evaluation).',
        'Run regression checks for identity honesty, tool-truthfulness, and DNC handling.'
      ]
    }
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
    'Generate a full Telnyx voice-agent artifact package as valid JSON.',
    'Required top-level keys: systemPrompt, callFlow, qualificationLogic, fallbackRules, postCallOutputSchema, testingChecklist.',
    'Treat this as a full real-time voice system, not a text chatbot prompt. Build for spoken clarity, turn-taking, and latency perception.',
    'Call flow must include six happy-path phases: Open, Establish purpose, Collect information, Qualify or check, Convert, Wrap up.',
    'Call flow must include named branches for emergency escalation, disqualification, callbacks, tool failures, frustration, human-identity questions, removals, and out-of-scope requests.',
    'Call flow must include action ladder in this order: ask, verify, confirm, act, wait, escalate.',
    'System prompt must follow a master-prompt shell style with sections for ROLE, GOAL, PRIORITIES, HARD RULES, BOUNDARIES, TONE, DEVELOPER INSTRUCTIONS, TASK PROMPT, RUNTIME CONTEXT, TOOLS, MEMORY, FALLBACK, ESCALATION, POST-CALL OUTPUT, EXAMPLES.',
    'Hard-rule constraints (must be explicit): AI identity honesty, no fake tool success, no regulated advice, verify high-stakes data before write actions, immediate DNC/removal handling.',
    'Design for voice-specific quality dimensions: clarity, naturalness, responsiveness, control, goal-orientation, recovery.',
    'Post-call output must be a strict JSON schema object with required top-level fields: call_id, caller, lead, outcome, data_verified, flags.',
    'Testing checklist must include launch checklist and nine diagnostic layers for revision triage.',
    'Testing checklist must include checks for the six voice quality dimensions and at least one latency-perception check.',
    'Use short spoken turns and avoid wall-of-sound responses.'
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
                type: 'object',
                additionalProperties: false,
                properties: {
                  happyPathPhases: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        phase: { type: 'string' },
                        objective: { type: 'string' },
                        keySteps: { type: 'array', items: { type: 'string' } }
                      },
                      required: ['phase', 'objective', 'keySteps']
                    }
                  },
                  namedBranches: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        name: { type: 'string' },
                        trigger: { type: 'string' },
                        handling: { type: 'array', items: { type: 'string' } }
                      },
                      required: ['name', 'trigger', 'handling']
                    }
                  },
                  actionLadder: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        step: { type: 'string', enum: ['ask', 'verify', 'confirm', 'act', 'wait', 'escalate'] },
                        rule: { type: 'string' }
                      },
                      required: ['step', 'rule']
                    }
                  }
                },
                required: ['happyPathPhases', 'namedBranches', 'actionLadder']
              },
              qualificationLogic: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  requiredFields: { type: 'array', items: { type: 'string' } },
                  collectionOrder: { type: 'array', items: { type: 'string' } },
                  verificationRules: { type: 'array', items: { type: 'string' } },
                  qualificationCriteria: { type: 'array', items: { type: 'string' } },
                  disqualificationHandling: { type: 'array', items: { type: 'string' } },
                  outcomes: { type: 'array', items: { type: 'string' } }
                },
                required: [
                  'requiredFields',
                  'collectionOrder',
                  'verificationRules',
                  'qualificationCriteria',
                  'disqualificationHandling',
                  'outcomes'
                ]
              },
              fallbackRules: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  uncertainty: { type: 'array', items: { type: 'string' } },
                  missingInformation: { type: 'array', items: { type: 'string' } },
                  toolFailures: { type: 'array', items: { type: 'string' } },
                  frustration: { type: 'array', items: { type: 'string' } },
                  regulatedQuestions: { type: 'array', items: { type: 'string' } },
                  humanRequests: { type: 'array', items: { type: 'string' } },
                  dncRemoval: { type: 'array', items: { type: 'string' } },
                  poorConnection: { type: 'array', items: { type: 'string' } },
                  escalationTriggers: { type: 'array', items: { type: 'string' } },
                  escalationContacts: { type: 'array', items: { type: 'string' } }
                },
                required: [
                  'uncertainty',
                  'missingInformation',
                  'toolFailures',
                  'frustration',
                  'regulatedQuestions',
                  'humanRequests',
                  'dncRemoval',
                  'poorConnection',
                  'escalationTriggers',
                  'escalationContacts'
                ]
              },
              postCallOutputSchema: {
                type: 'object',
                additionalProperties: true
              },
              testingChecklist: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  launchChecklist: { type: 'array', items: { type: 'string' } },
                  diagnosticLayers: { type: 'array', items: { type: 'string' } },
                  revisionProtocol: { type: 'array', items: { type: 'string' } }
                },
                required: ['launchChecklist', 'diagnosticLayers', 'revisionProtocol']
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
  if (!required.every((field) => typeof field === 'string' && field in properties)) {
    return false;
  }
  const minimumTopLevel = ['call_id', 'caller', 'lead', 'outcome', 'data_verified', 'flags'];
  return minimumTopLevel.every((field) => field in properties);
}

function includesPromptSections(prompt: string, sections: string[]) {
  const normalized = prompt.toLowerCase();
  return sections.every((section) => normalized.includes(section.toLowerCase()));
}

function normalizeCallFlow(input: Record<string, unknown>, fallback: ArtifactDraft['callFlow']) {
  const happyPathPhases = asStringRecordArray(input.happyPathPhases)
    .map((phase) => ({
      phase: ensureString(phase.phase, ''),
      objective: ensureString(phase.objective, ''),
      keySteps: asStringArray(phase.keySteps)
    }))
    .filter((phase) => phase.phase && phase.objective && phase.keySteps.length > 0);

  const namedBranches = asStringRecordArray(input.namedBranches)
    .map((branch) => ({
      name: ensureString(branch.name, ''),
      trigger: ensureString(branch.trigger, ''),
      handling: asStringArray(branch.handling)
    }))
    .filter((branch) => branch.name && branch.trigger && branch.handling.length > 0);

  const actionLadder = asStringRecordArray(input.actionLadder)
    .map((step) => ({
      step: ensureString(step.step, '').toLowerCase(),
      rule: ensureString(step.rule, '')
    }))
    .filter(
      (step): step is ArtifactDraft['callFlow']['actionLadder'][number] =>
        ACTION_LADDER_STEPS.includes(step.step as (typeof ACTION_LADDER_STEPS)[number]) && step.rule.length > 0
    );

  return {
    happyPathPhases: happyPathPhases.length > 0 ? happyPathPhases : fallback.happyPathPhases,
    namedBranches: namedBranches.length > 0 ? namedBranches : fallback.namedBranches,
    actionLadder: actionLadder.length > 0 ? actionLadder : fallback.actionLadder
  };
}

function normalizeQualificationLogic(input: Record<string, unknown>, fallback: ArtifactDraft['qualificationLogic']) {
  const legacyCriteria = asStringArray(input as unknown as string[]);
  const qualificationCriteria =
    asStringArray(input.qualificationCriteria).length > 0
      ? asStringArray(input.qualificationCriteria)
      : legacyCriteria.length > 0
        ? legacyCriteria
        : fallback.qualificationCriteria;

  return {
    requiredFields: asStringArray(input.requiredFields).length > 0 ? asStringArray(input.requiredFields) : fallback.requiredFields,
    collectionOrder: asStringArray(input.collectionOrder).length > 0 ? asStringArray(input.collectionOrder) : fallback.collectionOrder,
    verificationRules:
      asStringArray(input.verificationRules).length > 0 ? asStringArray(input.verificationRules) : fallback.verificationRules,
    qualificationCriteria,
    disqualificationHandling:
      asStringArray(input.disqualificationHandling).length > 0
        ? asStringArray(input.disqualificationHandling)
        : fallback.disqualificationHandling,
    outcomes: asStringArray(input.outcomes).length > 0 ? asStringArray(input.outcomes) : fallback.outcomes
  };
}

function normalizeFallbackRules(input: Record<string, unknown>, fallback: ArtifactDraft['fallbackRules']) {
  return {
    uncertainty: asStringArray(input.uncertainty).length > 0 ? asStringArray(input.uncertainty) : fallback.uncertainty,
    missingInformation:
      asStringArray(input.missingInformation).length > 0 ? asStringArray(input.missingInformation) : fallback.missingInformation,
    toolFailures: asStringArray(input.toolFailures).length > 0 ? asStringArray(input.toolFailures) : fallback.toolFailures,
    frustration: asStringArray(input.frustration).length > 0 ? asStringArray(input.frustration) : fallback.frustration,
    regulatedQuestions:
      asStringArray(input.regulatedQuestions).length > 0 ? asStringArray(input.regulatedQuestions) : fallback.regulatedQuestions,
    humanRequests: asStringArray(input.humanRequests).length > 0 ? asStringArray(input.humanRequests) : fallback.humanRequests,
    dncRemoval: asStringArray(input.dncRemoval).length > 0 ? asStringArray(input.dncRemoval) : fallback.dncRemoval,
    poorConnection: asStringArray(input.poorConnection).length > 0 ? asStringArray(input.poorConnection) : fallback.poorConnection,
    escalationTriggers:
      asStringArray(input.escalationTriggers).length > 0 ? asStringArray(input.escalationTriggers) : fallback.escalationTriggers,
    escalationContacts:
      asStringArray(input.escalationContacts).length > 0 ? asStringArray(input.escalationContacts) : fallback.escalationContacts
  };
}

function normalizeTestingChecklist(input: Record<string, unknown>, fallback: ArtifactDraft['testingChecklist']) {
  const legacyChecklist = asStringArray(input as unknown as string[]);
  return {
    launchChecklist:
      asStringArray(input.launchChecklist).length > 0
        ? asStringArray(input.launchChecklist)
        : legacyChecklist.length > 0
          ? legacyChecklist
          : fallback.launchChecklist,
    diagnosticLayers:
      asStringArray(input.diagnosticLayers).length > 0 ? asStringArray(input.diagnosticLayers) : fallback.diagnosticLayers,
    revisionProtocol:
      asStringArray(input.revisionProtocol).length > 0 ? asStringArray(input.revisionProtocol) : fallback.revisionProtocol
  };
}

export function validateArtifactDraft(draft: ArtifactDraft) {
  const checks: ValidationCheck[] = [];
  const prompt = draft.systemPrompt.toLowerCase();
  const fallbackText = JSON.stringify(draft.fallbackRules).toLowerCase();
  const ladderSteps = draft.callFlow.actionLadder.map((item) => item.step.toLowerCase());
  const architectureSectionsPresent = includesPromptSections(draft.systemPrompt, [
    'role',
    'goal',
    'priorities',
    'hard rules',
    'boundaries',
    'tone',
    'developer instructions',
    'task prompt',
    'runtime context',
    'tools',
    'memory',
    'fallback',
    'examples'
  ]);
  const qualityCoverage =
    DEFAULT_VOICE_QUALITY_DIMENSIONS.every((dimension) =>
      draft.testingChecklist.launchChecklist.some((line) => line.toLowerCase().includes(dimension))
    ) || DEFAULT_VOICE_QUALITY_DIMENSIONS.every((dimension) => prompt.includes(dimension));

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
    key: 'action_ladder_present',
    passed: ACTION_LADDER_STEPS.every((step) => ladderSteps.includes(step)),
    detail: 'Call flow must include action ladder steps: ask, verify, confirm, act, wait, escalate.'
  });
  checks.push({
    key: 'post_call_schema_valid',
    passed: validatePostCallSchema(draft.postCallOutputSchema),
    detail: 'Post-call output schema must be a valid object schema with required fields.'
  });
  checks.push({
    key: 'system_prompt_architecture',
    passed: architectureSectionsPresent,
    detail: 'System prompt must include architecture sections for role/goal/rules/boundaries and instruction layers.'
  });
  checks.push({
    key: 'voice_quality_coverage',
    passed: qualityCoverage,
    detail: 'Draft must cover voice quality dimensions: clarity, naturalness, responsiveness, control, goal-orientation, recovery.'
  });

  return {
    passed: checks.every((check) => check.passed),
    checks
  };
}

function normalizeDraft(input: Record<string, unknown>, fallbackDraft: ArtifactDraft): ArtifactDraft {
  const callFlowInput = asJsonObject(input.callFlow);
  const qualificationInput = asJsonObject(input.qualificationLogic);
  const fallbackRulesInput = asJsonObject(input.fallbackRules);
  const testingInput = asJsonObject(input.testingChecklist);

  const legacyCallFlow = asStringArray(input.callFlow);
  const legacyQualification = asStringArray(input.qualificationLogic);
  const legacyFallback = asStringArray(input.fallbackRules);
  const legacyTesting = asStringArray(input.testingChecklist);

  const normalizedCallFlow =
    Object.keys(callFlowInput).length > 0
      ? normalizeCallFlow(callFlowInput, fallbackDraft.callFlow)
      : {
          ...fallbackDraft.callFlow,
          happyPathPhases:
            legacyCallFlow.length > 0
              ? legacyCallFlow.map((step, index) => ({
                  phase: `Legacy step ${index + 1}`,
                  objective: step,
                  keySteps: [step]
                }))
              : fallbackDraft.callFlow.happyPathPhases
        };

  return {
    systemPrompt: ensureString(input.systemPrompt, fallbackDraft.systemPrompt),
    callFlow: normalizedCallFlow,
    qualificationLogic:
      Object.keys(qualificationInput).length > 0
        ? normalizeQualificationLogic(qualificationInput, fallbackDraft.qualificationLogic)
        : {
            ...fallbackDraft.qualificationLogic,
            qualificationCriteria: legacyQualification.length > 0 ? legacyQualification : fallbackDraft.qualificationLogic.qualificationCriteria
          },
    fallbackRules:
      Object.keys(fallbackRulesInput).length > 0
        ? normalizeFallbackRules(fallbackRulesInput, fallbackDraft.fallbackRules)
        : {
            ...fallbackDraft.fallbackRules,
            uncertainty: legacyFallback.length > 0 ? legacyFallback : fallbackDraft.fallbackRules.uncertainty
          },
    postCallOutputSchema: {
      ...fallbackDraft.postCallOutputSchema,
      ...asJsonObject(input.postCallOutputSchema)
    },
    testingChecklist:
      Object.keys(testingInput).length > 0
        ? normalizeTestingChecklist(testingInput, fallbackDraft.testingChecklist)
        : {
            ...fallbackDraft.testingChecklist,
            launchChecklist: legacyTesting.length > 0 ? legacyTesting : fallbackDraft.testingChecklist.launchChecklist
          }
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
