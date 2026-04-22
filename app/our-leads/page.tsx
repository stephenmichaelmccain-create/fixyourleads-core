import { ProspectStatus } from '@prisma/client';
import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { isDemoLabel } from '@/lib/demo';
import { safeLoad } from '@/lib/ui-data';
import { createProspectAction, scheduleProspectCallbackAction, updateProspectOutcomeAction } from './actions';

export const dynamic = 'force-dynamic';

const statusOptions = [
  { label: 'All statuses', value: '' },
  { label: 'New', value: ProspectStatus.NEW },
  { label: 'No answer', value: ProspectStatus.NO_ANSWER },
  { label: 'Voicemail left', value: ProspectStatus.VM_LEFT },
  { label: 'Call back later', value: ProspectStatus.GATEKEEPER },
  { label: 'Booked', value: ProspectStatus.BOOKED_DEMO },
  { label: 'Sold', value: ProspectStatus.CLOSED },
  { label: 'Do not contact', value: ProspectStatus.DEAD }
] as const;

const dueOptions = [
  { label: 'All follow-up windows', value: '' },
  { label: 'Overdue', value: 'overdue' },
  { label: 'Due today', value: 'today' },
  { label: 'Due in next 7 days', value: 'next7' },
  { label: 'No next action set', value: 'unset' }
] as const;

type SearchParamShape = Promise<{
  prospectId?: string;
  q?: string;
  status?: string;
  city?: string;
  nextActionDue?: string;
  added?: string;
  updated?: string;
  error?: string;
  duplicateReason?: string;
}>;

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date) {
  const copy = startOfDay(date);
  copy.setDate(copy.getDate() + 1);
  return copy;
}

function humanizeStatus(status: ProspectStatus) {
  switch (status) {
    case ProspectStatus.VM_LEFT:
      return 'Voicemail left';
    case ProspectStatus.GATEKEEPER:
      return 'Call back later';
    case ProspectStatus.BOOKED_DEMO:
      return 'Booked';
    case ProspectStatus.CLOSED:
      return 'Sold';
    case ProspectStatus.DEAD:
      return 'Do not contact';
    default:
      return status
        .toLowerCase()
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
  }
}

function formatDateTime(date?: Date | null) {
  if (!date) {
    return 'Not set';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function formatDateOnly(date?: Date | null) {
  if (!date) {
    return 'Not set';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

function websiteHref(website?: string | null) {
  if (!website) {
    return '';
  }

  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

const PROSPECT_META_PREFIX = 'fyl:';

type ProspectProfile = {
  clinicType?: string;
  zipCode?: string;
  predictedRevenue?: string;
  source?: string;
  importBatch?: string;
  sourceRecord?: string;
  logoUrl?: string;
};

function parseProspectNotes(notes?: string | null) {
  const profile: ProspectProfile = {};
  const plainLines: string[] = [];

  for (const line of String(notes || '').split('\n')) {
    const trimmed = line.trim();

    if (!trimmed) {
      plainLines.push('');
      continue;
    }

    if (!trimmed.startsWith(PROSPECT_META_PREFIX)) {
      plainLines.push(line);
      continue;
    }

    const metadata = trimmed.slice(PROSPECT_META_PREFIX.length);
    const [rawKey, ...valueParts] = metadata.split('=');
    const key = rawKey?.trim();
    const value = valueParts.join('=').trim();

    if (!key || !value) {
      continue;
    }

    if (key === 'clinic_type') {
      profile.clinicType = value;
    } else if (key === 'zip_code') {
      profile.zipCode = value;
    } else if (key === 'predicted_revenue') {
      profile.predictedRevenue = value;
    } else if (key === 'source') {
      profile.source = value;
    } else if (key === 'import_batch') {
      profile.importBatch = value;
    } else if (key === 'source_record') {
      profile.sourceRecord = value;
    } else if (key === 'logo_url') {
      profile.logoUrl = value;
    }
  }

  return {
    profile,
    plainNotes: plainLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  };
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function dueBucketMatches(date: Date | null, bucket: string, now: Date) {
  if (!bucket) {
    return true;
  }

  if (bucket === 'unset') {
    return !date;
  }

  if (!date) {
    return false;
  }

  const todayStart = startOfDay(now);
  const tomorrowStart = endOfDay(now);
  const nextWeek = new Date(todayStart);
  nextWeek.setDate(nextWeek.getDate() + 7);

  if (bucket === 'overdue') {
    return date < todayStart;
  }

  if (bucket === 'today') {
    return date >= todayStart && date < tomorrowStart;
  }

  if (bucket === 'next7') {
    return date >= todayStart && date < nextWeek;
  }

  return true;
}

function compareProspects(
  left: { nextActionAt: Date | null; updatedAt: Date; lastCallAt: Date | null; name: string },
  right: { nextActionAt: Date | null; updatedAt: Date; lastCallAt: Date | null; name: string }
) {
  if (left.nextActionAt && right.nextActionAt) {
    const diff = left.nextActionAt.getTime() - right.nextActionAt.getTime();
    if (diff !== 0) {
      return diff;
    }
  }

  if (left.nextActionAt && !right.nextActionAt) {
    return -1;
  }

  if (!left.nextActionAt && right.nextActionAt) {
    return 1;
  }

  const leftActivity = left.lastCallAt?.getTime() ?? left.updatedAt.getTime();
  const rightActivity = right.lastCallAt?.getTime() ?? right.updatedAt.getTime();
  if (leftActivity !== rightActivity) {
    return rightActivity - leftActivity;
  }

  return left.name.localeCompare(right.name);
}

function buildPageHref({
  prospectId,
  q,
  status,
  city,
  nextActionDue
}: {
  prospectId?: string;
  q?: string;
  status?: string;
  city?: string;
  nextActionDue?: string;
}) {
  const params = new URLSearchParams();

  if (prospectId) {
    params.set('prospectId', prospectId);
  }

  if (q) {
    params.set('q', q);
  }

  if (status) {
    params.set('status', status);
  }

  if (city) {
    params.set('city', city);
  }

  if (nextActionDue) {
    params.set('nextActionDue', nextActionDue);
  }

  const query = params.toString();
  return query ? `/leads?${query}` : '/leads';
}

function statusChipClass(status: ProspectStatus) {
  if (status === ProspectStatus.DEAD || status === ProspectStatus.CLOSED) {
    return 'status-chip status-chip-muted';
  }

  if (status === ProspectStatus.NEW) {
    return 'status-chip status-chip-attention';
  }

  return 'status-chip';
}

export default async function OurLeadsPage({
  searchParams
}: {
  searchParams?: SearchParamShape;
}) {
  const params = (await searchParams) || {};
  const selectedStatus =
    Object.values(ProspectStatus).includes((params.status || '') as ProspectStatus)
      ? (params.status as ProspectStatus)
      : '';
  const searchQuery = String(params.q || '').trim();
  const normalizedSearchQuery = normalizeSearch(searchQuery);
  const selectedCity = String(params.city || '').trim();
  const selectedDue = String(params.nextActionDue || '').trim();
  const selectedProspectId = String(params.prospectId || '').trim();
  const added = params.added === '1';
  const updated = String(params.updated || '').trim();
  const error = String(params.error || '').trim();
  const duplicateReason = String(params.duplicateReason || '').trim();
  const now = new Date();

  const allProspects = await safeLoad(
    () =>
      db.prospect.findMany({
        select: {
          id: true,
          name: true,
          city: true,
          phone: true,
          website: true,
          ownerName: true,
          status: true,
          lastCallAt: true,
          lastCallOutcome: true,
          nextActionAt: true,
          notes: true,
          updatedAt: true,
          createdAt: true,
          callLogs: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              outcome: true,
              durationSeconds: true,
              notes: true,
              createdAt: true
            }
          }
        }
      }),
    []
  );

  const prospectRows = allProspects.map((prospect) => {
    const parsed = parseProspectNotes(prospect.notes);

    return {
      ...prospect,
      plainNotes: parsed.plainNotes,
      profile: parsed.profile
    };
  });

  const cityOptions = Array.from(
    new Set(
      prospectRows
        .map((prospect) => prospect.city?.trim())
        .filter((value): value is string => Boolean(value))
    )
  ).sort((left, right) => left.localeCompare(right));

  const visibleProspects = [...prospectRows]
    .filter((prospect) => {
      if (!normalizedSearchQuery) {
        return true;
      }

      const searchFields = [
        prospect.name,
        prospect.city,
        prospect.phone,
        prospect.website,
        prospect.ownerName,
        prospect.profile.clinicType,
        prospect.profile.zipCode,
        prospect.profile.predictedRevenue,
        prospect.profile.source,
        prospect.profile.importBatch,
        prospect.profile.sourceRecord,
        prospect.lastCallOutcome,
        prospect.plainNotes
      ];

      return searchFields.some((value) => normalizeSearch(value || '').includes(normalizedSearchQuery));
    })
    .filter((prospect) => (selectedStatus ? prospect.status === selectedStatus : true))
    .filter((prospect) => (selectedCity ? prospect.city === selectedCity : true))
    .filter((prospect) => dueBucketMatches(prospect.nextActionAt, selectedDue, now))
    .sort(compareProspects);

  const effectiveSelectedProspectId =
    (selectedProspectId && visibleProspects.some((prospect) => prospect.id === selectedProspectId)
      ? selectedProspectId
      : visibleProspects[0]?.id) || '';

  const selectedProspect = effectiveSelectedProspectId
    ? await safeLoad(
        () =>
          db.prospect.findUnique({
            where: { id: effectiveSelectedProspectId },
            include: {
              callLogs: {
                orderBy: { createdAt: 'desc' }
              }
            }
          }),
        null
      )
    : null;

  const selectedProspectView = selectedProspect
    ? {
        ...selectedProspect,
        ...parseProspectNotes(selectedProspect.notes)
      }
    : null;

  const activeSelection = selectedProspectView
    ? `${selectedProspectView.name}${selectedProspectView.city ? ` • ${selectedProspectView.city}` : ''}`
    : 'No prospect selected';

  const errorMessage =
    error === 'name_required'
      ? 'Name is required to add a prospect.'
      : error === 'invalid_next_action'
        ? 'Next action must be a valid date and time.'
        : error === 'duplicate'
          ? duplicateReason === 'website'
            ? 'This clinic is already in the queue with the same website.'
            : duplicateReason === 'phone'
              ? 'This clinic is already in the queue with the same phone number.'
              : 'This clinic already looks like an existing prospect in the queue.'
        : error
          ? 'The prospect could not be saved. Try again.'
          : '';

  return (
    <LayoutShell
      title="Leads"
      description="Work the clinic call queue in one screen."
      section="leads"
      variant="workspace"
    >
      {updated && (
        <section className="panel panel-stack">
          <div className="inline-row">
            <span className="status-dot ok" />
            <strong>Call outcome saved.</strong>
          </div>
          <div className="text-muted">
            {updated === 'no_answer'
              ? 'Marked no answer and moved the next call to tomorrow morning.'
              : updated === 'voicemail'
                ? 'Logged voicemail and queued the next touch for tomorrow.'
                : updated === 'not_interested'
                  ? 'Marked not interested and scheduled a later retry.'
                  : updated === 'callback'
                    ? 'Scheduled the clinic to come back into the queue automatically.'
                  : updated === 'do_not_contact'
                    ? 'Suppressed this clinic from future outreach.'
                    : updated === 'booked'
                      ? 'Marked booked and moved it into meeting follow-up.'
                      : updated === 'sold'
                        ? 'Marked sold and scheduled waiting-for-signup follow-up.'
                        : 'The prospect was updated.'}
          </div>
        </section>
      )}

      {added && (
        <section className="panel panel-success panel-stack">
          <div className="metric-label">Prospect added</div>
          <div className="text-muted">The new prospect is live in the queue and opened in the detail rail.</div>
        </section>
      )}

      {errorMessage && (
        <section className="panel panel-attention panel-stack">
          <div className="metric-label">Could not save prospect</div>
          <div className="text-muted">{errorMessage}</div>
          {error === 'duplicate' && selectedProspect ? (
            <div className="tiny-muted">
              Existing match opened in the detail rail: <strong>{selectedProspect.name}</strong>
            </div>
          ) : null}
        </section>
      )}

      <div className="conversation-layout">
        <div className="page-stack">
          <section className="panel panel-stack" id="add-prospect">
            <details>
              <summary className="form-title">Add lead</summary>
              <form action={createProspectAction} className="workspace-filter-form" style={{ marginTop: 16 }}>
                <div className="workspace-filter-row">
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="prospect-name">
                      Name
                    </label>
                    <input id="prospect-name" name="name" className="text-input" placeholder="Glow Med Spa" required />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="prospect-phone">
                      Phone
                    </label>
                    <input id="prospect-phone" name="phone" className="text-input" placeholder="(555) 555-5555" />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="prospect-city">
                      City
                    </label>
                    <input id="prospect-city" name="city" className="text-input" placeholder="Austin" />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="prospect-owner-name">
                      Contact
                    </label>
                    <input id="prospect-owner-name" name="ownerName" className="text-input" placeholder="Jamie Reed" />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="prospect-website">
                      Website
                    </label>
                    <input id="prospect-website" name="website" className="text-input" placeholder="glowmedspa.com" />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="prospect-status">
                      Status
                    </label>
                    <select id="prospect-status" name="status" className="select-input" defaultValue={ProspectStatus.NEW}>
                      {statusOptions
                        .filter((option) => option.value)
                        .map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="prospect-next-action">
                      Next action
                    </label>
                    <input id="prospect-next-action" name="nextActionAt" type="datetime-local" className="text-input" />
                  </div>
                </div>

                <div className="field-stack">
                  <label className="key-value-label" htmlFor="prospect-notes">
                    Notes
                  </label>
                  <textarea
                    id="prospect-notes"
                    name="notes"
                    className="text-area"
                    placeholder="Front desk notes, objections, or anything the next caller should know."
                  />
                </div>

                <div className="workspace-filter-actions">
                  <button type="submit" className="button">
                    Add lead
                  </button>
                </div>
              </form>
            </details>
          </section>

          <section className="panel panel-stack">
            <div className="inline-row justify-between">
              <div className="panel-stack">
                <div className="metric-label">Lead board</div>
                <h2 className="section-title">Filter once, then click the next clinic to work.</h2>
              </div>
              <div className="status-chip">
                <strong>Visible</strong> {visibleProspects.length}
              </div>
            </div>

            <form action="/leads" className="workspace-filter-form">
              <div className="workspace-filter-row">
                <div className="field-stack">
                  <label className="key-value-label" htmlFor="our-leads-search">
                    Search clinics
                  </label>
                  <input
                    id="our-leads-search"
                    name="q"
                    className="text-input"
                    defaultValue={searchQuery}
                    placeholder="Name, phone, website, owner, or city"
                  />
                </div>

                <div className="field-stack">
                  <label className="key-value-label" htmlFor="our-leads-status">
                    Status
                  </label>
                  <select id="our-leads-status" name="status" className="select-input" defaultValue={selectedStatus}>
                    {statusOptions.map((option) => (
                      <option key={option.label} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field-stack">
                  <label className="key-value-label" htmlFor="our-leads-city">
                    City
                  </label>
                  <select id="our-leads-city" name="city" className="select-input" defaultValue={selectedCity}>
                    <option value="">All cities</option>
                    {cityOptions.map((city) => (
                      <option key={city} value={city}>
                        {city}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field-stack">
                  <label className="key-value-label" htmlFor="our-leads-due">
                    Next action due
                  </label>
                  <select id="our-leads-due" name="nextActionDue" className="select-input" defaultValue={selectedDue}>
                    {dueOptions.map((option) => (
                      <option key={option.label} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="workspace-filter-actions">
                <button type="submit" className="button-secondary">
                  Apply filters
                </button>
                <a className="button-ghost" href="/leads">
                  Reset
                </a>
              </div>
            </form>

            {visibleProspects.length === 0 ? (
              <div className="empty-state">
                No prospects match the current filters. Reset the board or add a new clinic at the top.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <div
                  style={{
                    minWidth: 980,
                    display: 'grid',
                    gap: 8
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.8fr 1.25fr 1.1fr 1.15fr 1fr 1fr',
                      gap: 12,
                      padding: '0 12px 8px',
                      color: 'var(--fyl-muted)',
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase'
                    }}
                  >
                    <span>Prospect</span>
                    <span>Profile</span>
                    <span>Contact</span>
                    <span>Status / source</span>
                    <span>Last call</span>
                    <span>Next action</span>
                  </div>

                  {visibleProspects.map((prospect) => {
                    const rowHref = buildPageHref({
                      prospectId: prospect.id,
                      q: searchQuery,
                      status: selectedStatus,
                      city: selectedCity,
                      nextActionDue: selectedDue
                    });
                    const lastTouch = prospect.callLogs[0]?.createdAt || prospect.lastCallAt || prospect.updatedAt;
                    const selected = prospect.id === effectiveSelectedProspectId;

                    return (
                      <a
                        key={prospect.id}
                        href={rowHref}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1.8fr 1.25fr 1.1fr 1.15fr 1fr 1fr',
                          gap: 12,
                          alignItems: 'center',
                          padding: '14px 16px',
                          borderRadius: 20,
                          border: selected
                            ? '1px solid rgba(182, 50, 255, 0.48)'
                            : '1px solid rgba(176, 137, 244, 0.18)',
                          background: selected
                            ? 'linear-gradient(180deg, rgba(250, 241, 255, 0.98), rgba(244, 232, 255, 0.98))'
                            : 'linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 243, 255, 0.98))',
                          boxShadow: selected ? '0 18px 40px rgba(52, 16, 88, 0.08)' : 'none',
                          color: 'inherit',
                          textDecoration: 'none'
                        }}
                      >
                        <div className="record-stack">
                          <span className="inline-row">
                            <strong>{prospect.name}</strong>
                            {isDemoLabel(prospect.name) ? <span className="status-chip status-chip-muted">Demo</span> : null}
                          </span>
                          <span className="tiny-muted">
                            {prospect.profile.clinicType || 'Clinic type not set'} • {prospect.city || 'City not set'}
                          </span>
                        </div>
                        <div className="record-stack">
                          <span>{prospect.website || prospect.profile.logoUrl || 'No website or logo'}</span>
                          <span className="tiny-muted">
                            {prospect.profile.predictedRevenue || 'Revenue unknown'}
                            {prospect.profile.zipCode ? ` • ZIP ${prospect.profile.zipCode}` : ''}
                          </span>
                        </div>
                        <div className="record-stack">
                          <span>{prospect.phone || 'No phone'}</span>
                          <span className="tiny-muted">{prospect.ownerName || 'Owner not set'}</span>
                        </div>
                        <div className="record-stack">
                          <span className={statusChipClass(prospect.status)}>
                            <strong>Status</strong> {humanizeStatus(prospect.status)}
                          </span>
                          <span className="tiny-muted">
                            {prospect.profile.source || 'Manual add'}
                            {prospect.profile.importBatch ? ` • ${prospect.profile.importBatch}` : ''}
                          </span>
                        </div>
                        <div className="record-stack">
                          <span>{formatDateTime(lastTouch)}</span>
                          <span className="tiny-muted">
                            {prospect.lastCallOutcome || prospect.callLogs[0]?.outcome || (prospect.lastCallAt ? 'Logged call' : 'Recent activity')}
                          </span>
                        </div>
                        <div className="record-stack">
                          <span>{formatDateTime(prospect.nextActionAt)}</span>
                          <span className="tiny-muted">
                            {prospect.nextActionAt
                              ? dueBucketMatches(prospect.nextActionAt, 'overdue', now)
                                ? 'Past due'
                                : dueBucketMatches(prospect.nextActionAt, 'today', now)
                                  ? 'Due today'
                                  : 'Scheduled'
                              : 'Needs scheduling'}
                          </span>
                        </div>
                      </a>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="conversation-sidebar">
          <section className="panel panel-stack sticky-panel">
            <div className="metric-label">Prospect detail</div>
            <div className="inline-row justify-between">
              <div className="inline-row">
                <h2 className="form-title">{activeSelection}</h2>
                {selectedProspectView && isDemoLabel(selectedProspectView.name) ? (
                  <span className="status-chip status-chip-muted">Demo</span>
                ) : null}
                {!selectedProspectId && selectedProspectView ? (
                  <span className="status-chip status-chip-muted">Auto-opened</span>
                ) : null}
              </div>
              {selectedProspectId && selectedProspectView ? (
                <a
                  className="button-ghost"
                  href={buildPageHref({
                    q: searchQuery,
                    status: selectedStatus,
                    city: selectedCity,
                    nextActionDue: selectedDue
                  })}
                >
                  Close
                </a>
              ) : null}
            </div>

            {!selectedProspectView ? (
              <div className="empty-state">
                Click any row in the prospect board to open notes, call history, and the next-action summary here.
              </div>
            ) : (
              <>
                <div className="inline-actions">
                  {selectedProspectView.phone ? (
                    <a className="button" href={`tel:${selectedProspectView.phone}`}>
                      Call now
                    </a>
                  ) : null}
                  {selectedProspectView.website ? (
                    <a className="button-secondary" href={websiteHref(selectedProspectView.website)} target="_blank" rel="noreferrer">
                      Open website
                    </a>
                  ) : null}
                  {selectedProspectView.profile.logoUrl ? (
                    <a className="button-ghost" href={selectedProspectView.profile.logoUrl} target="_blank" rel="noreferrer">
                      View logo
                    </a>
                  ) : null}
                </div>

                <form action={updateProspectOutcomeAction} className="panel panel-stack">
                  <div className="metric-label">Quick call outcome</div>
                  <input type="hidden" name="prospectId" value={selectedProspectView.id} />
                  <input type="hidden" name="q" value={searchQuery} />
                  <input type="hidden" name="status" value={selectedStatus} />
                  <input type="hidden" name="city" value={selectedCity} />
                  <input type="hidden" name="nextActionDue" value={selectedDue} />
                  <div className="inline-actions inline-actions-wrap">
                    <button type="submit" className="button-secondary" name="outcome" value="no_answer">
                      No answer
                    </button>
                    <button type="submit" className="button-secondary" name="outcome" value="voicemail">
                      Left voicemail
                    </button>
                    <button type="submit" className="button-secondary" name="outcome" value="not_interested">
                      Not interested
                    </button>
                    <button type="submit" className="button-secondary" name="outcome" value="booked">
                      Booked
                    </button>
                    <button type="submit" className="button-secondary" name="outcome" value="sold">
                      Sold
                    </button>
                    <button type="submit" className="button-ghost" name="outcome" value="do_not_contact">
                      Do not contact
                    </button>
                  </div>
                  <div className="tiny-muted">
                    Each outcome updates the status, logs the call, and sets the next action automatically.
                  </div>
                </form>

                <form action={scheduleProspectCallbackAction} className="panel panel-stack">
                  <div className="metric-label">Schedule callback</div>
                  <input type="hidden" name="prospectId" value={selectedProspectView.id} />
                  <input type="hidden" name="q" value={searchQuery} />
                  <input type="hidden" name="status" value={selectedStatus} />
                  <input type="hidden" name="city" value={selectedCity} />
                  <input type="hidden" name="nextActionDue" value={selectedDue} />
                  <div className="inline-actions inline-actions-wrap">
                    <button type="submit" className="button-secondary" name="preset" value="tomorrow">
                      Tomorrow
                    </button>
                    <button type="submit" className="button-secondary" name="preset" value="3_days">
                      3 days
                    </button>
                    <button type="submit" className="button-secondary" name="preset" value="1_week">
                      1 week
                    </button>
                    <button type="submit" className="button-secondary" name="preset" value="1_month">
                      1 month
                    </button>
                  </div>
                  <div className="tiny-muted">
                    Use presets when a clinic should come back later and you do not want the team to remember it manually.
                  </div>
                </form>

                <div className="key-value-grid">
                  <div className="key-value-card">
                    <span className="key-value-label">Phone</span>
                    {selectedProspectView.phone || 'Not set'}
                  </div>
                  <div className="key-value-card">
                    <span className="key-value-label">City</span>
                    {selectedProspectView.city || 'Not set'}
                  </div>
                  <div className="key-value-card">
                    <span className="key-value-label">Owner / lead contact</span>
                    {selectedProspectView.ownerName || 'Not set'}
                  </div>
                  <div className="key-value-card">
                    <span className="key-value-label">Website</span>
                    {selectedProspectView.website || 'Not set'}
                  </div>
                  <div className="key-value-card">
                    <span className="key-value-label">Next action</span>
                    {formatDateOnly(selectedProspectView.nextActionAt)}
                  </div>
                  <div className="key-value-card">
                    <span className="key-value-label">Last call outcome</span>
                    {selectedProspectView.lastCallOutcome || 'No outcome logged'}
                  </div>
                  <div className="key-value-card">
                    <span className="key-value-label">Clinic type</span>
                    {selectedProspectView.profile.clinicType || 'Not set'}
                  </div>
                  <div className="key-value-card">
                    <span className="key-value-label">ZIP focus</span>
                    {selectedProspectView.profile.zipCode || 'Not set'}
                  </div>
                  <div className="key-value-card">
                    <span className="key-value-label">Predicted revenue</span>
                    {selectedProspectView.profile.predictedRevenue || 'Not set'}
                  </div>
                  <div className="key-value-card">
                    <span className="key-value-label">Lead source</span>
                    {selectedProspectView.profile.source || 'Manual add'}
                  </div>
                  <div className="key-value-card">
                    <span className="key-value-label">Import batch</span>
                    {selectedProspectView.profile.importBatch || 'Not set'}
                  </div>
                  <div className="key-value-card">
                    <span className="key-value-label">Source record</span>
                    {selectedProspectView.profile.sourceRecord || 'Not set'}
                  </div>
                </div>

                <section className="panel-stack">
                  <div className="metric-label">Notes</div>
                  {selectedProspectView.plainNotes ? (
                    <div className="key-value-card pre-wrap">{selectedProspectView.plainNotes}</div>
                  ) : (
                    <div className="empty-state">No notes yet. Use the Add Prospect form to capture context on the next clinic.</div>
                  )}
                </section>

                <section className="panel-stack">
                  <div className="metric-label">Call history</div>
                  {selectedProspectView.callLogs.length === 0 ? (
                    <div className="empty-state">No call history has been logged for this prospect yet.</div>
                  ) : (
                    <div className="status-list">
                      {selectedProspectView.callLogs.map((call) => (
                        <div key={call.id} className="status-item" style={{ alignItems: 'flex-start' }}>
                          <div className="panel-stack" style={{ gap: 6 }}>
                            <span className="status-label">
                              <span className="status-dot ok" />
                              {call.outcome}
                            </span>
                            <span className="tiny-muted">
                              {formatDateTime(call.createdAt)}
                              {typeof call.durationSeconds === 'number' ? ` • ${call.durationSeconds}s` : ''}
                            </span>
                            <span className="text-muted">{call.notes || 'No call notes captured.'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="panel-stack">
                  <div className="metric-label">SMS thread</div>
                  <div className="empty-state">
                    No SMS thread data is attached to this prospect yet. This screen will only show text history after the clinic is moved into a live contact and conversation flow.
                  </div>
                </section>
              </>
            )}
          </section>
        </div>
      </div>
    </LayoutShell>
  );
}
