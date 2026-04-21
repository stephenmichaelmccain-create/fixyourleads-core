import { Worker } from 'bullmq';
import { bookingQueue } from '@/lib/queue';
import { redis } from '@/lib/redis';
import { db } from '@/lib/db';

new Worker('message_queue', async (job) => {
  const { companyId, contactId, text } = job.data;
  const normalized = String(text).toLowerCase();

  if (normalized.includes('yes') || normalized.includes('book')) {
    await bookingQueue.add('booking_worker', { companyId, contactId });
    await db.eventLog.create({ data: { companyId, eventType: 'booking_intent_detected', payload: { contactId, text } } });
  }
}, { connection: redis });
