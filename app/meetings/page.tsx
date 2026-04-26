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
    weekday: 'short',
    month: 'short',
    day: 'numeric',
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
  const nextWeek = addDays(todayStart, 7);

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
  const meetingsThisWeek = rows.filter((appointment) => appointment.startTime < nextWeek).length;
  const missingLinkCount = rows.filter((appointment) => !appointment.meetingLink).length;

  return (
    <LayoutShell
      title="Meetings"
      description="Upcoming video calls for the person taking the call. This view is intentionally minimal and uses the current appointment records."
      section="meetings"
    >
      <div className="panel-grid">
        <section className="panel">
          <div className="metric-label">Link readiness</div>
          <p className={styles.noticeCopy}>
            Google Meet links are not stored on appointments yet. This page only shows a join link when a Google Meet, Zoom, or
            Teams URL was pasted into the appointment notes.
          </p>
        </section>
      </div>

      <section className="metric-grid">
        <div className="metric-card">
          <div className="metric-label">Today</div>
          <div className="metric-value">{meetingsToday}</div>
          <div className="metric-copy">Calls starting before tomorrow.</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Next 7 Days</div>
          <div className="metric-value">{meetingsThisWeek}</div>
          <div className="metric-copy">Booked or confirmed appointments on deck.</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Missing Link</div>
          <div className="metric-value">{missingLinkCount}</div>
          <div className="metric-copy">Appointments that still need a join URL added somewhere.</div>
        </div>
      </section>

      <section className="panel panel-stack">
        <div>
          <div className="metric-label">Upcoming queue</div>
          <h2 className="form-title">What the meeting taker needs next</h2>
          <div className="text-muted">Time, contact details, notes, and a join link if one already exists.</div>
        </div>

        {rows.length === 0 ? (
          <div className="empty-state">No upcoming appointments are booked right now.</div>
        ) : (
          <div className={styles.meetingList}>
            {rows.map((appointment) => {
              const contactName = appointment.contact.name?.trim() || 'Unnamed contact';

              return (
                <article key={appointment.id} className={`panel ${styles.meetingCard}`}>
                  <div className={styles.meetingHeader}>
                    <div className={styles.timeBlock}>
                      <div className={styles.timeValue}>{formatMeetingTime(appointment.startTime)}</div>
                      <div className={styles.timeMeta}>{formatMeetingDay(appointment.startTime)}</div>
                    </div>
                    <div className={styles.meetingMeta}>
                      <span className={styles.relativeChip}>{formatRelativeTime(appointment.startTime)}</span>
                      <span className={`${styles.statusChip} ${statusClassName(appointment.status)}`}>{formatStatus(appointment.status)}</span>
                    </div>
                  </div>

                  <div className={styles.fieldGrid}>
                    <div className={styles.field}>
                      <div className={styles.fieldLabel}>Client</div>
                      <div className={styles.fieldValue}>{appointment.company.name}</div>
                    </div>
                    <div className={styles.field}>
                      <div className={styles.fieldLabel}>Contact</div>
                      <div className={styles.fieldValue}>{contactName}</div>
                    </div>
                    <div className={styles.field}>
                      <div className={styles.fieldLabel}>Phone</div>
                      <div className={styles.fieldValue}>{appointment.contactPhone || 'No phone yet'}</div>
                    </div>
                    <div className={styles.field}>
                      <div className={styles.fieldLabel}>Email</div>
                      <div className={styles.fieldValue}>{appointment.contact.email?.trim() || 'No email yet'}</div>
                    </div>
                    <div className={styles.field}>
                      <div className={styles.fieldLabel}>Meeting link</div>
                      <div className={styles.fieldValue}>
                        {appointment.meetingLink ? (
                          <a href={appointment.meetingLink} target="_blank" rel="noreferrer">
                            {meetingLinkLabel(appointment.meetingLink)}
                          </a>
                        ) : (
                          'No meeting link yet'
                        )}
                      </div>
                    </div>
                    <div className={styles.field}>
                      <div className={styles.fieldLabel}>Notes</div>
                      <div className={`${styles.fieldValue} ${styles.notesValue}`}>
                        {appointment.notes?.trim() || 'No appointment notes yet'}
                      </div>
                    </div>
                  </div>

                  <div className={styles.actions}>
                    {appointment.meetingLink ? (
                      <a className="button-secondary" href={appointment.meetingLink} target="_blank" rel="noreferrer">
                        Join {meetingLinkLabel(appointment.meetingLink)}
                      </a>
                    ) : null}
                    <Link className="button-ghost" href={`/clients/${appointment.company.id}/operator`}>
                      Open operator
                    </Link>
                    <Link className="button-ghost" href={`/clients/${appointment.company.id}`}>
                      Open client
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </LayoutShell>
  );
}
