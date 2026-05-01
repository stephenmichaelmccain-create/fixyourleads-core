import { notFound } from 'next/navigation';
import { pullLatestSignupContextAction, saveAssistantPromptNotesAction } from '@/app/clients/[id]/assistant-builder/actions';
import { ClientWorkspaceTabs } from '@/app/clients/[id]/ClientWorkspaceTabs';
import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { safeLoad } from '@/lib/ui-data';

export const dynamic = 'force-dynamic';

type SearchParamShape = Promise<{
  notice?: string;
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

function noticeMessage(notice: string) {
  if (notice === 'notes_saved') {
    return 'Prompt notes saved.';
  }
  if (notice === 'signup_context_pulled') {
    return 'Latest signup context pulled from Postgres and saved into notes history.';
  }
  if (notice === 'signup_context_missing') {
    return 'No signup event found for this client yet.';
  }
  return null;
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
          name: true
        }
      }),
    null
  );

  if (!company) {
    notFound();
  }

  const noteEvents = await safeLoad(
    () =>
      db.eventLog.findMany({
        where: {
          companyId: id,
          eventType: 'assistant_prompt_notes_saved'
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          payload: true,
          createdAt: true
        }
      }),
    []
  );

  const latestSignupEvent = await safeLoad(
    () =>
      db.eventLog.findFirst({
        where: {
          companyId: id,
          eventType: {
            in: ['client_signup_received', 'client_onboarding_received', 'client_signup_approved']
          }
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          eventType: true,
          createdAt: true
        }
      }),
    null
  );

  const latestNotes = (() => {
    const first = noteEvents[0];
    if (!first) {
      return '';
    }
    const payload = asJsonRecord(first.payload);
    return typeof payload.notes === 'string' ? payload.notes : '';
  })();

  const notice = noticeMessage(query.notice || '');

  return (
    <LayoutShell
      title={`${company.name} · Assistant Prompt Notes`}
      companyId={company.id}
      companyName={company.name}
      section="clients"
      variant="workspace"
      hidePageHeader
    >
      <ClientWorkspaceTabs companyId={company.id} active="none" />

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
            <div className="metric-label">Prompt notes</div>
            <h3 className="section-title">Assistant Prompt Workspace</h3>
            <div className="record-subtitle">
              Use this page as an internal notes pad for prompts, call flow drafts, and skill-run inputs. You can also pull the latest signup context from Postgres.
            </div>
          </div>
        </div>

        <form action={pullLatestSignupContextAction} className="workspace-action-rail">
          <input type="hidden" name="companyId" value={company.id} />
          <button className="button-ghost" type="submit">
            Pull Latest Signup Context
          </button>
          <span className="tiny-muted">
            {latestSignupEvent
              ? `${latestSignupEvent.eventType} · ${formatCompactDateTime(latestSignupEvent.createdAt)}`
              : 'No signup event found yet'}
          </span>
        </form>

        <form action={saveAssistantPromptNotesAction} className="panel-stack client-profile-form">
          <input type="hidden" name="companyId" value={company.id} />
          <div className="field-stack">
            <label className="key-value-label" htmlFor="assistant-notes">
              Prompt notes
            </label>
            <textarea
              id="assistant-notes"
              className="text-input"
              name="notes"
              rows={18}
              defaultValue={latestNotes}
              placeholder="Paste your prompt drafts, skill inputs, notes, and revisions here."
            />
          </div>
          <div className="workspace-action-rail">
            <button className="button-primary" type="submit">
              Save notes
            </button>
          </div>
        </form>
      </section>

      <section className="panel panel-stack">
        <div className="record-header">
          <div className="panel-stack">
            <div className="metric-label">History</div>
            <h3 className="section-title">Recent Note Saves</h3>
          </div>
        </div>

        <div className="record-grid">
          {noteEvents.length === 0 && <article className="record-card text-muted">No saved notes yet.</article>}
          {noteEvents.map((event) => {
            const payload = asJsonRecord(event.payload);
            const notes = typeof payload.notes === 'string' ? payload.notes : '';
            const preview = notes.trim().slice(0, 220);

            return (
              <article key={event.id} className="record-card">
                <div className="tiny-muted">Saved {formatCompactDateTime(event.createdAt)}</div>
                <div className="text-muted">{preview || 'Empty note save.'}{preview.length >= 220 ? '...' : ''}</div>
                <div className="tiny-muted">{event.id}</div>
              </article>
            );
          })}
        </div>
      </section>
    </LayoutShell>
  );
}
