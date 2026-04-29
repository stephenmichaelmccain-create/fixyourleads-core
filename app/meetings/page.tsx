import { AppointmentExternalSyncStatus, AppointmentStatus } from '@prisma/client';
import Link from 'next/link';
import { LayoutShell } from '@/app/components/LayoutShell';
import {
  addMeetingDefaultAttendeeAction,
  completeMeetingAndScheduleNextAction,
  removeMeetingDefaultAttendeeAction,
  retryMeetingCalendarSyncAction
} from '@/app/meetings/actions';
import { ManualMeetingDialog } from '@/app/meetings/ManualMeetingDialog';
import { ScheduleNextStageDialog } from '@/app/meetings/ScheduleNextStageDialog';
import { db } from '@/lib/db';
import { MEETING_FLOW_STAGES, meetingFlowNextStage, meetingFlowStageLabel, parseMeetingFlowStage, stageFromQueryValue } from '@/lib/meeting-flow';
import { getMeetingTeamDefaults } from '@/lib/meeting-team-defaults';
import { extractMeetingLink, meetingLinkLabel } from '@/lib/meetings';
import { normalizePhone } from '@/lib/phone';
import { isLikelyTestWorkspaceName } from '@/lib/test-workspaces';
import { safeLoadDb } from '@/lib/ui-data';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

type SearchParamShape = Promise<{
  notice?: string;
  detail?: string;
  stage?: string;
  manualBook?: string;
  meetingError?: string;
  manualBookingCompanyName?: string;
  manualBookingContactName?: string;
  manualBookingContactPhone?: string;
  manualBookingContactEmail?: string;
  manualBookingMeetingAt?: string;
  manualBookingPurpose?: string;
  manualBookingMeetingUrl?: string;
  manualBookingHostEmail?: string;
  manualBookingNotes?: string;
}>;

const UPCOMING_STATUSES = [
  AppointmentStatus.BOOKED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.RESCHEDULED
] as const;

function startOfToday() {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return value;
}

function addDays(date: Date, days: number) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

function formatMeetingTime(value: Date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  }).format(value);
}

function formatMeetingDay(value: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(value);
}

function formatRelativeTime(value: Date) {
  const diffMinutes = Math.round((value.getTime() - Date.now()) / 60_000);

  if (diffMinutes < 60) {
    return `Starts in ${Math.max(diffMinutes, 0)} min`;
  }

  if (diffMinutes < 24 * 60) {
    const hours = Math.round(diffMinutes / 60);
    return `Starts in ${hours} hr${hours === 1 ? '' : 's'}`;
  }

  const days = Math.round(diffMinutes / (24 * 60));
  return `Starts in ${days} day${days === 1 ? '' : 's'}`;
}

function formatNextCallCountdown(value: Date | null) {
  if (!value) {
    return 'No calls';
  }

  const diffMinutes = Math.max(Math.round((value.getTime() - Date.now()) / 60_000), 0);

  if (diffMinutes < 60) {
    return `${diffMinutes} min`;
  }

  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;

  if (minutes === 0) {
    return `${hours} hr`;
  }

  return `${hours}h ${minutes}m`;
}

function formatStatus(status: AppointmentStatus) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function syncErrorCopy(value?: string | null) {
  const code = String(value || '').trim();

  if (!code) {
    return '';
  }

  if (code === 'calendar_sync_not_configured') return 'Calendar sync is not configured yet on this client.';
  if (code === 'google_calendar_id_missing') return 'Google Calendar ID is missing.';
  if (code === 'google_calendar_credentials_missing') return 'Google calendar credentials are missing.';
  if (code === 'unsupported_calendar_provider') return 'Unsupported calendar provider.';
  if (code === 'google_calendar_access_token_failed') return 'Could not get Google calendar access token.';
  if (code === 'google_calendar_event_create_failed') return 'Google calendar rejected event creation.';
  if (code === 'google_calendar_freebusy_failed') return 'Google calendar availability check failed.';

  return code.replace(/_/g, ' ');
}

function formatSyncStatus(status: AppointmentExternalSyncStatus) {
  if (status === AppointmentExternalSyncStatus.SYNCED) {
    return 'Synced';
  }

  if (status === AppointmentExternalSyncStatus.FAILED) {
    return 'Sync failed';
  }

  if (status === AppointmentExternalSyncStatus.SKIPPED) {
    return 'Sync skipped';
  }

  return 'Sync pending';
}

function statusClassName(status: AppointmentStatus) {
  if (status === AppointmentStatus.CONFIRMED) {
    return styles.statusConfirmed;
  }

  if (status === AppointmentStatus.RESCHEDULED) {
    return styles.statusRescheduled;
  }

  return styles.statusBooked;
}

function syncStatusClassName(status: AppointmentExternalSyncStatus) {
  if (status === AppointmentExternalSyncStatus.SYNCED) {
    return styles.syncStatusSynced;
  }

  if (status === AppointmentExternalSyncStatus.FAILED) {
    return styles.syncStatusFailed;
  }

  if (status === AppointmentExternalSyncStatus.SKIPPED) {
    return styles.syncStatusSkipped;
  }

  return styles.syncStatusPending;
}

export default async function MeetingsPage({
  searchParams
}: {
  searchParams?: SearchParamShape;
}) {
  const query = (await searchParams) || {};
  const now = new Date();
  const todayStart = startOfToday();
  const selectedStage = stageFromQueryValue(query.stage);
  const manualBookingOpen = query.manualBook === '1';

  const appointments = await safeLoadDb(
    () =>
      db.appointment.findMany({
        where: {
          startTime: { gte: now },
          status: { in: [...UPCOMING_STATUSES] }
        },
        orderBy: [{ startTime: 'asc' }],
        take: 40,
        select: {
          id: true,
          startTime: true,
          status: true,
          purpose: true,
          meetingUrl: true,
          hostEmail: true,
          attendeeEmails: true,
          displayCompanyName: true,
          sourceProspectId: true,
          notes: true,
          callExternalId: true,
          callRecordingUrl: true,
          callTranscriptUrl: true,
          callTranscriptText: true,
          externalSyncStatus: true,
          externalSyncError: true,
          externalSyncedAt: true,
          company: {
            select: {
              id: true,
              name: true
            }
          },
          contact: {
            select: {
              name: true,
              phone: true,
              email: true
            }
          }
        }
      }),
    []
  );
  const meetingTeamDefaults = await safeLoadDb(() => getMeetingTeamDefaults(), {
    defaultAttendeeEmails: []
  });

  const companyIds = Array.from(new Set(appointments.map((appointment) => appointment.company.id)));
  const approvedRows =
    companyIds.length > 0
      ? await safeLoadDb(
          () =>
            db.eventLog.findMany({
              where: {
                companyId: { in: companyIds },
                eventType: 'client_signup_approved'
              },
              select: {
                companyId: true
              }
            }),
          []
        )
      : [];

  const approvedCompanyIds = new Set(approvedRows.map((event) => event.companyId));
  const liveAppointments = appointments.filter(
    (appointment) =>
      Boolean(appointment.displayCompanyName) ||
      approvedCompanyIds.has(appointment.company.id) ||
      !isLikelyTestWorkspaceName(appointment.company.name)
  );

  const rows = liveAppointments.map((appointment) => {
    const meetingLink = appointment.meetingUrl?.trim() || extractMeetingLink(appointment.notes);
    const flowStage = parseMeetingFlowStage({
      notes: appointment.notes,
      purpose: appointment.purpose
    });

    return {
      ...appointment,
      companyLabel: appointment.displayCompanyName?.trim() || appointment.company.name,
      contactPhone: normalizePhone(appointment.contact.phone),
      meetingLink,
      flowStage
    };
  });
  const stageCounts = new Map(MEETING_FLOW_STAGES.map((stage) => [stage.key, 0]));
  rows.forEach((row) => {
    stageCounts.set(row.flowStage, (stageCounts.get(row.flowStage) || 0) + 1);
  });
  const filteredRows = rows.filter((row) => row.flowStage === selectedStage);

  const meetingsToday = filteredRows.filter((appointment) => appointment.startTime >= todayStart && appointment.startTime < addDays(todayStart, 1)).length;
  const missingLinkCount = filteredRows.filter((appointment) => !appointment.meetingLink).length;
  const syncIssueCount = filteredRows.filter((appointment) => appointment.externalSyncStatus === AppointmentExternalSyncStatus.FAILED).length;
  const syncPendingCount = filteredRows.filter((appointment) => appointment.externalSyncStatus === AppointmentExternalSyncStatus.PENDING).length;
  const evidenceMissingCount = rows.filter(
    (appointment) => !appointment.callRecordingUrl?.trim() && !appointment.callTranscriptUrl?.trim() && !appointment.callTranscriptText?.trim()
  ).length;
  const needsPrepCount = filteredRows.filter(
    (appointment) =>
      !appointment.meetingLink ||
      !appointment.notes?.trim() ||
      appointment.externalSyncStatus !== AppointmentExternalSyncStatus.SYNCED ||
      (!appointment.callRecordingUrl?.trim() && !appointment.callTranscriptUrl?.trim() && !appointment.callTranscriptText?.trim())
  ).length;
  const nextMeeting = filteredRows[0] || null;

  return (
    <LayoutShell
      title="Meetings"
      section="meetings"
      hidePageHeader
    >
      <section className={styles.board}>
        <div className={styles.boardContent}>
          {query.notice && (
            <section className={styles.noticeBanner}>
              <div className={styles.noticeTitle}>
                {query.notice === 'meeting_default_attendee_added'
                  ? 'Default attendee added.'
                  : query.notice === 'meeting_default_attendee_removed'
                    ? 'Default attendee removed.'
                    : query.notice === 'meeting_default_attendee_exists'
                      ? 'That attendee is already on the default list.'
                      : query.notice === 'meeting_default_attendee_invalid'
                        ? 'Add a valid attendee email.'
                : query.notice === 'calendar_sync_synced'
                  ? 'Calendar sync worked.'
                : query.notice === 'calendar_sync_retry_queued'
                    ? 'Calendar retry queued.'
                    : query.notice === 'meeting_stage_advanced'
                      ? 'Stage completed and next meeting scheduled.'
                      : query.notice === 'meeting_manual_booked'
                        ? 'Appointment booked.'
                      : query.notice === 'meeting_stage_complete'
                        ? 'Stage completed.'
                        : query.notice === 'meeting_stage_failed'
                        ? 'Meeting update needs attention.'
                    : 'Calendar sync still needs attention.'}
              </div>
              <div className={styles.noticeCopy}>
                {query.notice === 'meeting_default_attendee_added'
                  ? 'New lead-booked meetings will now auto-add that email.'
                  : query.notice === 'meeting_default_attendee_removed'
                    ? 'Future lead-booked meetings will stop auto-adding that email.'
                    : query.notice === 'meeting_manual_booked'
                      ? 'The appointment is now on the meetings board with the person details you entered from scratch.'
                    : query.notice === 'meeting_default_attendee_exists'
                      ? 'Use the current auto-added people list below to remove or review it.'
                      : query.notice === 'meeting_default_attendee_invalid'
                        ? 'Use a full email address like name@gmail.com.'
                        : query.notice === 'calendar_sync_synced'
                  ? 'The external calendar event is now linked to this meeting.'
                : query.notice === 'calendar_sync_retry_queued'
                    ? 'We saved the failure and queued another sync attempt in the background.'
                    : query.notice === 'meeting_stage_advanced'
                      ? 'The current meeting moved to completed and the next stage was scheduled.'
                    : query.notice === 'meeting_stage_complete'
                      ? 'This final-stage meeting was marked complete.'
                      : query.notice === 'meeting_stage_failed'
                        ? query.detail === 'invalid_next_start_time'
                          ? 'Pick a valid date and time before scheduling the next stage.'
                          : query.detail === 'next_start_time_in_past'
                            ? 'Next meeting time must be in the future.'
                            : query.detail || 'We could not complete this meeting update yet.'
                    : query.detail || 'The meeting stayed booked internally, but the external calendar still needs a retry.'}
              </div>
            </section>
          )}

          <div className={styles.hero}>
            <div>
              <div className={styles.heroTitleWrap}>
                <h1 className={styles.heroTitle}>{meetingFlowStageLabel(selectedStage)}</h1>
                <span className={styles.heroBadge}>{meetingsToday} today</span>
              </div>
                <div className={styles.heroActions}>
                  <ManualMeetingDialog
                    defaultAttendeeEmails={meetingTeamDefaults.defaultAttendeeEmails}
                    initialCompanyName={query.manualBookingCompanyName}
                    initialContactName={query.manualBookingContactName}
                    initialContactPhone={query.manualBookingContactPhone}
                    initialContactEmail={query.manualBookingContactEmail}
                    initialMeetingAt={query.manualBookingMeetingAt}
                    initialPurpose={query.manualBookingPurpose || meetingFlowStageLabel(selectedStage)}
                    initialMeetingUrl={query.manualBookingMeetingUrl}
                    initialHostEmail={query.manualBookingHostEmail}
                    initialNotes={query.manualBookingNotes}
                    initialOpen={manualBookingOpen}
                    meetingError={query.meetingError}
                    meetingStage={selectedStage}
                  />
                </div>
            </div>

            <div className={styles.heroStats}>
              <div className={styles.heroStat}>
                <span className={styles.heroStatIcon} aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="8" />
                    <path d="M12 8v4l2.5 2.5" />
                  </svg>
                </span>
                <div>
                  <div className={styles.heroStatLabel}>Next call in</div>
                  <div className={styles.heroStatValue}>{formatNextCallCountdown(nextMeeting?.startTime || null)}</div>
                  <div className={styles.heroStatCopy}>{nextMeeting ? formatMeetingDay(nextMeeting.startTime) : 'Nothing booked yet'}</div>
                </div>
              </div>

              <div className={styles.heroRoster}>
                <div className={styles.heroStatLabel}>Default attendee emails</div>
                <form action={addMeetingDefaultAttendeeAction} className={styles.heroRosterForm}>
                  <input
                    type="email"
                    name="email"
                    className={styles.heroRosterInput}
                    placeholder="add@gmail.com"
                    aria-label="Add default attendee email"
                  />
                  <button type="submit" className={styles.heroRosterButton}>
                    Add
                  </button>
                </form>
                <details className={styles.heroRosterList}>
                  <summary>
                    Current auto-added people ({meetingTeamDefaults.defaultAttendeeEmails.length})
                  </summary>
                  <div className={styles.heroRosterItems}>
                    {meetingTeamDefaults.defaultAttendeeEmails.length === 0 ? (
                      <div className={styles.heroRosterEmpty}>No attendee emails saved yet.</div>
                    ) : (
                      meetingTeamDefaults.defaultAttendeeEmails.map((email) => (
                        <form key={email} action={removeMeetingDefaultAttendeeAction} className={styles.heroRosterItem}>
                          <input type="hidden" name="email" value={email} />
                          <span>{email}</span>
                          <button type="submit" className={styles.heroRosterRemove}>
                            Remove
                          </button>
                        </form>
                      ))
                    )}
                  </div>
                </details>
              </div>

              <div className={styles.heroStat}>
                <span className={`${styles.heroStatIcon} ${styles.heroStatAlert}`} aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="8" />
                    <path d="M12 8v5" />
                    <circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
                  </svg>
                </span>
                <div>
                  <div className={styles.heroStatLabel}>Needs prep</div>
                  <div className={styles.heroStatValue}>{needsPrepCount}</div>
                  <div className={styles.heroStatCopy}>
                    {missingLinkCount} missing a join link, {syncIssueCount + syncPendingCount} need calendar sync attention, {evidenceMissingCount} missing call evidence
                  </div>
                </div>
              </div>
            </div>
          </div>

          <section className={styles.stageTabs} aria-label="Meeting pipeline stages">
            {MEETING_FLOW_STAGES.map((stage) => (
              <Link
                key={stage.key}
                href={`/meetings?stage=${stage.key}`}
                className={`${styles.stageTab} ${selectedStage === stage.key ? styles.stageTabActive : ''}`}
              >
                <span>{stage.label}</span>
                <span className={styles.stageTabCount}>{stageCounts.get(stage.key) || 0}</span>
              </Link>
            ))}
          </section>

          <section className={styles.tableShell} aria-label="Upcoming meetings">
            <div className={styles.tableHeader}>
              <div>Time</div>
              <div>Client / Company</div>
              <div>Contact</div>
              <div>Purpose</div>
              <div>Actions</div>
            </div>

            {filteredRows.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyCard}>
                  <div className={styles.emptyTitle}>No upcoming appointments are booked right now.</div>
                  <div className={styles.emptyCopy}>
                    Once new calls are booked, this board will show time, contact details, notes, and the join link in one place.
                  </div>
                    <div className={styles.emptyActions}>
                      <ManualMeetingDialog
                        defaultAttendeeEmails={meetingTeamDefaults.defaultAttendeeEmails}
                        initialCompanyName={query.manualBookingCompanyName}
                        initialContactName={query.manualBookingContactName}
                        initialContactPhone={query.manualBookingContactPhone}
                        initialContactEmail={query.manualBookingContactEmail}
                        initialMeetingAt={query.manualBookingMeetingAt}
                        initialPurpose={query.manualBookingPurpose || meetingFlowStageLabel(selectedStage)}
                        initialMeetingUrl={query.manualBookingMeetingUrl}
                        initialHostEmail={query.manualBookingHostEmail}
                        initialNotes={query.manualBookingNotes}
                        initialOpen={false}
                        meetingError={undefined}
                        meetingStage={selectedStage}
                      />
                    </div>
                </div>
              </div>
            ) : (
              <>
                <div className={styles.tableBody}>
                  {filteredRows.map((appointment) => {
                    const contactName = appointment.contact.name?.trim() || 'Unnamed contact';
                    const meetingLabel = appointment.meetingLink ? meetingLinkLabel(appointment.meetingLink) : 'No link yet';
                    const noteCopy = appointment.notes?.trim() || '';
                    const purposeCopy = appointment.purpose?.trim() || 'No purpose yet';
                    const syncLabel = formatSyncStatus(appointment.externalSyncStatus);
                    const transcriptSnippet = appointment.callTranscriptText?.trim() || '';
                    const nextStage = meetingFlowNextStage(appointment.flowStage);
                    const syncErrorLabel = syncErrorCopy(appointment.externalSyncError);
                    const scheduleReturnTo = `/meetings?stage=${selectedStage}`;
                    const suggestedNextStartIso = nextStage
                      ? addDays(appointment.startTime, nextStage.offsetDays).toISOString()
                      : '';

                    return (
                      <article key={appointment.id} className={styles.row}>
                        <div className={styles.timeCell}>
                          <div className={styles.timeTop}>
                            <span className={styles.clockIcon} aria-hidden="true">
                              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="8" />
                                <path d="M12 8v4l2.5 2.5" />
                              </svg>
                            </span>
                            <span>{formatMeetingTime(appointment.startTime)}</span>
                          </div>
                          <div className={styles.dateText}>{formatMeetingDay(appointment.startTime)}</div>
                          <div className={styles.relativeText}>{formatRelativeTime(appointment.startTime)}</div>
                        </div>

                        <div>
                          <div className={styles.primaryText}>{appointment.companyLabel}</div>
                          <div className={styles.secondaryText}>
                            <span className={`${styles.statusDot} ${statusClassName(appointment.status)}`} aria-hidden="true" />{' '}
                            {formatStatus(appointment.status)} · {meetingFlowStageLabel(appointment.flowStage)}
                          </div>
                        </div>

                        <div>
                          <div className={styles.primaryText}>{contactName}</div>
                          <div className={styles.contactMeta}>{appointment.contactPhone || 'No phone yet'}</div>
                          {appointment.contact.email?.trim() ? <div className={styles.contactMeta}>{appointment.contact.email.trim()}</div> : null}
                          <div className={styles.contactMeta}>Host: {appointment.hostEmail || 'None assigned'}</div>
                          <div className={styles.contactMeta}>
                            Auto-added: {appointment.attendeeEmails.length > 0 ? appointment.attendeeEmails.join(', ') : 'None'}
                          </div>
                        </div>

                        <div className={styles.purposeText}>
                          <strong>{purposeCopy}</strong>
                          {noteCopy ? `\n${noteCopy}` : ''}
                          {transcriptSnippet ? `\n\nTranscript: ${transcriptSnippet.slice(0, 220)}${transcriptSnippet.length > 220 ? '…' : ''}` : ''}
                        </div>

                        <div className={styles.actions}>
                          <span className={`${styles.syncStatus} ${syncStatusClassName(appointment.externalSyncStatus)}`}>
                            {syncLabel}
                          </span>
                          {appointment.meetingLink ? (
                            <a className={styles.actionPrimary} href={appointment.meetingLink} target="_blank" rel="noreferrer">
                              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                                <path d="M15 8.5v7l5-3.5v-5z" />
                                <rect x="3" y="6" width="13" height="12" rx="2.5" fill="currentColor" />
                              </svg>
                              Join on {meetingLabel}
                            </a>
                          ) : (
                            <span className={`${styles.actionSecondary} ${styles.actionGhost}`}>{meetingLabel}</span>
                          )}
                          {appointment.sourceProspectId ? (
                            <Link className={styles.actionSecondary} href={`/leads?prospectId=${appointment.sourceProspectId}`}>
                              Open lead
                            </Link>
                          ) : (
                            <Link className={styles.actionSecondary} href={`/clients/${appointment.company.id}`}>
                              Open client
                            </Link>
                          )}
                          {appointment.callRecordingUrl?.trim() ? (
                            <a className={styles.actionSecondary} href={appointment.callRecordingUrl.trim()} target="_blank" rel="noreferrer">
                              Recording
                            </a>
                          ) : null}
                          {appointment.callTranscriptUrl?.trim() ? (
                            <a className={styles.actionSecondary} href={appointment.callTranscriptUrl.trim()} target="_blank" rel="noreferrer">
                              Transcript
                            </a>
                          ) : null}
                          {appointment.externalSyncStatus !== AppointmentExternalSyncStatus.SYNCED ? (
                            <form action={retryMeetingCalendarSyncAction}>
                              <input type="hidden" name="appointmentId" value={appointment.id} />
                              <input type="hidden" name="returnTo" value={`/meetings?stage=${selectedStage}`} />
                              <button type="submit" className={styles.actionButton}>
                                Retry calendar sync
                              </button>
                            </form>
                          ) : null}
                          {nextStage ? (
                            <ScheduleNextStageDialog
                              appointmentId={appointment.id}
                              currentStage={selectedStage}
                              nextStageLabel={meetingFlowStageLabel(nextStage.key)}
                              returnTo={scheduleReturnTo}
                              suggestedStartIso={suggestedNextStartIso}
                            />
                          ) : (
                            <form action={completeMeetingAndScheduleNextAction}>
                              <input type="hidden" name="appointmentId" value={appointment.id} />
                              <input type="hidden" name="returnTo" value={scheduleReturnTo} />
                              <input type="hidden" name="stage" value={selectedStage} />
                              <button type="submit" className={styles.actionButton}>
                                Complete Stage
                              </button>
                            </form>
                          )}
                          {syncErrorLabel ? <div className={styles.syncErrorText}>{syncErrorLabel}</div> : null}
                          {appointment.callExternalId?.trim() ? (
                            <div className={styles.syncMetaText}>Call ID {appointment.callExternalId.trim()}</div>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>

                <div className={styles.mobileCards}>
                  {filteredRows.map((appointment) => {
                    const contactName = appointment.contact.name?.trim() || 'Unnamed contact';
                    const meetingLabel = appointment.meetingLink ? meetingLinkLabel(appointment.meetingLink) : 'No link yet';
                    const noteCopy = appointment.notes?.trim() || '';
                    const purposeCopy = appointment.purpose?.trim() || 'No purpose yet';
                    const syncLabel = formatSyncStatus(appointment.externalSyncStatus);
                    const transcriptSnippet = appointment.callTranscriptText?.trim() || '';
                    const nextStage = meetingFlowNextStage(appointment.flowStage);
                    const syncErrorLabel = syncErrorCopy(appointment.externalSyncError);
                    const scheduleReturnTo = `/meetings?stage=${selectedStage}`;
                    const suggestedNextStartIso = nextStage
                      ? addDays(appointment.startTime, nextStage.offsetDays).toISOString()
                      : '';

                    return (
                      <article key={`${appointment.id}-mobile`} className={styles.mobileCard}>
                        <div className={styles.mobileTop}>
                          <div>
                            <div className={styles.primaryText}>{formatMeetingTime(appointment.startTime)}</div>
                            <div className={styles.dateText}>{formatMeetingDay(appointment.startTime)}</div>
                            <div className={styles.relativeText}>{formatRelativeTime(appointment.startTime)}</div>
                          </div>
                          <div className={styles.secondaryText}>{formatStatus(appointment.status)}</div>
                        </div>

                        <div className={styles.mobileFields}>
                          <div>
                            <div className={styles.mobileFieldLabel}>Client</div>
                            <div className={styles.mobileFieldValue}>{appointment.companyLabel}</div>
                          </div>
                          <div>
                            <div className={styles.mobileFieldLabel}>Contact</div>
                            <div className={styles.mobileFieldValue}>
                              {contactName}
                              {'\n'}
                              {appointment.contactPhone || 'No phone yet'}
                              {appointment.contact.email?.trim() ? `\n${appointment.contact.email.trim()}` : ''}
                              {`\nHost: ${appointment.hostEmail || 'None assigned'}`}
                              {`\nAuto-added: ${appointment.attendeeEmails.length > 0 ? appointment.attendeeEmails.join(', ') : 'None'}`}
                            </div>
                          </div>
                          <div>
                            <div className={styles.mobileFieldLabel}>Purpose</div>
                            <div className={styles.mobileFieldValue}>
                              {purposeCopy}
                              {noteCopy ? `\n${noteCopy}` : ''}
                              {transcriptSnippet ? `\n\nTranscript: ${transcriptSnippet.slice(0, 220)}${transcriptSnippet.length > 220 ? '…' : ''}` : ''}
                            </div>
                          </div>
                          <div>
                            <div className={styles.mobileFieldLabel}>Calendar sync</div>
                            <div className={styles.mobileFieldValue}>
                              <span className={`${styles.syncStatus} ${syncStatusClassName(appointment.externalSyncStatus)}`}>
                                {syncLabel}
                              </span>
                              {syncErrorLabel ? `\n${syncErrorLabel}` : ''}
                            </div>
                          </div>
                        </div>

                        <div className={styles.actions}>
                          {appointment.meetingLink ? (
                            <a className={styles.actionPrimary} href={appointment.meetingLink} target="_blank" rel="noreferrer">
                              Join on {meetingLabel}
                            </a>
                          ) : (
                            <span className={`${styles.actionSecondary} ${styles.actionGhost}`}>{meetingLabel}</span>
                          )}
                          {appointment.sourceProspectId ? (
                            <Link className={styles.actionSecondary} href={`/leads?prospectId=${appointment.sourceProspectId}`}>
                              Open lead
                            </Link>
                          ) : (
                            <Link className={styles.actionSecondary} href={`/clients/${appointment.company.id}`}>
                              Open client
                            </Link>
                          )}
                          {appointment.callRecordingUrl?.trim() ? (
                            <a className={styles.actionSecondary} href={appointment.callRecordingUrl.trim()} target="_blank" rel="noreferrer">
                              Recording
                            </a>
                          ) : null}
                          {appointment.callTranscriptUrl?.trim() ? (
                            <a className={styles.actionSecondary} href={appointment.callTranscriptUrl.trim()} target="_blank" rel="noreferrer">
                              Transcript
                            </a>
                          ) : null}
                          {appointment.externalSyncStatus !== AppointmentExternalSyncStatus.SYNCED ? (
                            <form action={retryMeetingCalendarSyncAction} className={styles.actionForm}>
                              <input type="hidden" name="appointmentId" value={appointment.id} />
                              <input type="hidden" name="returnTo" value={`/meetings?stage=${selectedStage}`} />
                              <button type="submit" className={styles.actionButton}>
                                Retry calendar sync
                              </button>
                            </form>
                          ) : null}
                          {nextStage ? (
                            <ScheduleNextStageDialog
                              appointmentId={appointment.id}
                              currentStage={selectedStage}
                              nextStageLabel={meetingFlowStageLabel(nextStage.key)}
                              returnTo={scheduleReturnTo}
                              suggestedStartIso={suggestedNextStartIso}
                            />
                          ) : (
                            <form action={completeMeetingAndScheduleNextAction} className={styles.actionForm}>
                              <input type="hidden" name="appointmentId" value={appointment.id} />
                              <input type="hidden" name="returnTo" value={scheduleReturnTo} />
                              <input type="hidden" name="stage" value={selectedStage} />
                              <button type="submit" className={styles.actionButton}>
                                Complete Stage
                              </button>
                            </form>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          <div className={styles.footerNote}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="5" width="16" height="15" rx="2.5" />
              <path d="M8 3.5v3M16 3.5v3M4 9.5h16" />
            </svg>
            <span>All times shown in your local time.</span>
          </div>
        </div>
      </section>
    </LayoutShell>
  );
}
