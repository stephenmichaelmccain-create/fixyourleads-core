import { Worker } from 'bullmq';
import { db } from '@/lib/db';
import { getRedis } from '@/lib/redis';
import { notifyCalendarSyncFailure, syncAppointmentToExternalCalendar } from '@/services/calendar-sync';

type CalendarSyncJobData = {
  appointmentId: string;
  reason?: string | null;
};

const worker = new Worker(
  'calendar_sync_queue',
  async (job) => {
    const { appointmentId } = job.data as CalendarSyncJobData;

    if (!appointmentId) {
      throw new Error('calendar_sync_appointment_id_required');
    }

    const result = await syncAppointmentToExternalCalendar(appointmentId, 'worker_retry');

    if (!result.success) {
      throw new Error(result.error || 'calendar_sync_failed');
    }
  },
  { connection: getRedis() }
);

worker.on('failed', async (job, error) => {
  if (!job) {
    return;
  }

  const attempts = job.opts.attempts || 1;

  if (job.attemptsMade < attempts) {
    return;
  }

  const { appointmentId } = job.data as CalendarSyncJobData;

  const appointment = await db.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      id: true,
      companyId: true,
      startTime: true,
      externalCalendarProvider: true,
      externalSyncError: true,
      company: {
        select: {
          name: true,
          notificationEmail: true
        }
      },
      contact: {
        select: {
          name: true,
          phone: true
        }
      }
    }
  });

  if (!appointment) {
    return;
  }

  await notifyCalendarSyncFailure({
    appointmentId: appointment.id,
    companyId: appointment.companyId,
    companyName: appointment.company.name,
    notificationEmail: appointment.company.notificationEmail,
    contactName: appointment.contact.name,
    contactPhone: appointment.contact.phone,
    appointmentTime: appointment.startTime,
    provider: appointment.externalCalendarProvider,
    error: appointment.externalSyncError || error.message || 'calendar_sync_failed'
  });
});
