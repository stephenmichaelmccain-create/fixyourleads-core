import { ProspectStatus } from '@prisma/client';
import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { isDemoLabel } from '@/lib/demo';
import { safeLoad } from '@/lib/ui-data';
import { createProspectAction, updateProspectOutcomeAction } from './actions';

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
  status?: string;
  city?: string;
  nextActionDue?: string;
  added?: string;
  updated?: string;
  error?: string;
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
  status,
  city,
  nextActionDue
}: {
  prospectId?: string;
  status?: string;
  city?: string;
  nextActionDue?: string;
}) {
  const params = new URLSearchParams();

  if (prospectId) {
    params.set('prospectId', prospectId);
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
  return query ? `/our-leads?${query}` : '/our-leads';
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
  const selectedCity = String(params.city || '').trim();
  const selectedDue = String(params.nextActionDue || '').trim();
  const selectedProspectId = String(params.prospectId || '').trim();
  const added = params.added === '1';
  const updated = String(params.updated || '').trim();
  const error = String(params.error || '').trim();
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

  const cityOptions = Array.from(
    new Set(
      allProspects
        .map((prospect) => prospect.city?.trim())
        .filter((value): value is string => Boolean(value))
    )
  ).sort((left, right) => left.localeCompare(right));

  const visibleProspects = [...allProspects]
    .filter((prospect) => (selectedStatus ? prospect.status === selectedStatus : true))
    .filter((prospect) => (selectedCity ? prospect.city === selectedCity : true))
    .filter((prospect) => dueBucketMatches(prospect.nextActionAt, selectedDue, now))
    .sort(compareProspects);

  const selectedProspect = selectedProspectId
    ? await safeLoad(
        () =>
          db.prospect.findUnique({
            where: { id: selectedProspectId },
            include: {
              callLogs: {
                orderBy: { createdAt: 'desc' }
              }
            }
          }),
        null
      )
    : null;

  const totalProspects = allProspects.length;
  const overdueCount = allProspects.filter((prospect) => dueBucketMatches(prospect.nextActionAt, 'overdue', now)).length;
  const dueTodayCount = allProspects.filter((prospect) => dueBucketMatches(prospect.nextActionAt, 'today', now)).length;
  const bookedDemoCount = allProspects.filter((prospect) => prospect.status === ProspectStatus.BOOKED_DEMO).length;
  const soldCount = allProspects.filter((prospect) => prospect.status === ProspectStatus.CLOSED).length;
  const waitingForSignup = [...allProspects]
    .filter((prospect) => prospect.status === ProspectStatus.CLOSED)
    .sort(compareProspects)
    .slice(0, 6);
  const activeSelection = selectedProspect
    ? `${selectedProspect.name}${selectedProspect.city ? ` • ${selectedProspect.city}` : ''}`
    : 'No prospect selected';

  const errorMessage =
    error === 'name_required'
      ? 'Name is required to add a prospect.'
      : error === 'invalid_next_action'
        ? 'Next action must be a valid date and time.'
        : error
          ? 'The prospect could not be saved. Try again.'
          : '';

  return (
    <LayoutShell
      title="Our Leads"
      description="Work the clinic prospect queue in one screen: add new targets, filter the board fast, and open notes and call history without losing the list."
      section="our-leads"
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
        </section>
      )}

      <div className="metric-grid">
        <section className="metric-card panel-stack">
          <div className="metric-label">Prospects</div>
          <div className="metric-value">{totalProspects}</div>
          <div className="metric-copy">All clinics currently in the outbound queue.</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Overdue follow-up</div>
          <div className="metric-value">{overdueCount}</div>
          <div className="metric-copy">Prospects whose next action date already slipped.</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Due today</div>
          <div className="metric-value">{dueTodayCount}</div>
          <div className="metric-copy">Follow-up work that should get touched before the day ends.</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Booked meetings</div>
          <div className="metric-value">{bookedDemoCount}</div>
          <div className="metric-copy">Prospects already moved into a booked outcome.</div>
        </section>
        <section className="metric-card panel-stack">
          <div className="metric-label">Waiting for signup</div>
          <div className="metric-value">{soldCount}</div>
          <div className="metric-copy">Sold clinics waiting to complete website signup or onboarding.</div>
        </section>
      </div>

      {waitingForSignup.length > 0 && (
        <section className="panel panel-stack">
          <div className="inline-row justify-between">
            <div className="panel-stack">
              <div className="metric-label">Waiting for signup</div>
              <h2 className="section-title">Sold clinics still waiting to come in through the website.</h2>
            </div>
            <span className="status-chip status-chip-attention">
              <strong>Queue</strong> {waitingForSignup.length}
            </span>
          </div>
          <div className="workspace-list">
            {waitingForSignup.map((prospect) => (
              <a
                key={prospect.id}
                className="workspace-list-item"
                href={buildPageHref({
                  prospectId: prospect.id,
                  status: selectedStatus,
                  city: selectedCity,
                  nextActionDue: selectedDue
                })}
              >
                <div className="workspace-list-header">
                  <div className="inline-row">
                    <strong>{prospect.name}</strong>
                    {isDemoLabel(prospect.name) ? <span className="status-chip status-chip-muted">Demo</span> : null}
                  </div>
                  <span className="status-chip status-chip-muted">Sold</span>
                </div>
                <div className="tiny-muted">
                  {prospect.city || 'City not set'} • {prospect.website || 'No website'}
                </div>
                <div className="inline-row text-muted">
                  <span>Next action: {formatDateOnly(prospect.nextActionAt)}</span>
                  <span>{prospect.lastCallOutcome || 'Sold - waiting for signup'}</span>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      <div className="conversation-layout">
        <div className="page-stack">
          <section className="panel panel-stack" id="add-prospect">
            <div className="inline-row justify-between">
              <div className="panel-stack">
                <div className="metric-label">Add prospect</div>
                <h2 className="form-title">Drop a clinic into the queue without leaving the board.</h2>
                <p className="page-copy">
                  Capture the name, best phone number, city, and next action once. The table below stays dense so operators can move quickly after the prospect lands.
                </p>
              </div>
            </div>

            <form action={createProspectAction} className="workspace-filter-form">
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
                    Owner / lead contact
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
                    Next action due
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
                  placeholder="Front desk notes, objections, offer angle, or anything the next caller should know."
                />
              </div>

              <div className="workspace-filter-actions">
                <button type="submit" className="button">
                  Add prospect
                </button>
                <span className="tiny-muted">New prospects open in the detail rail immediately after save.</span>
              </div>
            </form>
          </section>

          <section className="panel panel-stack">
            <div className="inline-row justify-between">
              <div className="panel-stack">
                <div className="metric-label">Prospect board</div>
                <h2 className="section-title">Filter once, then click straight into the next clinic to work.</h2>
              </div>
              <div className="status-chip">
                <strong>Visible</strong> {visibleProspects.length}
              </div>
            </div>

            <form action="/our-leads" className="workspace-filter-form">
              <div className="workspace-filter-row">
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
                <a className="button-ghost" href="/our-leads">
                  Reset
                </a>
              </div>
            </form>

            {visibleProspects.length === 0 ? (
              <div className="empty-state">
                No prospects match the current filters. Reset the board or add a new med spa at the top.
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
                      gridTemplateColumns: '2fr 1.1fr 1.2fr 0.9fr 1.1fr 1.1fr',
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
                    <span>Owner / website</span>
                    <span>Phone</span>
                    <span>Status</span>
                    <span>Last call</span>
                    <span>Next action</span>
                  </div>

                  {visibleProspects.map((prospect) => {
                    const rowHref = buildPageHref({
                      prospectId: prospect.id,
                      status: selectedStatus,
                      city: selectedCity,
                      nextActionDue: selectedDue
                    });
                    const lastTouch = prospect.callLogs[0]?.createdAt || prospect.lastCallAt || prospect.updatedAt;
                    const selected = prospect.id === selectedProspectId;

                    return (
                      <a
                        key={prospect.id}
                        href={rowHref}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '2fr 1.1fr 1.2fr 0.9fr 1.1fr 1.1fr',
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
                            {prospect.city || 'City not set'}
                            {prospect.notes ? ' • Notes on file' : ''}
                          </span>
                        </div>
                        <div className="record-stack">
                          <span>{prospect.ownerName || 'Owner not set'}</span>
                          <span className="tiny-muted">{prospect.website || 'No website'}</span>
                        </div>
                        <div className="record-stack">
                          <span>{prospect.phone || 'No phone'}</span>
                          <span className="tiny-muted">
                            {prospect.lastCallOutcome || prospect.callLogs[0]?.outcome || 'No call outcome yet'}
                          </span>
                        </div>
                        <div>
                          <span className={statusChipClass(prospect.status)}>
                            <strong>Status</strong> {humanizeStatus(prospect.status)}
                          </span>
                        </div>
                        <div className="record-stack">
                          <span>{formatDateTime(lastTouch)}</span>
                          <span className="tiny-muted">{prospect.lastCallAt ? 'Logged call' : 'Recent activity'}</span>
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
                {selectedProspect && isDemoLabel(selectedProspect.name) ? (
                  <span className="status-chip status-chip-muted">Demo</span>
                ) : null}
              </div>
              {selectedProspect ? (
                <a
                  className="button-ghost"
                  href={buildPageHref({
                    status: selectedStatus,
                    city: selectedCity,
                    nextActionDue: selectedDue
                  })}
                >
                  Close
                </a>
              ) : null}
            </div>

            {!selectedProspect ? (
              <div className="empty-state">
                Click any row in the prospect board to open notes, call history, and the next-action summary here.
              </div>
            ) : (
              <>
                <div className="inline-actions">
                  {selectedProspect.phone ? (
                    <a className="button" href={`tel:${selectedProspect.phone}`}>
                      Call now
                    </a>
                  ) : null}
                  {selectedProspect.website ? (
                    <a className="button-secondary" href={websiteHref(selectedProspect.website)} target="_blank" rel="noreferrer">
                      Open website
                    </a>
                  ) : null}
                </div>

                <form action={updateProspectOutcomeAction} className="panel panel-stack">
                  <div className="metric-label">Quick call outcome</div>
                  <input type="hidden" name="prospectId" value={selectedProspect.id} />
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

                <div className="key-value-grid">
                  <div className="key-value-card">
                    <span className="key-value-label">Phone</span>
                    {selectedProspect.phone || 'Not set'}
                  </div>
                  <div className="key-value-card">
                    <span className="key-value-label">City</span>
                    {selectedProspect.city || 'Not set'}
                  </div>
                  <div className="key-value-card">
                    <span className="key-value-label">Owner / lead contact</span>
                    {selectedProspect.ownerName || 'Not set'}
                  </div>
                  <div className="key-value-card">
                    <span className="key-value-label">Website</span>
                    {selectedProspect.website || 'Not set'}
                  </div>
                  <div className="key-value-card">
                    <span className="key-value-label">Next action</span>
                    {formatDateOnly(selectedProspect.nextActionAt)}
                  </div>
                  <div className="key-value-card">
                    <span className="key-value-label">Last call outcome</span>
                    {selectedProspect.lastCallOutcome || 'No outcome logged'}
                  </div>
                </div>

                <section className="panel-stack">
                  <div className="metric-label">Notes</div>
                  {selectedProspect.notes ? (
                    <div className="key-value-card pre-wrap">{selectedProspect.notes}</div>
                  ) : (
                    <div className="empty-state">No notes yet. Use the Add Prospect form to capture context on the next clinic.</div>
                  )}
                </section>

                <section className="panel-stack">
                  <div className="metric-label">Call history</div>
                  {selectedProspect.callLogs.length === 0 ? (
                    <div className="empty-state">No call history has been logged for this prospect yet.</div>
                  ) : (
                    <div className="status-list">
                      {selectedProspect.callLogs.map((call) => (
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
                    No SMS thread data is attached to this prospect yet. This screen will only show text history after the med spa is moved into a live contact and conversation flow.
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
