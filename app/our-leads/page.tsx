import { ProspectStatus } from '@prisma/client';
import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { isDemoLabel } from '@/lib/demo';
import { parseProspectNotes } from '@/lib/prospect-metadata';
import { safeLoad } from '@/lib/ui-data';
import {
  createProspectAction,
  scheduleProspectCallbackAction,
  updateProspectDetailsAction,
  updateProspectOutcomeAction
} from './actions';

export const dynamic = 'force-dynamic';

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
  duplicateCompanyId?: string;
  draftName?: string;
  draftPhone?: string;
  draftCity?: string;
  draftOwnerName?: string;
  draftWebsite?: string;
  draftNextActionAt?: string;
  draftNotes?: string;
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

function websiteLabel(website?: string | null) {
  const href = websiteHref(website);

  if (!href) {
    return 'Not set';
  }

  try {
    return new URL(href).hostname.replace(/^www\./i, '');
  } catch {
    return href.replace(/^https?:\/\//i, '').split('/')[0];
  }
}

function formatDateTimeInput(date?: Date | null) {
  if (!date) {
    return '';
  }

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function detailValue(value?: string | null, fallback = 'Not set') {
  const trimmed = String(value || '').trim();
  return trimmed || fallback;
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

function queueChipLabel(status: ProspectStatus) {
  switch (status) {
    case ProspectStatus.NEW:
      return 'New';
    case ProspectStatus.NO_ANSWER:
      return 'No answer';
    case ProspectStatus.VM_LEFT:
      return 'Voicemail';
    case ProspectStatus.GATEKEEPER:
      return 'Callback';
    case ProspectStatus.BOOKED_DEMO:
      return 'Booked';
    case ProspectStatus.CLOSED:
      return 'Sold';
    case ProspectStatus.DEAD:
      return 'Dead';
    default:
      return humanizeStatus(status);
  }
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
  const duplicateCompanyId = String(params.duplicateCompanyId || '').trim();
  const draftValues = {
    name: String(params.draftName || '').trim(),
    phone: String(params.draftPhone || '').trim(),
    city: String(params.draftCity || '').trim(),
    ownerName: String(params.draftOwnerName || '').trim(),
    website: String(params.draftWebsite || '').trim(),
    nextActionAt: String(params.draftNextActionAt || '').trim(),
    notes: String(params.draftNotes || '').trim()
  };
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

  const queueCounts = {
    all: prospectRows.length,
    overdue: prospectRows.filter((prospect) => dueBucketMatches(prospect.nextActionAt, 'overdue', now)).length,
    today: prospectRows.filter((prospect) => dueBucketMatches(prospect.nextActionAt, 'today', now)).length,
    waiting: prospectRows.filter((prospect) => prospect.status === ProspectStatus.GATEKEEPER).length,
    booked: prospectRows.filter((prospect) => prospect.status === ProspectStatus.BOOKED_DEMO).length
  };

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
  const duplicateLeadHref = selectedProspectId ? `${buildPageHref({ prospectId: selectedProspectId })}#selected-lead` : '/leads';
  const duplicateCompanyHref = duplicateCompanyId ? `/clients/${duplicateCompanyId}` : '/clients';

  const errorMessage =
    error === 'name_required'
      ? 'Name is required to add a prospect.'
      : error === 'invalid_next_action'
        ? 'Next action must be a valid date and time.'
      : error === 'duplicate'
          ? duplicateReason === 'website'
            ? 'This clinic is already in the leads queue with the same website.'
            : duplicateReason === 'phone'
              ? 'This clinic is already in the leads queue with the same phone number.'
              : duplicateReason === 'master_phone'
                ? 'This clinic already exists in the contacted-company master list with the same phone number.'
                : duplicateReason === 'master_name'
                  ? 'This clinic already exists in the contacted-company master list with the same company name.'
                  : 'This clinic already exists in the leads queue.'
        : error
          ? 'The prospect could not be saved. Try again.'
          : '';
  const shouldOpenAddProspect = error !== 'duplicate' && Boolean(errorMessage || Object.values(draftValues).some((value) => value));

  return (
    <LayoutShell title="Leads" section="leads" variant="workspace">
      {updated || added || errorMessage ? (
        <section className="panel prospect-update-bar">
          {updated ? (
            <span className="inline-row">
              <span className="status-dot ok" />
              {updated === 'no_answer'
                ? 'No answer saved'
                : updated === 'voicemail'
                  ? 'Voicemail saved'
                  : updated === 'not_interested'
                    ? 'Not interested saved'
                    : updated === 'callback'
                      ? 'Callback scheduled'
                      : updated === 'do_not_contact'
                        ? 'Suppressed'
                        : updated === 'booked'
                          ? 'Marked booked'
                          : updated === 'sold'
                            ? 'Marked sold'
                            : updated === 'details'
                              ? 'Lead details saved'
                            : 'Lead updated'}
            </span>
          ) : null}
          {added ? (
            <span className="inline-row">
              <span className="status-dot ok" />
              Lead added
            </span>
          ) : null}
          {errorMessage ? (
            <span className="inline-row">
              <span className="status-dot error" />
              {errorMessage}
            </span>
          ) : null}
          {error === 'duplicate' && selectedProspectId ? (
            <a className="button-ghost" href={duplicateLeadHref}>
              Open matching lead
            </a>
          ) : null}
          {error === 'duplicate' && duplicateCompanyId ? (
            <a className="button-ghost" href={duplicateCompanyHref}>
              Open contacted company
            </a>
          ) : null}
          {updated === 'invalid_details' ? (
            <span className="inline-row">
              <span className="status-dot error" />
              Follow-up date must be a valid date and time.
            </span>
          ) : null}
        </section>
      ) : null}

      <div className="conversation-layout">
        <div className="page-stack">
          <section className="panel panel-stack">
            <div className="workspace-search-bar">
              <form action="/leads" className="workspace-search-bar" style={{ flex: 1 }}>
                <input
                  id="our-leads-search"
                  name="q"
                  className="text-input"
                  defaultValue={searchQuery}
                  placeholder="Search clinic, phone, website, contact, city"
                />
                {selectedCity ? <input type="hidden" name="city" value={selectedCity} /> : null}
                <button type="submit" className="button-ghost">
                  Search
                </button>
              </form>
              {searchQuery || selectedStatus || selectedCity || selectedDue ? (
                <a className="button-secondary prospect-reset-trigger" href="/leads">
                  Reset view
                </a>
              ) : null}
              <details className="prospect-add-drawer" id="add-prospect" open={shouldOpenAddProspect}>
                <summary className="button-secondary prospect-add-trigger">Add lead</summary>
                <form action={createProspectAction} className="workspace-filter-form" style={{ marginTop: 12 }}>
                  <input type="hidden" name="viewQ" value={searchQuery} />
                  <input type="hidden" name="viewStatus" value={selectedStatus} />
                  <input type="hidden" name="viewCity" value={selectedCity} />
                  <input type="hidden" name="viewNextActionDue" value={selectedDue} />
                  <div className="workspace-filter-row">
                    <div className="field-stack">
                      <label className="key-value-label" htmlFor="prospect-name">
                        Business name
                      </label>
                      <input
                        id="prospect-name"
                        name="name"
                        className="text-input"
                        defaultValue={draftValues.name}
                        placeholder="Glow Med Spa"
                        required
                      />
                    </div>
                    <div className="field-stack">
                      <label className="key-value-label" htmlFor="prospect-phone">
                        Phone
                      </label>
                      <input
                        id="prospect-phone"
                        name="phone"
                        className="text-input"
                        defaultValue={draftValues.phone}
                        placeholder="(555) 555-5555"
                      />
                    </div>
                    <div className="field-stack">
                      <label className="key-value-label" htmlFor="prospect-city">
                        City
                      </label>
                      <input
                        id="prospect-city"
                        name="city"
                        className="text-input"
                        defaultValue={draftValues.city}
                        placeholder="Austin"
                      />
                    </div>
                    <div className="field-stack">
                      <label className="key-value-label" htmlFor="prospect-owner-name">
                        Contact
                      </label>
                      <input
                        id="prospect-owner-name"
                        name="ownerName"
                        className="text-input"
                        defaultValue={draftValues.ownerName}
                        placeholder="Jamie Reed"
                      />
                    </div>
                    <div className="field-stack">
                      <label className="key-value-label" htmlFor="prospect-website">
                        Website
                      </label>
                      <input
                        id="prospect-website"
                        name="website"
                        className="text-input"
                        defaultValue={draftValues.website}
                        placeholder="glowmedspa.com"
                      />
                    </div>
                    <div className="field-stack">
                      <label className="key-value-label" htmlFor="prospect-next-action">
                        Next action
                      </label>
                      <input
                        id="prospect-next-action"
                        name="nextActionAt"
                        type="datetime-local"
                        className="text-input"
                        defaultValue={draftValues.nextActionAt}
                      />
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
                      defaultValue={draftValues.notes}
                      placeholder="Anything the next caller should know."
                    />
                  </div>

                  <div className="workspace-filter-actions">
                    <button type="submit" className="button">
                      Save lead
                    </button>
                  </div>
                </form>
              </details>
            </div>

            <div className="prospect-stats-strip">
              <span>
                <strong>{queueCounts.all}</strong> total
              </span>
              <span>
                <strong>{queueCounts.overdue}</strong> overdue
              </span>
              <span>
                <strong>{queueCounts.today}</strong> today
              </span>
              <span>
                <strong>{queueCounts.waiting}</strong> waiting
              </span>
              <span>
                <strong>{queueCounts.booked}</strong> booked
              </span>
            </div>

            <div className="filter-bar">
              <a className={`filter-chip${!selectedStatus && !selectedDue ? ' is-active' : ''}`} href={buildPageHref({ q: searchQuery, city: selectedCity })}>
                All
              </a>
              <a
                className={`filter-chip${selectedDue === 'overdue' ? ' is-active' : ''}`}
                href={buildPageHref({ q: searchQuery, city: selectedCity, nextActionDue: 'overdue' })}
              >
                Overdue {queueCounts.overdue}
              </a>
              <a
                className={`filter-chip${selectedDue === 'today' ? ' is-active' : ''}`}
                href={buildPageHref({ q: searchQuery, city: selectedCity, nextActionDue: 'today' })}
              >
                Today {queueCounts.today}
              </a>
              {Object.values(ProspectStatus).map((status) => (
                <a
                  key={status}
                  className={`filter-chip${selectedStatus === status ? ' is-active' : ''}`}
                  href={buildPageHref({ q: searchQuery, city: selectedCity, status })}
                >
                  {queueChipLabel(status)}
                </a>
              ))}
            </div>

            {visibleProspects.length === 0 ? (
              <div className="empty-state">
                <div>No leads in this view.</div>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Clinic</th>
                      <th>Contact</th>
                      <th>Status</th>
                      <th>Last touch</th>
                      <th>Next action</th>
                    </tr>
                  </thead>
                  <tbody>
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
                        <tr key={prospect.id} className={selected ? 'prospect-row-selected' : ''}>
                          <td>
                            <a className="table-link" href={rowHref}>
                              <div className="record-stack">
                                <span className="inline-row">
                                  <strong>{prospect.name}</strong>
                                  {isDemoLabel(prospect.name) ? <span className="status-chip status-chip-muted">Demo</span> : null}
                                </span>
                                <span className="tiny-muted">
                                  {prospect.profile.clinicType || 'Clinic'}{prospect.city ? ` · ${prospect.city}` : ''}
                                </span>
                              </div>
                            </a>
                          </td>
                          <td>
                            <div className="record-stack">
                              <span>{prospect.phone || 'No phone'}</span>
                              <span className="tiny-muted">
                                {[prospect.ownerName, prospect.website ? websiteLabel(prospect.website) : null].filter(Boolean).join(' · ') || 'No contact info'}
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className="record-stack">
                              <span className={statusChipClass(prospect.status)}>{humanizeStatus(prospect.status)}</span>
                              <span className="tiny-muted">{prospect.profile.source || 'Manual add'}</span>
                            </div>
                          </td>
                          <td>
                            <div className="record-stack">
                              <span>{formatDateTime(lastTouch)}</span>
                              <span className="tiny-muted">{prospect.lastCallOutcome || prospect.callLogs[0]?.outcome || 'Recent activity'}</span>
                            </div>
                          </td>
                          <td>
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
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {selectedProspectView ? (
              <section className="lead-master-card" id="selected-lead">
                <div className="lead-master-header">
                  <div className="record-stack">
                    <h2 className="form-title lead-company-name">{selectedProspectView.name}</h2>
                    <div className="tiny-muted">
                      {detailValue(selectedProspectView.ownerName, 'No contact name')}
                      {selectedProspectView.city ? ` · ${selectedProspectView.city}` : ''}
                      {selectedProspectView.profile.clinicType ? ` · ${selectedProspectView.profile.clinicType}` : ''}
                      {selectedProspectView.profile.source ? ` · ${selectedProspectView.profile.source}` : ' · Manual add'}
                      {selectedProspectView.website ? ` · ${websiteLabel(selectedProspectView.website)}` : ''}
                    </div>
                  </div>
                  <div className="inline-row inline-actions-wrap">
                    <span className={statusChipClass(selectedProspectView.status)}>{humanizeStatus(selectedProspectView.status)}</span>
                    {selectedProspectView.website ? (
                      <a
                        className="button-secondary button-secondary-strong"
                        href={websiteHref(selectedProspectView.website)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open website
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="lead-identity-grid lead-identity-grid-wide">
                  <div className="lead-identity-item">
                    <span className="key-value-label">Phone</span>
                    <strong>{detailValue(selectedProspectView.phone)}</strong>
                  </div>
                  <div className="lead-identity-item">
                    <span className="key-value-label">Contact</span>
                    <strong>{detailValue(selectedProspectView.ownerName)}</strong>
                  </div>
                  <div className="lead-identity-item">
                    <span className="key-value-label">Location</span>
                    <strong>{detailValue(selectedProspectView.city)}</strong>
                  </div>
                  <div className="lead-identity-item">
                    <span className="key-value-label">Last touch</span>
                    <strong>{formatDateTime(selectedProspectView.callLogs[0]?.createdAt || selectedProspectView.lastCallAt || selectedProspectView.updatedAt)}</strong>
                  </div>
                  <div className="lead-identity-item">
                    <span className="key-value-label">Next action</span>
                    <strong>{formatDateTime(selectedProspectView.nextActionAt)}</strong>
                  </div>
                  <div className="lead-identity-item">
                    <span className="key-value-label">Website</span>
                    <strong>{websiteLabel(selectedProspectView.website)}</strong>
                    <span className="tiny-muted">{websiteHref(selectedProspectView.website) || 'No website set'}</span>
                  </div>
                </div>
              </section>
            ) : null}
          </section>
        </div>

        <div className="conversation-sidebar">
          <section className="panel panel-stack sticky-panel">
            {!selectedProspectView ? (
              <div className="empty-state">
                Pick a clinic from the queue to call, schedule, or update.
              </div>
            ) : (
              <>
                <div className="inline-row justify-between lead-sidebar-header">
                  <div className="record-stack">
                    <span className="key-value-label">Lead actions</span>
                    <h2 className="form-title">Call and follow-up</h2>
                    <div className="tiny-muted">Update the outcome, callback date, notes, and history for the selected clinic.</div>
                  </div>
                  {selectedProspectView && isDemoLabel(selectedProspectView.name) ? (
                    <span className="status-chip status-chip-muted">Demo</span>
                  ) : null}
                </div>

                <div className="inline-actions inline-actions-wrap">
                  {selectedProspectView.phone ? (
                    <a className="button" href={`tel:${selectedProspectView.phone}`}>
                      Call now
                    </a>
                  ) : null}
                </div>

                <form action={updateProspectOutcomeAction} className="panel panel-stack">
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
                </form>

                <form action={scheduleProspectCallbackAction} className="panel panel-stack">
                  <div className="inline-row justify-between">
                    <div className="metric-label">Callback</div>
                    <div className="tiny-muted">{formatDateOnly(selectedProspectView.nextActionAt)}</div>
                  </div>
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
                </form>

                <form action={updateProspectDetailsAction} className="panel panel-stack">
                  <div className="inline-row justify-between">
                    <div className="metric-label">Lead notes and follow-up</div>
                    <div className="tiny-muted">Tracked on this lead</div>
                  </div>
                  <input type="hidden" name="prospectId" value={selectedProspectView.id} />
                  <input type="hidden" name="q" value={searchQuery} />
                  <input type="hidden" name="status" value={selectedStatus} />
                  <input type="hidden" name="city" value={selectedCity} />
                  <input type="hidden" name="nextActionDue" value={selectedDue} />
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="lead-next-action-at">
                      Follow-up date
                    </label>
                    <input
                      id="lead-next-action-at"
                      name="nextActionAt"
                      type="datetime-local"
                      className="text-input"
                      defaultValue={formatDateTimeInput(selectedProspectView.nextActionAt)}
                    />
                  </div>
                  <div className="field-stack">
                    <label className="key-value-label" htmlFor="lead-notes-editor">
                      Notes
                    </label>
                    <textarea
                      id="lead-notes-editor"
                      name="notes"
                      className="text-area"
                      defaultValue={selectedProspectView.plainNotes}
                      placeholder="Anything the next caller should know."
                    />
                  </div>
                  <div className="inline-actions">
                    <button type="submit" className="button-secondary button-secondary-strong">
                      Save changes
                    </button>
                  </div>
                </form>

                <details className="routing-details" open={selectedProspectView.callLogs.length > 0}>
                  <summary className="routing-summary">
                    <span className="metric-label">Call history</span>
                    <span className="tiny-muted">{selectedProspectView.callLogs.length}</span>
                  </summary>
                  {selectedProspectView.callLogs.length === 0 ? (
                    <div className="empty-state">No calls logged yet.</div>
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
                </details>

                <details className="routing-details">
                  <summary className="routing-summary">
                    <span className="metric-label">Lead context</span>
                    <span className="tiny-muted">Extra details</span>
                  </summary>
                  <div className="key-value-grid">
                    <div className="key-value-card">
                      <span className="key-value-label">Created</span>
                      <span>{formatDateTime(selectedProspectView.createdAt)}</span>
                    </div>
                    <div className="key-value-card">
                      <span className="key-value-label">Updated</span>
                      <span>{formatDateTime(selectedProspectView.updatedAt)}</span>
                    </div>
                    <div className="key-value-card">
                      <span className="key-value-label">Source</span>
                      <span>{detailValue(selectedProspectView.profile.source, 'Manual add')}</span>
                    </div>
                    <div className="key-value-card">
                      <span className="key-value-label">Clinic type</span>
                      <span>{detailValue(selectedProspectView.profile.clinicType)}</span>
                    </div>
                    <div className="key-value-card">
                      <span className="key-value-label">ZIP</span>
                      <span>{detailValue(selectedProspectView.profile.zipCode)}</span>
                    </div>
                    <div className="key-value-card">
                      <span className="key-value-label">Predicted revenue</span>
                      <span>{detailValue(selectedProspectView.profile.predictedRevenue)}</span>
                    </div>
                    <div className="key-value-card">
                      <span className="key-value-label">Import batch</span>
                      <span>{detailValue(selectedProspectView.profile.importBatch)}</span>
                    </div>
                    <div className="key-value-card">
                      <span className="key-value-label">Source record</span>
                      <span>{detailValue(selectedProspectView.profile.sourceRecord)}</span>
                    </div>
                  </div>
                  {selectedProspectView.website ? (
                    <div className="inline-actions">
                      <a
                        className="button-ghost"
                        href={websiteHref(selectedProspectView.website)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open full website
                      </a>
                    </div>
                  ) : null}
                </details>
              </>
            )}
          </section>
        </div>
      </div>
    </LayoutShell>
  );
}
