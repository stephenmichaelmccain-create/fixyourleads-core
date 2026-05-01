import { AssistantArtifactStatus } from '@prisma/client';
import { notFound } from 'next/navigation';
import {
  approveAssistantDraftAction,
  generateAssistantDraftAction,
  publishAssistantDraftAction,
  saveAssistantMetricSnapshotAction,
  saveClientAssistantOverrideAction
} from '@/app/clients/[id]/assistant-builder/actions';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

type SearchParamShape = Promise<{
  notice?: string;
  runId?: string;
}>;

function formatCompactDateTime(value: Date | string | null | undefined) {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

function asJsonRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function toRecordArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item));
}

function parseCallFlow(value: unknown) {
  const data = asJsonRecord(value);
  const happyPathPhases = toRecordArray(data.happyPathPhases).map((phase) => ({
    phase: typeof phase.phase === 'string' ? phase.phase : '',
    objective: typeof phase.objective === 'string' ? phase.objective : '',
    keySteps: toStringArray(phase.keySteps)
  }));
  const namedBranches = toRecordArray(data.namedBranches).map((branch) => ({
    name: typeof branch.name === 'string' ? branch.name : '',
    trigger: typeof branch.trigger === 'string' ? branch.trigger : '',
    handling: toStringArray(branch.handling)
  }));
  const actionLadder = toRecordArray(data.actionLadder).map((step) => ({
    step: typeof step.step === 'string' ? step.step : '',
    rule: typeof step.rule === 'string' ? step.rule : ''
  }));
  return { happyPathPhases, namedBranches, actionLadder };
}

function parseQualification(value: unknown) {
  const data = asJsonRecord(value);
  return {
    requiredFields: toStringArray(data.requiredFields),
    collectionOrder: toStringArray(data.collectionOrder),
    verificationRules: toStringArray(data.verificationRules),
    qualificationCriteria: toStringArray(data.qualificationCriteria),
    disqualificationHandling: toStringArray(data.disqualificationHandling),
    outcomes: toStringArray(data.outcomes)
  };
}

function parseFallback(value: unknown) {
  const data = asJsonRecord(value);
  return {
    escalationTriggers: toStringArray(data.escalationTriggers),
    escalationContacts: toStringArray(data.escalationContacts),
    dncRemoval: toStringArray(data.dncRemoval),
    toolFailures: toStringArray(data.toolFailures),
    regulatedQuestions: toStringArray(data.regulatedQuestions),
    humanRequests: toStringArray(data.humanRequests)
  };
}

function parseTesting(value: unknown) {
  const data = asJsonRecord(value);
  return {
    launchChecklist: toStringArray(data.launchChecklist),
    diagnosticLayers: toStringArray(data.diagnosticLayers),
    revisionProtocol: toStringArray(data.revisionProtocol)
  };
}

function noticeMessage(notice: string, runId: string | undefined) {
  if (notice === 'override_saved') {
    return 'Client override saved as a new version.';
  }
  if (notice === 'draft_queued') {
    return `Draft queued. Build run ${runId || 'created'} is now waiting in assistant_builder_queue.`;
  }
  if (notice === 'draft_approved') {
    return 'Draft approved and ready to publish.';
  }
  if (notice === 'draft_published') {
    return 'Assistant version published successfully.';
  }
  if (notice === 'metric_saved') {
    return 'Metrics snapshot saved.';
  }
  return null;
}

function statusChipClass(status: string) {
  if (status === 'FAILED' || status === 'ARCHIVED') {
    return 'status-chip-attention';
  }
  if (status === 'PUBLISHED') {
    return '';
  }
  return 'status-chip-muted';
}

export default async function ClientAssistantBuilderPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: SearchParamShape;
}) {
  const { id } = await params;
  const query = (await searchParams) || {};

  const company = await safeLoad(
    () =>
      db.company.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          website: true,
          primaryContactName: true
        }
      }),
    null
  );

  if (!company) {
    notFound();
  }

  const [baseSkillVersion, latestOverride, buildRuns, artifacts, publishedArtifact] = await Promise.all([
    safeLoad(
      () =>
        db.globalAssistantSkillVersion.findFirst({
          orderBy: { version: 'desc' },
          select: { id: true, version: true, name: true, createdAt: true }
        }),
      null
    ),
    safeLoad(
      () =>
        db.clientAssistantOverrideVersion.findFirst({
          where: { companyId: id },
          orderBy: { version: 'desc' },
          select: {
            id: true,
            version: true,
            notes: true,
            overridePayload: true,
            createdAt: true
          }
        }),
      null
    ),
    safeLoad(
      () =>
        db.assistantBuildRun.findMany({
          where: { companyId: id },
          orderBy: { queuedAt: 'desc' },
          take: 12,
          select: {
            id: true,
            status: true,
            model: true,
            queuedAt: true,
            startedAt: true,
            completedAt: true,
            errorMessage: true,
            baseSkillVersion: {
              select: {
                version: true
              }
            },
            clientOverrideVersion: {
              select: {
                version: true
              }
            }
          }
        }),
      []
    ),
    safeLoad(
      () =>
        db.assistantArtifactVersion.findMany({
          where: { companyId: id },
          orderBy: { version: 'desc' },
          take: 12,
          select: {
            id: true,
            version: true,
            status: true,
            systemPrompt: true,
            callFlow: true,
            qualificationLogic: true,
            fallbackRules: true,
            postCallOutputSchema: true,
            testingChecklist: true,
            publishedAt: true,
            approvedAt: true,
            createdAt: true,
            baseSkillVersion: {
              select: {
                version: true
              }
            },
            clientOverrideVersion: {
              select: {
                version: true
              }
            },
            metricsSnapshots: {
              orderBy: { capturedAt: 'desc' },
              take: 3,
              select: {
                id: true,
                window: true,
                bookingRate: true,
                qualificationAccuracy: true,
                escalationRate: true,
                latencyPerceptionScore: true,
                complianceFlags: true,
                sampleSize: true,
                capturedAt: true
              }
            }
          }
        }),
      []
    ),
    safeLoad(
      () =>
        db.assistantArtifactVersion.findFirst({
          where: {
            companyId: id,
            status: AssistantArtifactStatus.PUBLISHED
          },
          orderBy: { publishedAt: 'desc' },
          select: {
            id: true,
            version: true,
            publishedAt: true
          }
        }),
      null
    )
  ]);

  const overridePayload = asJsonRecord(latestOverride?.overridePayload);
  const notice = noticeMessage(query.notice || '', query.runId);

  const qualificationCriteria = toStringArray(overridePayload.qualificationCriteria).join('\n');
  const disallowedClaims = toStringArray(overridePayload.disallowedClaims).join('\n');
  const escalationContacts = toStringArray(overridePayload.escalationContacts).join('\n');
  const latestDraft = artifacts.find((artifact) => artifact.status === AssistantArtifactStatus.NEEDS_REVIEW) || artifacts[0] || null;

  return (
    <LayoutShell
      title={`${company.name} · Assistant Builder`}
      companyId={company.id}
      companyName={company.name}
      section="clients"
      variant="workspace"
      hidePageHeader
    >
      <ClientWorkspaceTabs companyId={company.id} active="assistant-builder" />

      {notice && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot ok" />
            <strong>{notice}</strong>
          </div>
        </section>
      )}

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Versioned skill composition</div>
            <h3 className="section-title">Base skill + client overrides</h3>
            <div className="record-subtitle">
              Save client-specific rules as versioned overrides, then queue a draft build that runs async in Redis/BullMQ.
            </div>
          </div>
        </div>

        <div className="record-grid">
          <article className="record-card">
            <div className="metric-label">Latest base skill</div>
            <div className="metric-value">
              v{baseSkillVersion?.version || 0} {baseSkillVersion?.name || 'Not seeded'}
            </div>
            <div className="tiny-muted">Updated {formatCompactDateTime(baseSkillVersion?.createdAt)}</div>
          </article>
          <article className="record-card">
            <div className="metric-label">Latest override</div>
            <div className="metric-value">v{latestOverride?.version || 0}</div>
            <div className="tiny-muted">Saved {formatCompactDateTime(latestOverride?.createdAt)}</div>
          </article>
          <article className="record-card">
            <div className="metric-label">Published assistant</div>
            <div className="metric-value">{publishedArtifact ? `v${publishedArtifact.version}` : 'None yet'}</div>
            <div className="tiny-muted">{formatCompactDateTime(publishedArtifact?.publishedAt)}</div>
          </article>
        </div>

        <form action={saveClientAssistantOverrideAction} className="panel-stack client-profile-form">
          <input type="hidden" name="companyId" value={company.id} />

          <div className="workspace-filter-row">
            <div className="field-stack">
              <label className="key-value-label" htmlFor="override-business-context">
                Business context
              </label>
              <textarea
                id="override-business-context"
                className="text-input"
                name="businessContext"
                rows={3}
                defaultValue={typeof overridePayload.businessContext === 'string' ? overridePayload.businessContext : ''}
                placeholder="Offer details, audience, appointment constraints."
              />
            </div>
            <div className="field-stack">
              <label className="key-value-label" htmlFor="override-tone-guidelines">
                Tone guidelines
              </label>
              <textarea
                id="override-tone-guidelines"
                className="text-input"
                name="toneGuidelines"
                rows={3}
                defaultValue={typeof overridePayload.toneGuidelines === 'string' ? overridePayload.toneGuidelines : ''}
                placeholder="How this client should sound on calls."
              />
            </div>
            <div className="field-stack">
              <label className="key-value-label" htmlFor="override-callflow-focus">
                Call flow focus
              </label>
              <textarea
                id="override-callflow-focus"
                className="text-input"
                name="customCallFlowFocus"
                rows={3}
                defaultValue={typeof overridePayload.customCallFlowFocus === 'string' ? overridePayload.customCallFlowFocus : ''}
                placeholder="Custom emphasis for this client."
              />
            </div>
          </div>

          <div className="workspace-filter-row">
            <div className="field-stack">
              <label className="key-value-label" htmlFor="override-qualification">
                Qualification logic (one per line)
              </label>
              <textarea
                id="override-qualification"
                className="text-input"
                name="qualificationCriteria"
                rows={6}
                defaultValue={qualificationCriteria}
              />
            </div>
            <div className="field-stack">
              <label className="key-value-label" htmlFor="override-disallowed">
                Disallowed claims (one per line)
              </label>
              <textarea
                id="override-disallowed"
                className="text-input"
                name="disallowedClaims"
                rows={6}
                defaultValue={disallowedClaims}
              />
            </div>
            <div className="field-stack">
              <label className="key-value-label" htmlFor="override-escalation">
                Escalation contacts (one per line)
              </label>
              <textarea
                id="override-escalation"
                className="text-input"
                name="escalationContacts"
                rows={6}
                defaultValue={escalationContacts}
              />
            </div>
          </div>

          <div className="workspace-filter-row">
            <div className="field-stack">
              <label className="key-value-label" htmlFor="override-notes">
                Version notes
              </label>
              <input id="override-notes" className="text-input" name="notes" defaultValue={latestOverride?.notes || ''} />
            </div>
          </div>

          <div className="workspace-action-rail">
            <button className="button-primary" type="submit">
              Save override version
            </button>
          </div>
        </form>

        <form action={generateAssistantDraftAction} className="workspace-filter-row">
          <input type="hidden" name="companyId" value={company.id} />
          <div className="field-stack">
            <label className="key-value-label" htmlFor="generate-model">
              Generation model
            </label>
            <input id="generate-model" className="text-input" name="model" placeholder="gpt-5.4-mini" defaultValue="gpt-5.4-mini" />
          </div>
          <div className="field-stack">
            <label className="key-value-label">&nbsp;</label>
            <button className="button-primary" type="submit">
              Generate Draft
            </button>
          </div>
        </form>
      </section>

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Build runs</div>
            <h3 className="section-title">Async generation history</h3>
            <div className="record-subtitle">Each run logs base skill version, override version, model, status, and timestamps.</div>
          </div>
        </div>

        <div className="record-grid">
          {buildRuns.length === 0 && <article className="record-card text-muted">No build runs yet.</article>}
          {buildRuns.map((run) => (
            <article key={run.id} className="record-card">
              <div className="inline-row">
                <span className={`status-chip ${statusChipClass(run.status)}`}>
                  <span className="status-dot ok" />
                  {run.status}
                </span>
                <span className="tiny-muted">{run.model}</span>
              </div>
              <div className="text-muted">
                Base v{run.baseSkillVersion.version} · Override v{run.clientOverrideVersion?.version || 'none'}
              </div>
              <div className="tiny-muted">Queued {formatCompactDateTime(run.queuedAt)}</div>
              <div className="tiny-muted">Completed {formatCompactDateTime(run.completedAt)}</div>
              {run.errorMessage && <div className="tiny-muted">Error: {run.errorMessage}</div>}
              <div className="tiny-muted">{run.id}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Draft review + publish</div>
            <h3 className="section-title">Artifact versions</h3>
            <div className="record-subtitle">
              Generated artifacts are saved as <code>needs_review</code> until a human approves and publishes.
            </div>
          </div>
        </div>

        <div className="record-grid">
          {artifacts.length === 0 && <article className="record-card text-muted">No artifacts generated yet.</article>}
          {artifacts.map((artifact) => {
            const callFlow = parseCallFlow(artifact.callFlow);
            const qualification = parseQualification(artifact.qualificationLogic);
            const fallback = parseFallback(artifact.fallbackRules);
            const testing = parseTesting(artifact.testingChecklist);
            const postCallSchema = asJsonRecord(artifact.postCallOutputSchema);
            const postCallSchemaFields = Object.keys(asJsonRecord(postCallSchema.properties));

            return (
            <article key={artifact.id} className="record-card">
              <div className="inline-row">
                <span className={`status-chip ${statusChipClass(artifact.status)}`}>
                  <span className="status-dot ok" />
                  v{artifact.version} · {artifact.status}
                </span>
                <span className="tiny-muted">
                  Base v{artifact.baseSkillVersion.version} · Override v{artifact.clientOverrideVersion?.version || 'none'}
                </span>
              </div>
              <div className="tiny-muted">Created {formatCompactDateTime(artifact.createdAt)}</div>
              <div className="tiny-muted">Approved {formatCompactDateTime(artifact.approvedAt)}</div>
              <div className="tiny-muted">Published {formatCompactDateTime(artifact.publishedAt)}</div>

              <div className="panel-stack">
                <div className="metric-label">1) System prompt</div>
                <div className="text-muted">{artifact.systemPrompt.slice(0, 220)}{artifact.systemPrompt.length > 220 ? '...' : ''}</div>
                <div className="metric-label">2) Call flow</div>
                <div className="tiny-muted">
                  Phases: {callFlow.happyPathPhases.map((phase) => phase.phase).filter(Boolean).join(' | ') || '—'}
                </div>
                <div className="tiny-muted">
                  Action ladder: {callFlow.actionLadder.map((step) => step.step).filter(Boolean).join(' -> ') || '—'}
                </div>
                <div className="tiny-muted">
                  Branches: {callFlow.namedBranches.map((branch) => branch.name).filter(Boolean).join(' | ') || '—'}
                </div>
                <div className="metric-label">3) Qualification logic</div>
                <div className="tiny-muted">
                  Required fields: {qualification.requiredFields.join(', ') || '—'}
                </div>
                <div className="tiny-muted">
                  Criteria: {qualification.qualificationCriteria.join(' | ') || '—'}
                </div>
                <div className="metric-label">4) Fallback + escalation</div>
                <div className="tiny-muted">
                  Escalation triggers: {fallback.escalationTriggers.join(' | ') || '—'}
                </div>
                <div className="tiny-muted">
                  DNC handling: {fallback.dncRemoval.join(' | ') || '—'}
                </div>
                <div className="metric-label">5) Post-call output schema</div>
                <div className="tiny-muted">Schema fields: {postCallSchemaFields.join(', ') || '—'}</div>
                <div className="metric-label">6) Testing + revision rubric</div>
                <div className="tiny-muted">
                  Launch checks: {testing.launchChecklist.length} · Diagnostic layers: {testing.diagnosticLayers.length}
                </div>
              </div>

              {(artifact.status === AssistantArtifactStatus.NEEDS_REVIEW || artifact.status === AssistantArtifactStatus.APPROVED) && (
                <div className="workspace-action-rail">
                  {artifact.status === AssistantArtifactStatus.NEEDS_REVIEW && (
                    <form action={approveAssistantDraftAction}>
                      <input type="hidden" name="companyId" value={company.id} />
                      <input type="hidden" name="artifactVersionId" value={artifact.id} />
                      <button className="button-ghost" type="submit">
                        Approve
                      </button>
                    </form>
                  )}
                  {artifact.status === AssistantArtifactStatus.APPROVED && (
                    <form action={publishAssistantDraftAction}>
                      <input type="hidden" name="companyId" value={company.id} />
                      <input type="hidden" name="artifactVersionId" value={artifact.id} />
                      <button className="button-primary" type="submit">
                        Publish
                      </button>
                    </form>
                  )}
                </div>
              )}

              {artifact.metricsSnapshots.length > 0 && (
                <div className="panel-stack">
                  <div className="metric-label">Latest metric snapshots</div>
                  {artifact.metricsSnapshots.map((snapshot) => (
                    <div key={snapshot.id} className="tiny-muted">
                      {snapshot.window}: booking {snapshot.bookingRate ?? '—'}%, qualification {snapshot.qualificationAccuracy ?? '—'}%,
                      escalation {snapshot.escalationRate ?? '—'}%, compliance flags {snapshot.complianceFlags ?? '—'} ({formatCompactDateTime(snapshot.capturedAt)})
                    </div>
                  ))}
                </div>
              )}
            </article>
            );
          })}
        </div>
      </section>

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">Version analytics</div>
            <h3 className="section-title">Capture metrics snapshot</h3>
            <div className="record-subtitle">
              Log before/after performance for this assistant version to track regressions or improvements over time.
            </div>
          </div>
        </div>

        <form action={saveAssistantMetricSnapshotAction} className="panel-stack client-profile-form">
          <input type="hidden" name="companyId" value={company.id} />

          <div className="workspace-filter-row">
            <div className="field-stack">
              <label className="key-value-label" htmlFor="metric-artifact">
                Artifact version
              </label>
              <select id="metric-artifact" className="select-input" name="artifactVersionId" defaultValue={latestDraft?.id || ''}>
                {artifacts.map((artifact) => (
                  <option key={artifact.id} value={artifact.id}>
                    v{artifact.version} ({artifact.status})
                  </option>
                ))}
              </select>
            </div>
            <div className="field-stack">
              <label className="key-value-label" htmlFor="metric-window">
                Window
              </label>
              <select id="metric-window" className="select-input" name="window" defaultValue="LIFETIME">
                <option value="LIFETIME">Lifetime</option>
                <option value="LAST_7_DAYS">Last 7 days</option>
                <option value="LAST_30_DAYS">Last 30 days</option>
              </select>
            </div>
          </div>

          <div className="workspace-filter-row">
            <div className="field-stack">
              <label className="key-value-label" htmlFor="metric-booking-rate">
                Booking rate (%)
              </label>
              <input id="metric-booking-rate" className="text-input" name="bookingRate" placeholder="34.5" />
            </div>
            <div className="field-stack">
              <label className="key-value-label" htmlFor="metric-qualification-accuracy">
                Qualification accuracy (%)
              </label>
              <input id="metric-qualification-accuracy" className="text-input" name="qualificationAccuracy" placeholder="82.0" />
            </div>
            <div className="field-stack">
              <label className="key-value-label" htmlFor="metric-escalation-rate">
                Escalation rate (%)
              </label>
              <input id="metric-escalation-rate" className="text-input" name="escalationRate" placeholder="14.2" />
            </div>
          </div>

          <div className="workspace-filter-row">
            <div className="field-stack">
              <label className="key-value-label" htmlFor="metric-latency">
                Latency perception (% positive)
              </label>
              <input id="metric-latency" className="text-input" name="latencyPerceptionScore" placeholder="90" />
            </div>
            <div className="field-stack">
              <label className="key-value-label" htmlFor="metric-compliance-flags">
                Compliance flags (count)
              </label>
              <input id="metric-compliance-flags" className="text-input" name="complianceFlags" placeholder="0" />
            </div>
            <div className="field-stack">
              <label className="key-value-label" htmlFor="metric-sample-size">
                Sample size
              </label>
              <input id="metric-sample-size" className="text-input" name="sampleSize" placeholder="100" />
            </div>
          </div>

          <div className="workspace-filter-row">
            <div className="field-stack">
              <label className="key-value-label" htmlFor="metric-notes">
                Notes
              </label>
              <input id="metric-notes" className="text-input" name="notes" placeholder="Campaign source, date range, caveats." />
            </div>
          </div>

          <div className="workspace-action-rail">
            <button className="button-primary" type="submit" disabled={artifacts.length === 0}>
              Save metrics snapshot
            </button>
          </div>
        </form>
      </section>
    </LayoutShell>
  );
}
