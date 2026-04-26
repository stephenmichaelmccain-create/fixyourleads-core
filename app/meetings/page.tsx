import { AppointmentStatus } from '@prisma/client';
import Link from 'next/link';
import { LayoutShell } from '@/app/components/LayoutShell';
import { db } from '@/lib/db';
import { extractMeetingLink, meetingLinkLabel } from '@/lib/meetings';
import { normalizePhone } from '@/lib/phone';
import { isLikelyTestWorkspaceName } from '@/lib/test-workspaces';
import { safeLoadDb } from '@/lib/ui-data';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

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

function statusClassName(status: AppointmentStatus) {
  if (status === AppointmentStatus.CONFIRMED) {
    return styles.statusConfirmed;
  }

  if (status === AppointmentStatus.RESCHEDULED) {
    return styles.statusRescheduled;
  }

  return styles.statusBooked;
}

export default async function MeetingsPage() {
  const now = new Date();
  const todayStart = startOfToday();

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
          notes: true,
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
    (appointment) => approvedCompanyIds.has(appointment.company.id) || !isLikelyTestWorkspaceName(appointment.company.name)
  );

  const rows = liveAppointments.map((appointment) => {
    const meetingLink = extractMeetingLink(appointment.notes);

    return {
      ...appointment,
      contactPhone: normalizePhone(appointment.contact.phone),
      meetingLink
    };
  });

  const meetingsToday = rows.filter((appointment) => appointment.startTime >= todayStart && appointment.startTime < addDays(todayStart, 1)).length;
  const missingLinkCount = rows.filter((appointment) => !appointment.meetingLink).length;
  const needsPrepCount = rows.filter((appointment) => !appointment.meetingLink || !appointment.notes?.trim()).length;
  const nextMeeting = rows[0] || null;

  return (
    <LayoutShell
      title="Meetings"
      section="meetings"
      hidePageHeader
    >
      <section className={styles.board}>
        <div className={styles.boardContent}>
          <div className={styles.hero}>
            <div>
              <div className={styles.heroTitleWrap}>
                <h1 className={styles.heroTitle}>Upcoming meetings</h1>
                <span className={styles.heroBadge}>{meetingsToday} today</span>
              </div>
              <p className={styles.heroNote}>
                Exactly what the meeting taker needs next. Join links only appear when a Google Meet, Zoom, or Teams URL was
                added to the appointment notes.
              </p>
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
                  <div className={styles.heroStatCopy}>{missingLinkCount} missing a join link</div>
                </div>
              </div>
            </div>
          </div>

          <section className={styles.tableShell} aria-label="Upcoming meetings">
            <div className={styles.tableHeader}>
              <div>Time</div>
              <div>Client / Company</div>
              <div>Contact</div>
              <div>Purpose</div>
              <div>Actions</div>
            </div>

            {rows.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyCard}>
                  <div className={styles.emptyTitle}>No upcoming appointments are booked right now.</div>
                  <div className={styles.emptyCopy}>
                    Once new calls are booked, this board will show time, contact details, notes, and the join link in one place.
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className={styles.tableBody}>
                  {rows.map((appointment) => {
                    const contactName = appointment.contact.name?.trim() || 'Unnamed contact';
                    const meetingLabel = appointment.meetingLink ? meetingLinkLabel(appointment.meetingLink) : 'No link yet';
                    const noteCopy = appointment.notes?.trim() || 'No appointment notes yet';

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
                          <div className={styles.relativeText}>{formatRelativeTime(appointment.startTime)}</div>
                        </div>

                        <div>
                          <div className={styles.primaryText}>{appointment.company.name}</div>
                          <div className={styles.secondaryText}>
                            <span className={`${styles.statusDot} ${statusClassName(appointment.status)}`} aria-hidden="true" />{' '}
                            {formatStatus(appointment.status)}
                          </div>
                        </div>

                        <div>
                          <div className={styles.primaryText}>{contactName}</div>
                          <div className={styles.contactMeta}>{appointment.contactPhone || 'No phone yet'}</div>
                          {appointment.contact.email?.trim() ? <div className={styles.contactMeta}>{appointment.contact.email.trim()}</div> : null}
                        </div>

                        <div className={styles.purposeText}>{noteCopy}</div>

                        <div className={styles.actions}>
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
                          <Link className={styles.actionSecondary} href={`/clients/${appointment.company.id}`}>
                            Open client
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <div className={styles.mobileCards}>
                  {rows.map((appointment) => {
                    const contactName = appointment.contact.name?.trim() || 'Unnamed contact';
                    const meetingLabel = appointment.meetingLink ? meetingLinkLabel(appointment.meetingLink) : 'No link yet';
                    const noteCopy = appointment.notes?.trim() || 'No appointment notes yet';

                    return (
                      <article key={`${appointment.id}-mobile`} className={styles.mobileCard}>
                        <div className={styles.mobileTop}>
                          <div>
                            <div className={styles.primaryText}>{formatMeetingTime(appointment.startTime)}</div>
                            <div className={styles.relativeText}>{formatRelativeTime(appointment.startTime)}</div>
                          </div>
                          <div className={styles.secondaryText}>{formatStatus(appointment.status)}</div>
                        </div>

                        <div className={styles.mobileFields}>
                          <div>
                            <div className={styles.mobileFieldLabel}>Client</div>
                            <div className={styles.mobileFieldValue}>{appointment.company.name}</div>
                          </div>
                          <div>
                            <div className={styles.mobileFieldLabel}>Contact</div>
                            <div className={styles.mobileFieldValue}>
                              {contactName}
                              {'\n'}
                              {appointment.contactPhone || 'No phone yet'}
                              {appointment.contact.email?.trim() ? `\n${appointment.contact.email.trim()}` : ''}
                            </div>
                          </div>
                          <div>
                            <div className={styles.mobileFieldLabel}>Purpose</div>
                            <div className={styles.mobileFieldValue}>{noteCopy}</div>
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
                          <Link className={styles.actionSecondary} href={`/clients/${appointment.company.id}`}>
                            Open client
                          </Link>
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
