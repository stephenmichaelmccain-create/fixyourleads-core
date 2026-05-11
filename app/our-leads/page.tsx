import { ProspectStatus } from '@prisma/client';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Fragment } from 'react';
import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { getMeetingTeamDefaults, INTERNAL_COMPANY_ID } from '@/lib/meeting-team-defaults';
import { parseProspectNotes } from '@/lib/prospect-metadata';
import { safeLoadDb } from '@/lib/ui-data';
import { suggestUpcomingAppointmentSlots } from '@/services/calendar-sync';
import { LeadBookMeetingDialog } from './LeadBookMeetingDialog';
import { ClinicTypeFilterSelect } from './ClinicTypeFilterSelect';
import { LeadFilterBar } from './LeadFilterBar';
import { claimFirstAvailableProspect, getLeadQueueSessionId, isProspectClaimedByAnotherSession } from './lead-claims.server';
import { LeadQueueAutoCenter } from './LeadQueueAutoCenter';
import { LeadNotesComposer } from './LeadNotesComposer';
import { LeadQueueSessionKeeper } from './LeadQueueSessionKeeper';
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
  clinicType?: string;
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
  bookingContactName?: string;
  bookingContactPhone?: string;
  bookingMeetingAt?: string;
  bookingPurpose?: string;
  bookingMeetingUrl?: string;
  bookingHostEmail?: string;
  bookingNotes?: string;
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

function leadNotePreview(notes?: string | null) {
  const firstLine = String(notes || '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return '';
  }

  if (firstLine.length <= 84) {
    return firstLine;
  }

  return `${firstLine.slice(0, 81).trimEnd()}...`;
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function compactLeadText(value?: string | null) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeLeadNotes(notes?: string | null) {
  const cleaned = compactLeadText(notes);

  if (!cleaned) {
    return '';
  }

  const firstSentence = cleaned.match(/^(.{1,220}?[.!?])(\s|$)/);

  if (firstSentence?.[1]) {
    return firstSentence[1].trim();
  }

  return cleaned.length > 220 ? `${cleaned.slice(0, 217).trimEnd()}...` : cleaned;
}

function extractLeadRole(ownerName?: string | null, notes?: string | null) {
  const cleanedNotes = compactLeadText(notes);
  const cleanedOwnerName = compactLeadText(ownerName);

  if (!cleanedNotes) {
    return '';
  }

  const rolePatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\b(owner)\b/i, label: 'Owner' },
    { pattern: /\b(founder)\b/i, label: 'Founder' },
    { pattern: /\b(office manager)\b/i, label: 'Office Manager' },
    { pattern: /\b(practice manager)\b/i, label: 'Practice Manager' },
    { pattern: /\b(manager)\b/i, label: 'Manager' },
    { pattern: /\b(medical director)\b/i, label: 'Medical Director' },
    { pattern: /\b(dentist)\b/i, label: 'Dentist' },
    { pattern: /\b(doctor)\b/i, label: 'Doctor' },
    { pattern: /\b(physician)\b/i, label: 'Physician' },
    { pattern: /\b(front desk)\b/i, label: 'Front Desk' }
  ];

  const noteSentences = cleanedNotes.split(/(?<=[.!?])\s+/);
  const matchingSentence =
    cleanedOwnerName &&
    noteSentences.find((sentence) => sentence.toLowerCase().includes(cleanedOwnerName.toLowerCase()));

  if (matchingSentence) {
    for (const candidate of rolePatterns) {
      if (candidate.pattern.test(matchingSentence)) {
        return candidate.label;
      }
    }
  }

  if (/^dr\.?\s/i.test(cleanedOwnerName)) {
    return 'Doctor';
  }

  for (const candidate of rolePatterns) {
    if (candidate.pattern.test(cleanedNotes)) {
      return candidate.label;
    }
  }

  return '';
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function normalizeExternalLink(value?: string | null) {
  const trimmed = String(value || '').trim();

  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^www\./i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  if (/^[^\s]+\.[^\s]+$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return '';
}

function extractUrls(text?: string | null) {
  const value = String(text || '');
  const matches = value.match(/https?:\/\/[^\s)]+|www\.[^\s)]+/gi) || [];
  return uniqueStrings(
    matches
      .map((entry) => normalizeExternalLink(entry.replace(/[),.;]+$/, '')))
      .filter(Boolean)
  );
}

function extractEmail(text?: string | null) {
  const value = String(text || '');
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : '';
}

function firstMatchingLine(lines: string[], patterns: RegExp[]) {
  for (const line of lines) {
    if (patterns.some((pattern) => pattern.test(line))) {
      return line;
    }
  }

  return '';
}

function inferBookingFlow(lines: string[]) {
  const haystack = lines.join(' ').toLowerCase();
  const hasPhone = /\b(call|phone|front desk)\b/i.test(haystack);
  const hasWebBooking = /\b(book online|online booking|schedule online|book now)\b/i.test(haystack);
  const hasForm = /\b(form|request form|contact form|submit)\b/i.test(haystack);

  if ((hasPhone && hasWebBooking) || (hasPhone && hasForm) || (hasWebBooking && hasForm)) {
    return 'Mixed';
  }

  if (hasWebBooking) {
    return 'Web booking';
  }

  if (hasForm) {
    return 'Form request';
  }

  if (hasPhone) {
    return 'Phone-only';
  }

  return 'Not found';
}

function deriveAppointmentTypes(lines: string[]) {
  const detected: string[] = [];
  const map: Array<{ label: string; pattern: RegExp }> = [
    { label: 'New patient exam', pattern: /\bnew patient|new exam|first visit\b/i },
    { label: 'Consultation', pattern: /\bconsult|consultation\b/i },
    { label: 'Adjustment', pattern: /\badjustment\b/i },
    { label: 'Follow-up', pattern: /\bfollow[- ]?up|follow up\b/i },
    { label: 'Cleaning', pattern: /\bcleaning|prophy\b/i },
    { label: 'Implant consult', pattern: /\bimplant\b/i }
  ];

  for (const candidate of map) {
    if (lines.some((line) => candidate.pattern.test(line))) {
      detected.push(candidate.label);
    }
  }

  return detected.slice(0, 4);
}

function deriveTopServices(lines: string[], clinicType?: string) {
  const detected: string[] = [];
  const map: Array<{ label: string; pattern: RegExp }> = [
    { label: 'General dentistry', pattern: /\bgeneral dentistry|family dentistry\b/i },
    { label: 'Orthodontics', pattern: /\borthodont|braces|invisalign\b/i },
    { label: 'Dental implants', pattern: /\bimplant\b/i },
    { label: 'Cosmetic dentistry', pattern: /\bcosmetic|veneer|smile makeover\b/i },
    { label: 'Chiropractic care', pattern: /\bchiropractic|adjustment\b/i },
    { label: 'Facial aesthetics', pattern: /\bfacial|filler|botox|injectable\b/i }
  ];

  for (const candidate of map) {
    if (lines.some((line) => candidate.pattern.test(line))) {
      detected.push(candidate.label);
    }
  }

  if (detected.length === 0 && clinicType) {
    detected.push(clinicType);
  }

  return detected.slice(0, 5);
}

type MoreInfoEvidence = {
  text: string;
  source: string;
  url: string;
};

function buildMoreInfoModel(prospect: {
  ownerName: string | null;
  phone: string | null;
  website: string | null;
  updatedAt: Date;
  plainNotes: string;
  profile: { clinicType?: string; source?: string; sourceRecord?: string };
}) {
  const lines = String(prospect.plainNotes || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const websiteUrl = websiteHref(prospect.website || '');
  const sourceRecordUrl = normalizeExternalLink(prospect.profile.sourceRecord || '');
  const discoveredUrls = extractUrls(prospect.plainNotes);
  const sourceFallbackUrl = sourceRecordUrl || discoveredUrls[0] || websiteUrl || '';
  const sourceLabel = prospect.profile.source || 'Website';

  const decisionMakerName = compactLeadText(prospect.ownerName) || 'Not found';
  const decisionMakerRole = extractLeadRole(prospect.ownerName, prospect.plainNotes) || '';
  const bestLineType = /direct|cell|owner phone|mobile/i.test(prospect.plainNotes) ? 'Direct' : 'Main';
  const email = extractEmail(prospect.plainNotes) || '';
  const appointmentTypes = deriveAppointmentTypes(lines);
  const topServices = deriveTopServices(lines, prospect.profile.clinicType);
  const bookingFlow = inferBookingFlow(lines);

  const hiringSnippet = firstMatchingLine(lines, [/\bhiring\b/i, /\bnow hiring\b/i, /\breceptionist\b/i, /\bfront desk\b/i]);
  const hiringStatus = hiringSnippet ? 'Confirmed' : 'Not found';
  const hiringEvidence: MoreInfoEvidence = {
    text: hiringSnippet,
    source: hiringSnippet ? 'Careers / notes' : sourceLabel,
    url: sourceFallbackUrl
  };

  const reviewSnippet = firstMatchingLine(lines, [/\breview\b/i, /\bwait\b/i, /\bphone\b/i, /\bhold\b/i, /\bstaff\b/i]);
  const reviewHasFriction = /wait|hold|rude|no answer|hard to reach|slow|friction/i.test(reviewSnippet);
  const reviewStatus = reviewSnippet && reviewHasFriction ? 'Friction found' : 'None found';
  const reviewEvidence: MoreInfoEvidence = {
    text: reviewSnippet,
    source: reviewSnippet ? 'Reviews / notes' : sourceLabel,
    url: sourceFallbackUrl
  };

  const contextLines = lines.filter((line) =>
    /\b(front desk|intake|handoff|staffing|call volume|reception|schedule|overflow|coverage)\b/i.test(line)
  );
  const callerContext = contextLines.slice(0, 2).join(' ');

  const contactEvidence: MoreInfoEvidence = {
    text: '',
    source: sourceLabel,
    url: sourceFallbackUrl
  };

  const businessEvidence: MoreInfoEvidence = {
    text: '',
    source: sourceLabel,
    url: sourceFallbackUrl
  };

  const contextEvidence: MoreInfoEvidence = {
    text: '',
    source: contextLines[0] ? 'Notes' : sourceLabel,
    url: sourceFallbackUrl
  };

  return {
    decisionMakerName,
    decisionMakerRole,
    bestLineType,
    email,
    lastVerifiedLabel: formatDateOnly(prospect.updatedAt),
    contactSourceLabel: sourceLabel,
    appointmentTypes,
    topServices,
    bookingFlow,
    hiringStatus,
    hiringEvidence,
    reviewStatus,
    reviewEvidence,
    callerContext,
    contactEvidence,
    businessEvidence,
    contextEvidence
  };
}

function truncateCopy(value: string, max = 120) {
  const cleaned = compactLeadText(value);
  if (cleaned.length <= max) {
    return cleaned;
  }

  return `${cleaned.slice(0, max - 3).trimEnd()}...`;
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
  clinicType,
  nextActionDue
}: {
  prospectId?: string;
  q?: string;
  view?: string;
  status?: string;
  city?: string;
  clinicType?: string;
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

  if (clinicType) {
    params.set('clinicType', clinicType);
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
  const selectedClinicType = String(params.clinicType || '').trim();
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
  const bookingDraftValues = {
    contactName: String(params.bookingContactName || '').trim(),
    contactPhone: String(params.bookingContactPhone || '').trim(),
    meetingAt: String(params.bookingMeetingAt || '').trim(),
    purpose: String(params.bookingPurpose || '').trim(),
    meetingUrl: String(params.bookingMeetingUrl || '').trim(),
    hostEmail: String(params.bookingHostEmail || '').trim(),
    notes: String(params.bookingNotes || '').trim()
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
          claimSessionId: true,
          claimExpiresAt: true,
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
  const clinicTypeOptions = Array.from(
    new Set(
      prospectRows
        .map((prospect) => String(prospect.profile.clinicType || '').trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));
  const showingUntouched = !selectedView && !selectedStatus && !selectedDue;
  const leadQueueSessionId = await getLeadQueueSessionId();

  const filteredProspects = [...prospectRows]
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
    .filter((prospect) => (selectedClinicType ? prospect.profile.clinicType === selectedClinicType : true))
    .filter((prospect) => dueBucketMatches(prospect.nextActionAt, selectedDue, now))
    .sort(compareProspects);

  const visibleProspects = leadQueueSessionId
    ? filteredProspects.filter((prospect) => !isProspectClaimedByAnotherSession(prospect, leadQueueSessionId, now))
    : filteredProspects;

  const scopedProspectsForCounts = prospectRows
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
    .filter((prospect) => (selectedCity ? prospect.city === selectedCity : true))
    .filter((prospect) => (selectedClinicType ? prospect.profile.clinicType === selectedClinicType : true));

  const queueCounts = {
    all: scopedProspectsForCounts.length,
    untouched: scopedProspectsForCounts.filter((prospect) => isUntouchedProspect(prospect)).length,
    overdue: scopedProspectsForCounts.filter((prospect) => dueBucketMatches(prospect.nextActionAt, 'overdue', now)).length,
    today: scopedProspectsForCounts.filter((prospect) => dueBucketMatches(prospect.nextActionAt, 'today', now)).length,
    callbackReady: scopedProspectsForCounts.filter(
      (prospect) =>
        prospect.status === ProspectStatus.GATEKEEPER && dueBucketMatches(prospect.nextActionAt, 'ready', now)
    ).length,
    callbackLater: scopedProspectsForCounts.filter(
      (prospect) =>
        prospect.status === ProspectStatus.GATEKEEPER && dueBucketMatches(prospect.nextActionAt, 'later', now)
    ).length,
    voicemail: scopedProspectsForCounts.filter((prospect) => prospect.status === ProspectStatus.VM_LEFT).length,
    notInterested: scopedProspectsForCounts.filter((prospect) => prospect.status === ProspectStatus.NOT_INTERESTED).length,
    booked: scopedProspectsForCounts.filter((prospect) => prospect.status === ProspectStatus.BOOKED_DEMO).length,
    noAnswer: scopedProspectsForCounts.filter((prospect) => prospect.status === ProspectStatus.NO_ANSWER).length,
    sold: scopedProspectsForCounts.filter((prospect) => prospect.status === ProspectStatus.CLOSED).length,
    dead: scopedProspectsForCounts.filter((prospect) => prospect.status === ProspectStatus.DEAD).length
  };

  const requestedProspectId =
    selectedProspectId && visibleProspects.some((prospect) => prospect.id === selectedProspectId) ? selectedProspectId : '';
  let effectiveSelectedProspectId = requestedProspectId || visibleProspects[0]?.id || '';

  if (leadQueueSessionId && visibleProspects.length > 0) {
    const preferredProspectIds = effectiveSelectedProspectId
      ? [
          effectiveSelectedProspectId,
          ...visibleProspects.filter((prospect) => prospect.id !== effectiveSelectedProspectId).map((prospect) => prospect.id)
        ]
      : visibleProspects.map((prospect) => prospect.id);

    effectiveSelectedProspectId = (await claimFirstAvailableProspect(preferredProspectIds, leadQueueSessionId)) || '';
  }

  if (leadQueueSessionId && selectedProspectId && effectiveSelectedProspectId && effectiveSelectedProspectId !== selectedProspectId) {
    redirect(
      buildPageHref({
        prospectId: effectiveSelectedProspectId,
        q: searchQuery,
        view: selectedView,
        status: selectedStatus,
        city: selectedCity,
        clinicType: selectedClinicType,
        nextActionDue: selectedDue
      })
    );
  }

  const renderedProspects = effectiveSelectedProspectId
    ? [
        ...visibleProspects.filter((prospect) => prospect.id === effectiveSelectedProspectId),
        ...visibleProspects.filter((prospect) => prospect.id !== effectiveSelectedProspectId)
      ]
    : visibleProspects;
  const selectedQueueIndex = renderedProspects.findIndex((prospect) => prospect.id === effectiveSelectedProspectId);
  const nextQueueProspectId =
    selectedQueueIndex >= 0
      ? renderedProspects[Math.min(selectedQueueIndex + 1, Math.max(renderedProspects.length - 1, 0))]?.id || ''
      : '';

  const [selectedProspect, meetingTeamDefaults, suggestedMeetingSlots] = await Promise.all([
    effectiveSelectedProspectId
      ? safeLoadDb(
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
      : Promise.resolve(null),
    safeLoadDb(() => getMeetingTeamDefaults(), {
      defaultAttendeeEmails: []
    }),
    safeLoadDb(
      () =>
        suggestUpcomingAppointmentSlots(INTERNAL_COMPANY_ID, {
          lookaheadDays: 14,
          minLeadMinutes: 90,
          maxResults: 4
        }),
      []
    )
  ]);

  const selectedProspectView = selectedProspect
    ? {
        ...selectedProspect,
        ...parseProspectNotes(selectedProspect.notes)
      }
    : null;
  const suggestedMeetingQuickSlots = suggestedMeetingSlots.map((slot) => ({
    value: formatDateTimeInput(slot.startTime),
    label: formatDateTime(slot.startTime),
    source: slot.source
  }));
  const firstSuggestedMeetingSlot = suggestedMeetingSlots[0] || null;
  const suggestedMeetingAtValue =
    bookingDraftValues.meetingAt || (firstSuggestedMeetingSlot ? formatDateTimeInput(firstSuggestedMeetingSlot.startTime) : '');
  const suggestedMeetingSlotHint = firstSuggestedMeetingSlot
    ? `${firstSuggestedMeetingSlot.source === 'calendar' ? 'Live calendar slot' : 'Fallback slot'} · ${formatDateTime(firstSuggestedMeetingSlot.startTime)}`
    : '';
  const duplicateLeadHref = selectedProspectId
    ? `${buildPageHref({
        prospectId: selectedProspectId,
        q: searchQuery,
        view: selectedView,
        status: selectedStatus,
        city: selectedCity,
        clinicType: selectedClinicType,
        nextActionDue: selectedDue
      })}#selected-lead`
    : '/leads';
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
      <LeadQueueSessionKeeper
        hasSession={Boolean(leadQueueSessionId)}
        selectedProspectId={effectiveSelectedProspectId || undefined}
      />
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
                        : meetingError === 'host_invalid'
                          ? 'Host must be one of the default attendee emails or none.'
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
            <div className="workspace-search-bar lead-toolbar-row">
              <form action="/leads" className="workspace-search-bar lead-toolbar-form">
                {selectedView ? <input type="hidden" name="view" value={selectedView} /> : null}
                {selectedStatus ? <input type="hidden" name="status" value={selectedStatus} /> : null}
                {selectedCity ? <input type="hidden" name="city" value={selectedCity} /> : null}
                {selectedDue ? <input type="hidden" name="nextActionDue" value={selectedDue} /> : null}
                <ClinicTypeFilterSelect
                  className="select-input lead-toolbar-select"
                  defaultValue={selectedClinicType}
                  options={clinicTypeOptions}
                />
                <div className="lead-toolbar-search-field">
                  <input
                    id="our-leads-search"
                    name="q"
                    className="text-input"
                    defaultValue={searchQuery}
                    placeholder="Search clinic, phone, website, contact, city"
                  />
                  <button type="submit" className="button-ghost lead-toolbar-search-button">
                    Search
                  </button>
                </div>
              </form>
              <div className="workspace-action-rail lead-toolbar-actions">
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
                  <input type="hidden" name="viewClinicType" value={selectedClinicType} />
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
                      <input type="hidden" name="viewClinicType" value={selectedClinicType} />
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
                            'Business name, niche, phone, city, contact, website, hours, next action, notes\n\n' +
                            'Glow Med Spa, Med Spa, (555) 555-5555, Austin, Jamie Reed, glowmedspa.com, Mon-Fri 8 AM-5 PM, 2026-04-30 10:00, Warm Instagram lead\n' +
                            'Premier Eye Center, Optometry, (555) 111-2222, Denver, Alex Stone, premiereye.com, Sat 9 AM-1 PM, , '
                          }
                        />
                        <div className="tiny-muted">
                          Paste comma, pipe, or tab-separated rows. New format: business name, niche, phone, city, contact, website, hours, next action, notes. The old 8-column format still works too, and header rows are ignored.
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

            <LeadFilterBar
              queueCounts={queueCounts}
              showingUntouched={showingUntouched}
              searchQuery={searchQuery}
              selectedCity={selectedCity}
              selectedClinicType={selectedClinicType}
              selectedView={selectedView}
              selectedStatus={selectedStatus}
              selectedDue={selectedDue}
            />

            <div className="lead-queue-scroll">
              <LeadQueueAutoCenter selectedProspectId={effectiveSelectedProspectId} />
              {renderedProspects.length === 0 ? (
                <div className="empty-state">
                  <div>
                    {filteredProspects.length > 0
                      ? 'Those leads are already being worked by someone else right now.'
                      : 'No leads in this view.'}
                  </div>
                </div>
              ) : (
                <div className="record-grid lead-queue-list">
                {renderedProspects.map((prospect) => {
                  const rowHref = buildPageHref({
                    prospectId: prospect.id,
                    q: searchQuery,
                    view: selectedView,
                    status: selectedStatus,
                    city: selectedCity,
                    clinicType: selectedClinicType,
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
                  const leadNotesSummary = summarizeLeadNotes(prospect.plainNotes);
                  const leadRole = extractLeadRole(prospect.ownerName, prospect.plainNotes);
                  const leadContactLine = [compactLeadText(prospect.ownerName), leadRole].filter(Boolean).join(' · ');
                  const notePreview = leadNotePreview(prospect.plainNotes);
                  const selected = prospect.id === effectiveSelectedProspectId;
                  const moreInfo = selected ? buildMoreInfoModel(prospect) : null;

                  return (
                    <Fragment key={prospect.id}>
                      <section
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
                            <div className="lead-card-identity-row">
                              <div className="record-stack lead-card-identity-main">
                                <div className="lead-company-name-row">
                                  <h2 className="form-title lead-company-name">{prospect.name}</h2>
                                  <SpeakProspectNameButton name={prospect.name} />
                                </div>
                                {leadContactLine ? <div className="lead-queue-contact-name">{leadContactLine}</div> : null}
                                <div className="lead-queue-subline">{leadSummary || 'No location or website saved yet'}</div>
                              </div>
                              {leadNotesSummary ? (
                                <div className="lead-card-summary">{leadNotesSummary}</div>
                              ) : notePreview ? (
                                <div className="lead-queue-note-chip" title={notePreview}>
                                  {notePreview}
                                </div>
                              ) : null}
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
                          {selected ? (
                            <>
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
                              {prospect.phone ? <span className="lead-master-phone-inline">{detailValue(prospect.phone)}</span> : null}
                            </>
                          ) : (
                            <Link className="button-ghost lead-master-select-button" href={rowHref} scroll={false}>
                              Select lead
                            </Link>
                          )}
                        </div>
                      </section>
                      {selected && moreInfo ? (
                        <aside className="lead-more-info-panel" aria-label={`More info for ${prospect.name}`}>
                          <div className="lead-more-info-header">
                            <strong>More info</strong>
                          </div>
                          <div className="lead-more-info-body">
                            <section className="lead-more-info-section">
                              <h3>Contact</h3>
                              <div className="lead-more-info-list">
                                <div>
                                  <span className="tiny-muted">Contact</span>
                                  <strong>{moreInfo.decisionMakerName}</strong>
                                </div>
                                {moreInfo.decisionMakerRole ? (
                                  <div>
                                    <span className="tiny-muted">Role</span>
                                    <strong>{moreInfo.decisionMakerRole}</strong>
                                  </div>
                                ) : null}
                                <div>
                                  <span className="tiny-muted">Line</span>
                                  <strong>{moreInfo.bestLineType}</strong>
                                </div>
                                {moreInfo.email ? (
                                  <div>
                                    <span className="tiny-muted">Email</span>
                                    <strong>{moreInfo.email}</strong>
                                  </div>
                                ) : null}
                                <div>
                                  <span className="tiny-muted">Verified</span>
                                  <strong>{moreInfo.lastVerifiedLabel}</strong>
                                </div>
                              </div>
                              {moreInfo.contactEvidence.url ? (
                                <div className="lead-more-info-evidence">
                                  <a href={moreInfo.contactEvidence.url} target="_blank" rel="noreferrer">
                                    {moreInfo.contactEvidence.source}
                                  </a>
                                </div>
                              ) : null}
                            </section>

                            <section className="lead-more-info-section">
                              <h3>Business</h3>
                              <div className="lead-more-info-list">
                                {moreInfo.appointmentTypes.length > 0 ? (
                                  <div>
                                    <span className="tiny-muted">Appt types</span>
                                    <strong>{truncateCopy(moreInfo.appointmentTypes.join(', '), 92)}</strong>
                                  </div>
                                ) : null}
                                {moreInfo.topServices.length > 0 ? (
                                  <div>
                                    <span className="tiny-muted">Top services</span>
                                    <strong>{truncateCopy(moreInfo.topServices.join(', '), 92)}</strong>
                                  </div>
                                ) : null}
                                <div>
                                  <span className="tiny-muted">Flow</span>
                                  <strong>{moreInfo.bookingFlow}</strong>
                                </div>
                              </div>
                              {moreInfo.businessEvidence.url ? (
                                <div className="lead-more-info-evidence">
                                  <a href={moreInfo.businessEvidence.url} target="_blank" rel="noreferrer">
                                    {moreInfo.businessEvidence.source}
                                  </a>
                                </div>
                              ) : null}
                            </section>

                            <section className="lead-more-info-section">
                              <h3>Hiring</h3>
                              <div className="lead-more-info-note">
                                <strong>{moreInfo.hiringStatus}</strong>
                              </div>
                              {moreInfo.hiringEvidence.text || moreInfo.hiringEvidence.url ? (
                                <div className="lead-more-info-evidence">
                                  {moreInfo.hiringEvidence.text ? (
                                    <span>{truncateCopy(moreInfo.hiringEvidence.text, 88)}</span>
                                  ) : null}
                                  {moreInfo.hiringEvidence.url ? (
                                    <a href={moreInfo.hiringEvidence.url} target="_blank" rel="noreferrer">
                                      {moreInfo.hiringEvidence.source}
                                    </a>
                                  ) : null}
                                </div>
                              ) : null}
                            </section>

                            <section className="lead-more-info-section">
                              <h3>Review</h3>
                              <div className="lead-more-info-note">
                                <strong>{moreInfo.reviewStatus}</strong>
                              </div>
                              {moreInfo.reviewEvidence.text || moreInfo.reviewEvidence.url ? (
                                <div className="lead-more-info-evidence">
                                  {moreInfo.reviewEvidence.text ? (
                                    <span>{truncateCopy(moreInfo.reviewEvidence.text, 88)}</span>
                                  ) : null}
                                  {moreInfo.reviewEvidence.url ? (
                                    <a href={moreInfo.reviewEvidence.url} target="_blank" rel="noreferrer">
                                      {moreInfo.reviewEvidence.source}
                                    </a>
                                  ) : null}
                                </div>
                              ) : null}
                            </section>

                            <section className="lead-more-info-section">
                              <h3>Notes</h3>
                              {moreInfo.callerContext ? (
                                <div className="lead-more-info-note">{truncateCopy(moreInfo.callerContext, 120)}</div>
                              ) : (
                                <div className="lead-more-info-note tiny-muted">No extra context yet.</div>
                              )}
                              {moreInfo.contextEvidence.url ? (
                                <div className="lead-more-info-evidence">
                                  <a href={moreInfo.contextEvidence.url} target="_blank" rel="noreferrer">
                                    {moreInfo.contextEvidence.source}
                                  </a>
                                </div>
                              ) : null}
                            </section>
                          </div>
                        </aside>
                      ) : null}
                    </Fragment>
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
                      {(() => {
                        const outcomeFormId = `lead-outcome-form-${selectedProspectView.id}`;

                        return (
                          <>
                            <div className="lead-command-group lead-command-group-outcomes">
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
                                    clinicType={selectedClinicType}
                                    nextActionDue={selectedDue}
                                    companyName={selectedProspectView.name}
                                    contactName={bookingDraftValues.contactName || selectedProspectView.ownerName || ''}
                                    contactPhone={bookingDraftValues.contactPhone || selectedProspectView.phone || ''}
                                    website={selectedProspectView.website || ''}
                                    purpose={bookingDraftValues.purpose || 'Demo Booked'}
                                    notes={bookingDraftValues.notes || selectedProspectView.plainNotes || ''}
                                    initialMeetingAt={suggestedMeetingAtValue || undefined}
                                    suggestedMeetingHint={suggestedMeetingSlotHint || undefined}
                                    suggestedMeetingQuickSlots={suggestedMeetingQuickSlots}
                                    initialMeetingUrl={bookingDraftValues.meetingUrl || undefined}
                                    defaultAttendeeEmails={meetingTeamDefaults.defaultAttendeeEmails}
                                    initialHostEmail={bookingDraftValues.hostEmail || undefined}
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
                                    form={outcomeFormId}
                                  >
                                    <span className="lead-command-icon">{leadCommandIcon(command.icon)}</span>
                                    <span className="lead-command-label">{command.label}</span>
                                  </button>
                                )
                              )}
                            </div>
                            <form id={outcomeFormId} action={updateProspectOutcomeAction} hidden>
                              <input type="hidden" name="prospectId" value={selectedProspectView.id} />
                              <input type="hidden" name="nextProspectId" value={nextQueueProspectId} />
                              <input type="hidden" name="q" value={searchQuery} />
                              <input type="hidden" name="view" value={selectedView} />
                              <input type="hidden" name="status" value={selectedStatus} />
                              <input type="hidden" name="city" value={selectedCity} />
                              <input type="hidden" name="clinicType" value={selectedClinicType} />
                              <input type="hidden" name="nextActionDue" value={selectedDue} />
                            </form>
                          </>
                        );
                      })()}

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
                        <input type="hidden" name="clinicType" value={selectedClinicType} />
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
                      <input type="hidden" name="clinicType" value={selectedClinicType} />
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
