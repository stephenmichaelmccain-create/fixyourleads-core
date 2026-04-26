import { ProspectStatus } from '@prisma/client';
import Link from 'next/link';
import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { parseProspectNotes } from '@/lib/prospect-metadata';
import { safeLoadDb } from '@/lib/ui-data';
import { LeadBookMeetingDialog } from './LeadBookMeetingDialog';
import { LeadQueueAutoCenter } from './LeadQueueAutoCenter';
import { LeadNotesComposer } from './LeadNotesComposer';
import { SpeakProspectNameButton } from './SpeakProspectNameButton';
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
  bookMeeting?: string;
  meetingError?: string;
  duplicateReason?: string;
  duplicateCompanyId?: string;
  draftName?: string;
  draftPhone?: string;
  draftCity?: string;
  draftOwnerName?: string;
  draftWebsite?: string;
  draftHours?: string;
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
    case ProspectStatus.NOT_INTERESTED:
      return 'Not interested';
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

function formatRelativeLeadTime(date: Date | null, now: Date, options?: { future?: boolean }) {
  if (!date) {
    return options?.future ? 'Not set' : 'New';
  }

  const deltaMs = date.getTime() - now.getTime();
  const isFuture = deltaMs > 0;
  const distanceMs = Math.abs(deltaMs);
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  const weekMs = 7 * dayMs;

  const formatBucket = (value: number, singular: string, plural: string) =>
    `${value} ${value === 1 ? singular : plural}`;

  if (distanceMs < hourMs) {
    const minutes = Math.max(1, Math.round(distanceMs / (60 * 1000)));
    return isFuture ? `in ${formatBucket(minutes, 'minute', 'minutes')}` : `${formatBucket(minutes, 'minute', 'minutes')} ago`;
  }

  if (distanceMs < dayMs) {
    const hours = Math.max(1, Math.round(distanceMs / hourMs));
    return isFuture ? `in ${formatBucket(hours, 'hour', 'hours')}` : `${formatBucket(hours, 'hour', 'hours')} ago`;
  }

  if (distanceMs < weekMs) {
    const days = Math.max(1, Math.round(distanceMs / dayMs));
    return isFuture ? `in ${formatBucket(days, 'day', 'days')}` : `${formatBucket(days, 'day', 'days')} ago`;
  }

  const weeks = Math.max(1, Math.round(distanceMs / weekMs));
  return isFuture ? `in ${formatBucket(weeks, 'week', 'weeks')}` : `${formatBucket(weeks, 'week', 'weeks')} ago`;
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

function formatHistoryDate(date?: Date | null) {
  if (!date) {
    return 'Not set';
  }

  const now = new Date();
  const sameDay =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();

  if (sameDay) {
    return `Today, ${new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    }).format(date)}`;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

function formatHistoryTime(date?: Date | null) {
  if (!date) {
    return '';
  }

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function historyOutcomeTone(outcome: string) {
  const normalized = outcome.toLowerCase();

  if (normalized.includes('no answer')) {
    return 'lead-history-chip is-no-answer';
  }

  if (normalized.includes('voicemail')) {
    return 'lead-history-chip is-voicemail';
  }

  if (normalized.includes('connect') || normalized.includes('booked') || normalized.includes('sold')) {
    return 'lead-history-chip is-positive';
  }

  if (normalized.includes('not interested') || normalized.includes('do not contact')) {
    return 'lead-history-chip is-negative';
  }

  return 'lead-history-chip';
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

  const todayStart = startOfDay(now);
  const tomorrowStart = endOfDay(now);

  if (bucket === 'ready') {
    return !date || date < tomorrowStart;
  }

  if (!date) {
    return false;
  }

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

  if (bucket === 'later') {
    return date >= tomorrowStart;
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
      return 'Left voicemail';
    case ProspectStatus.GATEKEEPER:
      return 'Call back later';
    case ProspectStatus.NOT_INTERESTED:
      return 'Not interested';
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

function leadCommandIcon(kind: 'no_answer' | 'voicemail' | 'not_interested' | 'booked' | 'sold' | 'do_not_contact' | 'callback') {
  if (kind === 'voicemail') {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M7 16a4 4 0 1 1 4-4v4" />
        <path d="M17 16a4 4 0 1 1 4-4v4" />
        <path d="M7 16h10" />
      </svg>
    );
  }

  if (kind === 'not_interested') {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M10 6H6v12h4l5 0 3 3V9l-3-3h-5Z" />
        <path d="M18 10h3" />
      </svg>
    );
  }

  if (kind === 'booked' || kind === 'callback') {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4" />
        <path d="M16 3v4" />
        <path d="M4 9h16" />
        {kind === 'booked' ? <path d="m9 14 2 2 4-5" /> : null}
      </svg>
    );
  }

  if (kind === 'sold') {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="m12 3 2.7 5.5 6 .9-4.3 4.2 1 5.9L12 16.6 6.6 19.5l1-5.9L3.3 9.4l6-.9L12 3Z" />
      </svg>
    );
  }

  if (kind === 'do_not_contact') {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="m8.5 8.5 7 7" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M7.4 4.6c-.6-.6-1.5-.6-2.1 0L3.5 6.4c-.8.8-1 2-.5 3 2.3 4.9 6.3 8.9 11.2 11.2 1 .5 2.2.3 3-.5l1.8-1.8c.6-.6.6-1.5 0-2.1l-2.7-2.7c-.5-.5-1.3-.6-2-.3l-1.8 1a15.1 15.1 0 0 1-3.6-3.6l1-1.8c.3-.7.2-1.5-.3-2L7.4 4.6Z" />
    </svg>
  );
}

const leadOutcomeCommands = [
  { value: 'no_answer', label: 'No answer', tone: 'info', icon: 'no_answer' as const },
  { value: 'voicemail', label: 'Left voicemail', tone: 'accent', icon: 'voicemail' as const },
  { value: 'not_interested', label: 'Not interested', tone: 'warning', icon: 'not_interested' as const },
  { value: 'booked', label: 'Book', tone: 'success', icon: 'booked' as const },
  { value: 'sold', label: 'Sold', tone: 'gold', icon: 'sold' as const },
  { value: 'do_not_contact', label: 'Do not contact', tone: 'danger', icon: 'do_not_contact' as const }
] as const;

const leadCallbackCommands = [
  { value: 'tomorrow', label: 'Tomorrow', meta: '+1 day' },
  { value: '3_days', label: '3 days', meta: '+3 days' },
  { value: '1_week', label: '1 week', meta: '+7 days' },
  { value: '1_month', label: '1 month', meta: '+30 days' }
] as const;

const leadQuickNotes = ['Gatekeeper', 'Call later', 'Wrong contact', 'Decision maker unavailable'];

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
  const bookMeeting = String(params.bookMeeting || '').trim();
  const meetingError = String(params.meetingError || '').trim();
  const duplicateReason = String(params.duplicateReason || '').trim();
  const duplicateCompanyId = String(params.duplicateCompanyId || '').trim();
  const draftValues = {
    name: String(params.draftName || '').trim(),
    phone: String(params.draftPhone || '').trim(),
    city: String(params.draftCity || '').trim(),
    ownerName: String(params.draftOwnerName || '').trim(),
    website: String(params.draftWebsite || '').trim(),
    hours: String(params.draftHours || '').trim(),
    nextActionAt: String(params.draftNextActionAt || '').trim(),
    notes: String(params.draftNotes || '').trim()
  };
  const now = new Date();

  const allProspects = await safeLoadDb(
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
    callbackReady: prospectRows.filter(
      (prospect) =>
        prospect.status === ProspectStatus.GATEKEEPER && dueBucketMatches(prospect.nextActionAt, 'ready', now)
    ).length,
    callbackLater: prospectRows.filter(
      (prospect) =>
        prospect.status === ProspectStatus.GATEKEEPER && dueBucketMatches(prospect.nextActionAt, 'later', now)
    ).length,
    voicemail: prospectRows.filter((prospect) => prospect.status === ProspectStatus.VM_LEFT).length,
    notInterested: prospectRows.filter((prospect) => prospect.status === ProspectStatus.NOT_INTERESTED).length,
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
      ? await safeLoadDb(
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
                : duplicateReason === 'master_website'
                  ? 'This clinic already exists in the contacted-company master list with the same website.'
                : duplicateReason === 'master_name'
                  ? 'This clinic already exists in the contacted-company master list with the same company name.'
                  : 'This clinic already exists in the leads queue.'
        : error
          ? 'The prospect could not be saved. Try again.'
          : '';
  const shouldOpenAddProspect = error !== 'duplicate' && Boolean(errorMessage || Object.values(draftValues).some((value) => value));
  const shouldOpenBookMeeting = bookMeeting === '1' || Boolean(meetingError);

  return (
    <LayoutShell title="Leads" section="leads" variant="workspace" hidePageHeader>
      {updated || added || bulkAdded || bulkSkipped || bulkError || errorMessage || meetingError ? (
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
                          : updated === 'meeting_booked'
                            ? 'Meeting booked'
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
          {meetingError ? (
            <span className="inline-row">
              <span className="status-dot error" />
              {meetingError === 'phone_required'
                ? 'A valid phone number is required before booking.'
                : meetingError === 'meetingAt_required'
                  ? 'Pick the meeting date and time.'
                  : meetingError === 'purpose_required'
                    ? 'Add the meeting purpose.'
                    : meetingError === 'meetingUrl_required'
                      ? 'Paste the meeting link.'
                      : meetingError === 'meetingUrl_invalid'
                        ? 'Meeting link must be a valid URL.'
                        : meetingError === 'startTime_in_past'
                          ? 'Meeting time must be in the future.'
                          : 'Meeting could not be booked.'}
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
                      <label className="key-value-label" htmlFor="prospect-hours">
                        Hours
                      </label>
                      <input
                        id="prospect-hours"
                        name="hours"
                        className="text-input"
                        defaultValue={draftValues.hours}
                        placeholder="Mon-Fri 8 AM-5 PM"
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
                          placeholder={
                            'Paste one business per line in this order:\n' +
                            'Business name, phone, city, contact, website, hours, next action, notes\n\n' +
                            'Glow Med Spa, (555) 555-5555, Austin, Jamie Reed, glowmedspa.com, Mon-Fri 8 AM-5 PM, 2026-04-30 10:00, \n' +
                            'Premier Eye Center, (555) 111-2222, Denver, Alex Stone, premiereye.com, Sat 9 AM-1 PM, , '
                          }
                        />
                        <div className="tiny-muted">
                          Paste comma, pipe, or tab-separated rows. Use one business per line in this order: business name, phone, city, contact, website, hours, next action, notes.
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
                className={`filter-chip${
                  selectedStatus === ProspectStatus.GATEKEEPER && selectedDue === 'ready' ? ' is-active' : ''
                }`}
                href={buildPageHref({
                  q: searchQuery,
                  city: selectedCity,
                  status: ProspectStatus.GATEKEEPER,
                  nextActionDue: 'ready'
                })}
                scroll={false}
              >
                Callback now {queueCounts.callbackReady}
              </Link>
              <Link
                className={`filter-chip${selectedStatus === ProspectStatus.NO_ANSWER ? ' is-active' : ''}`}
                href={buildPageHref({ q: searchQuery, city: selectedCity, status: ProspectStatus.NO_ANSWER })}
                scroll={false}
              >
                No answer {queueCounts.noAnswer}
              </Link>
              <Link
                className={`filter-chip${selectedStatus === ProspectStatus.VM_LEFT ? ' is-active' : ''}`}
                href={buildPageHref({ q: searchQuery, city: selectedCity, status: ProspectStatus.VM_LEFT })}
                scroll={false}
              >
                Left voicemail {queueCounts.voicemail}
              </Link>
              <Link
                className={`filter-chip${selectedStatus === ProspectStatus.NOT_INTERESTED ? ' is-active' : ''}`}
                href={buildPageHref({ q: searchQuery, city: selectedCity, status: ProspectStatus.NOT_INTERESTED })}
                scroll={false}
              >
                Not interested {queueCounts.notInterested}
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
                className={`filter-chip${
                  selectedStatus === ProspectStatus.GATEKEEPER && (!selectedDue || selectedDue === 'later')
                    ? ' is-active'
                    : ''
                }`}
                href={buildPageHref({
                  q: searchQuery,
                  city: selectedCity,
                  status: ProspectStatus.GATEKEEPER,
                  nextActionDue: 'later'
                })}
                scroll={false}
              >
                Call back later {queueCounts.callbackLater}
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
                  const rowHref = buildPageHref({
                    prospectId: prospect.id,
                    q: searchQuery,
                    view: selectedView,
                    status: selectedStatus,
                    city: selectedCity,
                    nextActionDue: selectedDue
                  });
                  const lastTouch = prospect.callLogs[0]?.createdAt || prospect.lastCallAt || null;
                  const lastTouchLabel = formatRelativeLeadTime(lastTouch, now);
                  const lastTouchMeta =
                    prospect.lastCallOutcome || prospect.callLogs[0]?.outcome || (lastTouch ? 'Recent activity' : 'Not contacted yet');
                  const nextActionLabel = formatRelativeLeadTime(prospect.nextActionAt, now, { future: true });
                  const leadSummary = [prospect.city, prospect.website ? websiteLabel(prospect.website) : null]
                    .filter(Boolean)
                    .join(' · ');
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
                            <div className="lead-company-name-row">
                              <h2 className="form-title lead-company-name">{prospect.name}</h2>
                              <SpeakProspectNameButton name={prospect.name} />
                            </div>
                            <div className="lead-queue-subline">{leadSummary || 'No location or website saved yet'}</div>
                          </div>

                          <div className="lead-queue-body">
                            <div className="lead-queue-timing">
                              <div className="lead-queue-timing-item">
                                <span className="key-value-label">Last event</span>
                                <strong className="lead-compact-value">{lastTouchLabel}</strong>
                                <span className="tiny-muted">{lastTouchMeta}</span>
                              </div>
                              <div className="lead-queue-timing-item">
                                <span className="key-value-label">Next step</span>
                                <strong className="lead-compact-value">{nextActionLabel}</strong>
                                <span className="tiny-muted">{nextActionState(prospect.nextActionAt, now)}</span>
                              </div>
                            </div>
                            <div className="lead-queue-contact-row">
                              <div className="lead-queue-phone">{detailValue(prospect.phone)}</div>
                              <div className={`lead-queue-hours${prospect.profile.operatingHours ? '' : ' is-empty'}`}>
                                <span className="lead-queue-hours-icon" aria-hidden="true">
                                  <svg viewBox="0 0 20 20" focusable="false">
                                    <circle cx="10" cy="10" r="6.25" />
                                    <path d="M10 6.8v3.6l2.6 1.6" />
                                  </svg>
                                </span>
                                <span>{prospect.profile.operatingHours || 'Hours not set'}</span>
                              </div>
                            </div>
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
                  <section className="panel lead-command-panel">
                    <div className="lead-command-strip">
                      <form action={updateProspectOutcomeAction} className="lead-command-group lead-command-group-outcomes">
                        <input type="hidden" name="prospectId" value={selectedProspectView.id} />
                        <input type="hidden" name="nextProspectId" value={nextQueueProspectId} />
                        <input type="hidden" name="q" value={searchQuery} />
                        <input type="hidden" name="view" value={selectedView} />
                        <input type="hidden" name="status" value={selectedStatus} />
                        <input type="hidden" name="city" value={selectedCity} />
                        <input type="hidden" name="nextActionDue" value={selectedDue} />
                        {leadOutcomeCommands.map((command) =>
                          command.value === 'booked' ? (
                            <LeadBookMeetingDialog
                              key={command.value}
                              initialOpen={shouldOpenBookMeeting}
                              prospectId={selectedProspectView.id}
                              nextProspectId={nextQueueProspectId}
                              q={searchQuery}
                              view={selectedView}
                              status={selectedStatus}
                              city={selectedCity}
                              nextActionDue={selectedDue}
                              companyName={selectedProspectView.name}
                              contactName={selectedProspectView.ownerName || ''}
                              contactPhone={selectedProspectView.phone || ''}
                              website={selectedProspectView.website || ''}
                              purpose="Discovery call"
                              notes={selectedProspectView.plainNotes || ''}
                              meetingError={meetingError || undefined}
                            />
                          ) : (
                            <button
                              key={command.value}
                              type="submit"
                              className="lead-command-button"
                              data-tone={command.tone}
                              name="outcome"
                              value={command.value}
                            >
                              <span className="lead-command-icon">{leadCommandIcon(command.icon)}</span>
                              <span className="lead-command-label">{command.label}</span>
                            </button>
                          )
                        )}
                      </form>

                      <form
                        action={scheduleProspectCallbackAction}
                        className="lead-command-group lead-command-group-callbacks"
                      >
                        <input type="hidden" name="prospectId" value={selectedProspectView.id} />
                        <input type="hidden" name="nextProspectId" value={nextQueueProspectId} />
                        <input type="hidden" name="q" value={searchQuery} />
                        <input type="hidden" name="view" value={selectedView} />
                        <input type="hidden" name="status" value={selectedStatus} />
                        <input type="hidden" name="city" value={selectedCity} />
                        <input type="hidden" name="nextActionDue" value={selectedDue} />
                        {leadCallbackCommands.map((command) => (
                          <button key={command.value} type="submit" className="lead-command-button" name="preset" value={command.value}>
                            <span className="lead-command-icon">{leadCommandIcon('callback')}</span>
                            <span className="lead-command-label">{command.label}</span>
                            <span className="lead-command-meta">{command.meta}</span>
                          </button>
                        ))}
                      </form>
                    </div>
                  </section>
                </div>

                  <div className="lead-preview-grid">
                    <section className="panel panel-stack lead-preview-panel">
                      <div className="inline-row justify-between lead-panel-header">
                        <span className="metric-label">Contact history</span>
                        {selectedProspectView.callLogs.length > 3 ? (
                          <details className="lead-history-disclosure">
                            <summary className="button-secondary lead-history-summary">View all history</summary>
                            <div className="lead-history-disclosure-panel">
                              {selectedProspectView.callLogs.slice(3).map((call) => (
                                <article key={call.id} className="lead-history-entry">
                                  <div className="lead-history-rail">
                                    <span className="lead-history-node" aria-hidden="true">
                                      <svg viewBox="0 0 20 20" focusable="false">
                                        <path d="M6.2 3.8c-.5-.5-1.3-.5-1.8 0L2.8 5.3c-.6.6-.8 1.6-.4 2.4 2 4 5 7 9 9 .8.4 1.8.2 2.4-.4l1.5-1.5c.5-.5.5-1.3 0-1.8l-2.1-2.1c-.4-.4-1-.5-1.5-.2l-1.4.8a12.2 12.2 0 0 1-2.8-2.8l.8-1.4c.3-.5.2-1.1-.2-1.5L6.2 3.8Z" />
                                      </svg>
                                    </span>
                                  </div>
                                  <div className="lead-history-card">
                                    <div className="lead-history-card-top">
                                      <div className="lead-history-title-row">
                                        <strong>Outbound call</strong>
                                        <span className={historyOutcomeTone(call.outcome)}>{call.outcome}</span>
                                      </div>
                                      <div className="lead-history-meta">
                                        <span>{formatHistoryDate(call.createdAt)}</span>
                                        <span>{formatHistoryTime(call.createdAt)}</span>
                                        <span>by You</span>
                                      </div>
                                    </div>
                                    <div className="text-muted lead-history-note-copy">
                                      {call.notes || 'No call notes captured.'}
                                    </div>
                                  </div>
                                </article>
                              ))}
                            </div>
                          </details>
                        ) : null}
                      </div>
                      {selectedProspectView.callLogs.length === 0 ? (
                        <div className="empty-state lead-history-empty">
                          <strong>No more contact history</strong>
                          <span>Start calling to see a timeline of touches here.</span>
                        </div>
                      ) : (
                        <div className="lead-history-timeline">
                          {selectedProspectView.callLogs.slice(0, 3).map((call) => (
                            <article key={call.id} className="lead-history-entry">
                              <div className="lead-history-rail">
                                <span className="lead-history-node" aria-hidden="true">
                                  <svg viewBox="0 0 20 20" focusable="false">
                                    <path d="M6.2 3.8c-.5-.5-1.3-.5-1.8 0L2.8 5.3c-.6.6-.8 1.6-.4 2.4 2 4 5 7 9 9 .8.4 1.8.2 2.4-.4l1.5-1.5c.5-.5.5-1.3 0-1.8l-2.1-2.1c-.4-.4-1-.5-1.5-.2l-1.4.8a12.2 12.2 0 0 1-2.8-2.8l.8-1.4c.3-.5.2-1.1-.2-1.5L6.2 3.8Z" />
                                  </svg>
                                </span>
                              </div>
                              <div className="lead-history-card">
                                <div className="lead-history-card-top">
                                  <div className="lead-history-title-row">
                                    <strong>Outbound call</strong>
                                    <span className={historyOutcomeTone(call.outcome)}>{call.outcome}</span>
                                  </div>
                                  <div className="lead-history-meta">
                                    <span>{formatHistoryDate(call.createdAt)}</span>
                                    <span>{formatHistoryTime(call.createdAt)}</span>
                                    <span>by You</span>
                                  </div>
                                </div>
                                <div className="text-muted lead-history-note-copy">
                                  {call.notes || 'No call notes captured.'}
                                  {typeof call.durationSeconds === 'number' ? ` • ${call.durationSeconds}s` : ''}
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
                    </section>

                    <form action={updateProspectDetailsAction} className="panel panel-stack lead-notes-panel">
                      <input type="hidden" name="prospectId" value={selectedProspectView.id} />
                      <input type="hidden" name="q" value={searchQuery} />
                      <input type="hidden" name="view" value={selectedView} />
                      <input type="hidden" name="status" value={selectedStatus} />
                      <input type="hidden" name="city" value={selectedCity} />
                      <input type="hidden" name="nextActionDue" value={selectedDue} />
                      <div className="lead-notes-header">
                        <span className="metric-label">Follow-up &amp; notes</span>
                      </div>
                      <div className="lead-notes-body">
                        <div className="field-stack lead-date-field">
                          <label className="key-value-label" htmlFor="lead-next-action-at">
                            Custom follow-up date
                          </label>
                          <input
                            id="lead-next-action-at"
                            name="nextActionAt"
                            type="datetime-local"
                            className="text-input lead-follow-up-input"
                            defaultValue={formatDateTimeInput(selectedProspectView.nextActionAt)}
                          />
                        </div>
                        <LeadNotesComposer
                          initialNotes={selectedProspectView.plainNotes}
                          quickNotes={leadQuickNotes}
                          textAreaId="lead-notes-editor"
                          textAreaName="notes"
                        />
                      </div>
                      <div className="inline-actions lead-notes-actions">
                        <button type="submit" className="button-secondary button-secondary-strong">
                          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                            <path d="M4 3.5h9l3 3V16a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 16V3.5Z" />
                            <path d="M7 3.5v4h5v-4" />
                            <path d="M7 16v-4h6v4" />
                          </svg>
                          Save next step
                        </button>
                      </div>
                    </form>
                  </div>
              </>
            )}
          </section>
        </div>
      </div>
    </LayoutShell>
  );
}
