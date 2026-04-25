import { ProspectStatus } from '@prisma/client';
import Link from 'next/link';
import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { parseProspectNotes } from '@/lib/prospect-metadata';
import { safeLoad } from '@/lib/ui-data';
import { LeadQueueAutoCenter } from './LeadQueueAutoCenter';
import {
  bulkCreateProspectsAction,
  createProspectAction,
  scheduleProspectCallbackAction,
  updateProspectDetailsAction,
  updateProspectOutcomeAction
} from './actions';

export const dynamic = 'force-dynamic';

type SearchParamShape = Promise<{
  prospectId?: string;
  q?: string;
  view?: string;
  status?: string;
  city?: string;
  nextActionDue?: string;
  added?: string;
  bulkAdded?: string;
  bulkSkipped?: string;
  bulkSkippedDuplicates?: string;
  bulkSkippedInvalid?: string;
  bulkError?: string;
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
  view,
  status,
  city,
  nextActionDue
}: {
  prospectId?: string;
  q?: string;
  view?: string;
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

  if (view) {
    params.set('view', view);
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

function isUntouchedProspect(prospect: { lastCallAt: Date | null; callLogs: Array<{ createdAt: Date }> }) {
  return !prospect.lastCallAt && !prospect.callLogs[0]?.createdAt;
}

function nextActionState(date: Date | null, now: Date) {
  if (!date) {
    return 'Needs scheduling';
  }

  if (dueBucketMatches(date, 'overdue', now)) {
    return 'Past due';
  }

  if (dueBucketMatches(date, 'today', now)) {
    return 'Due today';
  }

  return 'Scheduled';
}

function callbackSummary(date: Date | null, now: Date) {
  if (!date) {
    return 'Not set';
  }

  const todayStart = startOfDay(now);
  const tomorrowStart = endOfDay(now);
  const dayAfterTomorrow = endOfDay(tomorrowStart);

  if (date < todayStart) {
    return 'Past due';
  }

  if (date >= todayStart && date < tomorrowStart) {
    return 'Due today';
  }

  if (date >= tomorrowStart && date < dayAfterTomorrow) {
    return 'Tomorrow';
  }

  const diffDays = Math.round((startOfDay(date).getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays === 3) {
    return 'In 3 days';
  }

  if (diffDays === 7) {
    return 'In 1 week';
  }

  if (diffDays === 30) {
    return 'In 1 month';
  }

  return 'Scheduled';
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
  const selectedView = String(params.view || '').trim() === 'all' ? 'all' : '';
  const searchQuery = String(params.q || '').trim();
  const normalizedSearchQuery = normalizeSearch(searchQuery);
  const selectedCity = String(params.city || '').trim();
  const selectedDue = String(params.nextActionDue || '').trim();
  const selectedProspectId = String(params.prospectId || '').trim();
  const added = params.added === '1';
  const bulkAdded = Number.parseInt(String(params.bulkAdded || '0'), 10) || 0;
  const bulkSkippedLegacy = Number.parseInt(String(params.bulkSkipped || '0'), 10) || 0;
  const bulkSkippedDuplicates = Number.parseInt(String(params.bulkSkippedDuplicates || '0'), 10) || bulkSkippedLegacy;
  const bulkSkippedInvalid = Number.parseInt(String(params.bulkSkippedInvalid || '0'), 10) || 0;
  const bulkSkipped = bulkSkippedDuplicates + bulkSkippedInvalid;
  const bulkError = String(params.bulkError || '').trim();
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
  const showingUntouched = !selectedView && !selectedStatus && !selectedDue;

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
    .filter((prospect) => (showingUntouched ? isUntouchedProspect(prospect) : true))
    .filter((prospect) => (selectedStatus ? prospect.status === selectedStatus : true))
    .filter((prospect) => (selectedCity ? prospect.city === selectedCity : true))
    .filter((prospect) => dueBucketMatches(prospect.nextActionAt, selectedDue, now))
    .sort(compareProspects);

  const queueCounts = {
    all: prospectRows.length,
    untouched: prospectRows.filter((prospect) => isUntouchedProspect(prospect)).length,
    overdue: prospectRows.filter((prospect) => dueBucketMatches(prospect.nextActionAt, 'overdue', now)).length,
    today: prospectRows.filter((prospect) => dueBucketMatches(prospect.nextActionAt, 'today', now)).length,
    waiting: prospectRows.filter((prospect) => prospect.status === ProspectStatus.GATEKEEPER).length,
    booked: prospectRows.filter((prospect) => prospect.status === ProspectStatus.BOOKED_DEMO).length,
    noAnswer: prospectRows.filter((prospect) => prospect.status === ProspectStatus.NO_ANSWER).length,
    sold: prospectRows.filter((prospect) => prospect.status === ProspectStatus.CLOSED).length,
    dead: prospectRows.filter((prospect) => prospect.status === ProspectStatus.DEAD).length
  };

  const effectiveSelectedProspectId =
    (selectedProspectId && visibleProspects.some((prospect) => prospect.id === selectedProspectId)
      ? selectedProspectId
      : visibleProspects[0]?.id) || '';
  const selectedQueueIndex = visibleProspects.findIndex((prospect) => prospect.id === effectiveSelectedProspectId);
  const nextQueueProspect =
    selectedQueueIndex >= 0 ? visibleProspects[selectedQueueIndex + 1] || null : visibleProspects[1] || null;
  const nextQueueProspectId =
    selectedQueueIndex >= 0
      ? visibleProspects[Math.min(selectedQueueIndex + 1, Math.max(visibleProspects.length - 1, 0))]?.id || ''
      : '';

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
      : error === 'invalid_phone'
        ? 'Phone number must be valid (10–15 digits). Leave it blank if unknown.'
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
    <LayoutShell title="Leads" section="leads" variant="workspace" hidePageHeader>
      {updated || added || bulkAdded || bulkSkipped || bulkError || errorMessage ? (
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
          {bulkAdded || bulkSkipped ? (
            <span className="inline-row">
              <span className={`status-dot ${bulkAdded ? 'ok' : 'error'}`} />
              Imported {bulkAdded} lead{bulkAdded === 1 ? '' : 's'}
              {bulkSkippedDuplicates
                ? ` • skipped ${bulkSkippedDuplicates} duplicate${bulkSkippedDuplicates === 1 ? '' : 's'}`
                : ''}
              {bulkSkippedInvalid ? ` • skipped ${bulkSkippedInvalid} invalid row${bulkSkippedInvalid === 1 ? '' : 's'}` : ''}
            </span>
          ) : null}
          {bulkError ? (
            <span className="inline-row">
              <span className="status-dot error" />
              {bulkError === 'bulk_required'
                ? 'Paste at least one lead row to bulk import.'
                : 'Bulk import could not be processed.'}
            </span>
          ) : null}
          {errorMessage ? (
            <span className="inline-row">
              <span className="status-dot error" />
              {errorMessage}
            </span>
          ) : null}
          {error === 'duplicate' && selectedProspectId ? (
            <Link className="button-ghost" href={duplicateLeadHref} scroll={false}>
              Open matching lead
            </Link>
          ) : null}
          {error === 'duplicate' && duplicateCompanyId ? (
            <Link className="button-ghost" href={duplicateCompanyHref}>
              Open contacted company
            </Link>
          ) : null}
          {updated === 'invalid_details' ? (
            <span className="inline-row">
              <span className="status-dot error" />
              Follow-up date must be a valid date and time.
            </span>
          ) : null}
        </section>
      ) : null}

      <div className="conversation-layout lead-call-layout">
        <div className="page-stack lead-queue-column">
          <section className="panel panel-stack lead-queue-panel">
            <div className="workspace-search-bar">
              <form action="/leads" className="workspace-search-bar" style={{ flex: 1 }}>
                <input
                  id="our-leads-search"
                  name="q"
                  className="text-input"
                  defaultValue={searchQuery}
                  placeholder="Search clinic, phone, website, contact, city"
                />
                {selectedView ? <input type="hidden" name="view" value={selectedView} /> : null}
                {selectedCity ? <input type="hidden" name="city" value={selectedCity} /> : null}
                <button type="submit" className="button-ghost">
                  Search
                </button>
              </form>
              <div className="workspace-action-rail">
                {searchQuery || selectedStatus || selectedCity || selectedDue || selectedView ? (
                  <Link className="button-secondary prospect-reset-trigger" href="/leads" scroll={false}>
                    Reset view
                  </Link>
                ) : null}
                <details className="prospect-add-drawer" id="add-prospect" open={shouldOpenAddProspect}>
                  <summary className="button-secondary prospect-add-trigger">Add lead</summary>
                  <div className="prospect-drawer-panel">
                    <form action={createProspectAction} className="workspace-filter-form">
                  <input type="hidden" name="viewQ" value={searchQuery} />
                  <input type="hidden" name="viewMode" value={selectedView} />
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
                  </div>
                </details>
                <details className="prospect-bulk-drawer" id="bulk-prospects" open={bulkError === 'bulk_required'}>
                  <summary className="button-secondary prospect-add-trigger">Bulk leads</summary>
                  <div className="prospect-drawer-panel prospect-drawer-panel-compact">
                    <form action={bulkCreateProspectsAction} className="workspace-filter-form">
                      <input type="hidden" name="viewQ" value={searchQuery} />
                      <input type="hidden" name="viewMode" value={selectedView} />
                      <input type="hidden" name="viewStatus" value={selectedStatus} />
                      <input type="hidden" name="viewCity" value={selectedCity} />
                      <input type="hidden" name="viewNextActionDue" value={selectedDue} />
                      <div className="field-stack">
                        <label className="key-value-label" htmlFor="prospect-bulk-rows">
                          Paste rows
                        </label>
                        <textarea
                          id="prospect-bulk-rows"
                          name="rows"
                          className="text-area"
                          placeholder={'Business name, phone, city, contact, website, next action, notes\nGlow Med Spa, (555) 555-5555, Austin, Jamie Reed, glowmedspa.com'}
                        />
                        <div className="tiny-muted">
                          Paste comma, pipe, or tab-separated rows. Order: business name, phone, city, contact, website, next action, notes.
                        </div>
                      </div>
                      <div className="workspace-filter-actions">
                        <button type="submit" className="button">
                          Import leads
                        </button>
                      </div>
                    </form>
                  </div>
                </details>
              </div>
            </div>

            <div className="filter-bar">
              <Link className={`filter-chip${showingUntouched ? ' is-active' : ''}`} href={buildPageHref({ q: searchQuery, city: selectedCity })} scroll={false}>
                Untouched {queueCounts.untouched}
              </Link>
              <Link
                className={`filter-chip${selectedStatus === ProspectStatus.NO_ANSWER ? ' is-active' : ''}`}
                href={buildPageHref({ q: searchQuery, city: selectedCity, status: ProspectStatus.NO_ANSWER })}
                scroll={false}
              >
                No answer {queueCounts.noAnswer}
              </Link>
              <Link
                className={`filter-chip${selectedStatus === ProspectStatus.GATEKEEPER ? ' is-active' : ''}`}
                href={buildPageHref({ q: searchQuery, city: selectedCity, status: ProspectStatus.GATEKEEPER })}
                scroll={false}
              >
                Call back later {queueCounts.waiting}
              </Link>
              <Link
                className={`filter-chip${selectedStatus === ProspectStatus.BOOKED_DEMO ? ' is-active' : ''}`}
                href={buildPageHref({ q: searchQuery, city: selectedCity, status: ProspectStatus.BOOKED_DEMO })}
                scroll={false}
              >
                Booked {queueCounts.booked}
              </Link>
              <Link
                className={`filter-chip${selectedStatus === ProspectStatus.CLOSED ? ' is-active' : ''}`}
                href={buildPageHref({ q: searchQuery, city: selectedCity, status: ProspectStatus.CLOSED })}
                scroll={false}
              >
                Sold {queueCounts.sold}
              </Link>
              <Link
                className={`filter-chip${selectedStatus === ProspectStatus.DEAD ? ' is-active' : ''}`}
                href={buildPageHref({ q: searchQuery, city: selectedCity, status: ProspectStatus.DEAD })}
                scroll={false}
              >
                Do not contact {queueCounts.dead}
              </Link>
              <Link
                className={`filter-chip${selectedView === 'all' ? ' is-active' : ''}`}
                href={buildPageHref({ q: searchQuery, city: selectedCity, view: 'all' })}
                scroll={false}
              >
                All {queueCounts.all}
              </Link>
            </div>

            <div className="lead-queue-scroll">
              <LeadQueueAutoCenter selectedProspectId={effectiveSelectedProspectId} />
              {visibleProspects.length === 0 ? (
                <div className="empty-state">
                  <div>No leads in this view.</div>
                </div>
              ) : (
                <div className="record-grid lead-queue-list">
                {visibleProspects.map((prospect) => {
                  const rowHref = `${buildPageHref({
                    prospectId: prospect.id,
                    q: searchQuery,
                    view: selectedView,
                    status: selectedStatus,
                    city: selectedCity,
                    nextActionDue: selectedDue
                  })}#selected-lead`;
                  const lastTouch = prospect.callLogs[0]?.createdAt || prospect.lastCallAt || null;
                  const lastTouchLabel = lastTouch ? formatDateTime(lastTouch) : 'New';
                  const lastTouchMeta =
                    prospect.lastCallOutcome || prospect.callLogs[0]?.outcome || (lastTouch ? 'Recent activity' : 'Not contacted yet');
                  const selected = prospect.id === effectiveSelectedProspectId;

                  return (
                    <section
                      key={prospect.id}
                      className={`lead-master-card${selected ? ' lead-master-card-selected' : ''}`}
                      id={selected ? 'selected-lead' : undefined}
                    >
                      <Link className="lead-master-overlay" href={rowHref} aria-label={`Select ${prospect.name}`} scroll={false} />
                      <div className="lead-master-header">
                        <div className="lead-master-select">
                          <div className="lead-master-kicker">
                            {selected ? (
                              <span className="lead-selected-pill">Selected now</span>
                            ) : (
                              <span className="tiny-muted">Queue lead</span>
                            )}
                            <span className={statusChipClass(prospect.status)}>{humanizeStatus(prospect.status)}</span>
                          </div>
                          <div className="record-stack">
                            <h2 className="form-title lead-company-name">{prospect.name}</h2>
                            <div className="lead-queue-subline">
                              {detailValue(prospect.ownerName, 'No contact name')}
                              {prospect.city ? ` · ${prospect.city}` : ''}
                              {prospect.profile.source ? ` · ${prospect.profile.source}` : ' · Manual add'}
                              {prospect.website ? ` · ${websiteLabel(prospect.website)}` : ''}
                            </div>
                          </div>

                          <div className="lead-queue-body">
                            <div className="lead-queue-timing">
                              <div className="lead-queue-timing-item">
                                <span className="key-value-label">Last touch</span>
                                <strong className="lead-compact-value">{lastTouchLabel}</strong>
                                <span className="tiny-muted">{lastTouchMeta}</span>
                              </div>
                              <div className="lead-queue-timing-item">
                                <span className="key-value-label">Next action</span>
                                <strong className="lead-compact-value">{formatDateTime(prospect.nextActionAt)}</strong>
                                <span className="tiny-muted">{nextActionState(prospect.nextActionAt, now)}</span>
                              </div>
                            </div>
                            <div className="lead-queue-phone">{detailValue(prospect.phone)}</div>
                          </div>
                        </div>
                      </div>

                      <div className="inline-row inline-actions-wrap lead-master-footer">
                        {prospect.phone ? (
                          <a className="button" href={`tel:${prospect.phone}`}>
                            Call now
                          </a>
                        ) : null}
                        {prospect.website ? (
                          <a
                            className="button-secondary button-secondary-strong"
                            href={websiteHref(prospect.website)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open website
                          </a>
                        ) : null}
                      </div>
                    </section>
                  );
                })}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="conversation-sidebar">
          <section className="panel panel-stack sticky-panel lead-sidebar-panel">
            {!selectedProspectView ? (
              <div className="empty-state">
                Pick a clinic from the queue to call, schedule, or update.
              </div>
            ) : (
              <>
                <div className="lead-action-grid">
                  <form action={updateProspectOutcomeAction} className="panel panel-stack lead-action-panel">
                    <input type="hidden" name="prospectId" value={selectedProspectView.id} />
                    <input type="hidden" name="nextProspectId" value={nextQueueProspectId} />
                    <input type="hidden" name="q" value={searchQuery} />
                    <input type="hidden" name="view" value={selectedView} />
                    <input type="hidden" name="status" value={selectedStatus} />
                    <input type="hidden" name="city" value={selectedCity} />
                    <input type="hidden" name="nextActionDue" value={selectedDue} />
                    <div className="inline-row justify-between lead-panel-header">
                      <div className="metric-label">Outcome</div>
                      <div className="tiny-muted">Save and move forward</div>
                    </div>
                    <div className="lead-action-pill-grid">
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

                  <form action={scheduleProspectCallbackAction} className="panel panel-stack lead-action-panel">
                    <div className="inline-row justify-between lead-panel-header">
                      <div className="metric-label">Callback</div>
                      <div className="tiny-muted">Current: {callbackSummary(selectedProspectView.nextActionAt, now)}</div>
                    </div>
                    <input type="hidden" name="prospectId" value={selectedProspectView.id} />
                    <input type="hidden" name="nextProspectId" value={nextQueueProspectId} />
                    <input type="hidden" name="q" value={searchQuery} />
                    <input type="hidden" name="view" value={selectedView} />
                    <input type="hidden" name="status" value={selectedStatus} />
                    <input type="hidden" name="city" value={selectedCity} />
                    <input type="hidden" name="nextActionDue" value={selectedDue} />
                    <div className="lead-callback-grid">
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
                    <div className="tiny-muted lead-callback-meta">
                      {selectedProspectView.nextActionAt ? formatDateTime(selectedProspectView.nextActionAt) : 'No callback scheduled yet.'}
                    </div>
                  </form>
                </div>

                <form action={updateProspectDetailsAction} className="panel panel-stack lead-notes-panel">
                  <div className="inline-row justify-between">
                    <div className="metric-label">Lead notes and follow-up</div>
                    <div className="tiny-muted">Tracked on this lead</div>
                  </div>
                  <input type="hidden" name="prospectId" value={selectedProspectView.id} />
                  <input type="hidden" name="q" value={searchQuery} />
                  <input type="hidden" name="view" value={selectedView} />
                  <input type="hidden" name="status" value={selectedStatus} />
                  <input type="hidden" name="city" value={selectedCity} />
                  <input type="hidden" name="nextActionDue" value={selectedDue} />
                  <div className="lead-notes-grid">
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
                    <div className="field-stack lead-notes-field">
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
                  </div>
                  <div className="inline-actions lead-notes-actions">
                    <button type="submit" className="button-secondary button-secondary-strong">
                      Save note or date
                    </button>
                  </div>
                </form>

                <details className="routing-details" open={selectedProspectView.callLogs.length > 0}>
                  <summary className="routing-summary">
                    <span className="metric-label">Contact history</span>
                    <span className="tiny-muted">{selectedProspectView.callLogs.length}</span>
                  </summary>
                  {selectedProspectView.callLogs.length === 0 ? (
                    <div className="empty-state">No contact history yet.</div>
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
