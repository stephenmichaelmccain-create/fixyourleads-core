import { Queue } from 'bullmq';
import { redis } from './redis';

export const leadQueue = new Queue('lead_queue', { connection: redis });
export const messageQueue = new Queue('message_queue', { connection: redis });
export const bookingQueue = new Queue('booking_queue', { connection: redis });
