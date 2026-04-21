import { Worker } from 'bullmq';
import { getRedis } from '@/lib/redis';
import { createAppointmentFlow, resolveAppointmentStartTime } from '@/services/booking';

new Worker('booking_queue', async (job) => {
  const { companyId, contactId, startTime } = job.data;

  if (!companyId || !contactId) {
    throw new Error('companyId_contactId_required');
  }

  await createAppointmentFlow({
    companyId,
    contactId,
    startTime: startTime ? resolveAppointmentStartTime(new Date(startTime)) : undefined
  });
}, { connection: getRedis() });
