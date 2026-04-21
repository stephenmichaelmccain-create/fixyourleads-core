import { Worker } from 'bullmq';
import { getBookingQueue } from '@/lib/queue';
import { getRedis } from '@/lib/redis';
import { db } from '@/lib/db';

new Worker('message_queue', async (job) => {
  const { companyId, contactId, text } = job.data;
  const normalized = String(text).toLowerCase();

  if (normalized.includes('yes') || normalized.includes('book')) {
    await getBookingQueue().add('booking_worker', { companyId, contactId });
    await db.eventLog.create({ data: { companyId, eventType: 'booking_intent_detected', payload: { contactId, text } } });
  }
}, { connection: getRedis() });
