import { Worker } from 'bullmq';
import { getRedis } from '@/lib/redis';
import { createAppointmentFlow, requestBookingDetailsFlow, resolveAppointmentStartTime } from '@/services/booking';

new Worker('booking_queue', async (job) => {
  const { companyId, contactId, startTime, text } = job.data;

  if (!companyId || !contactId) {
    throw new Error('companyId_contactId_required');
  }

  if (!startTime) {
    await requestBookingDetailsFlow({
      companyId,
      contactId,
      inboundText: typeof text === 'string' ? text : null
    });
    return;
  }

  await createAppointmentFlow({
    companyId,
    contactId,
    startTime: startTime ? resolveAppointmentStartTime(new Date(startTime)) : undefined
  });
}, { connection: getRedis() });
