import { Worker } from 'bullmq';
import { getRedis } from '@/lib/redis';
import { createMockAppointment } from '@/services/booking';

new Worker('booking_queue', async (job) => {
  const { companyId, contactId } = job.data;
  await createMockAppointment(companyId, contactId);
}, { connection: getRedis() });
