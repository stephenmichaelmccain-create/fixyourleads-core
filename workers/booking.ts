import { Worker } from 'bullmq';
import { getRedis } from '@/lib/redis';
import { createAppointmentFlow } from '@/services/booking';

new Worker('booking_queue', async (job) => {
  const { companyId, contactId } = job.data;
  await createAppointmentFlow({ companyId, contactId });
}, { connection: getRedis() });
