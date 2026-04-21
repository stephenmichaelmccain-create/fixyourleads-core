import { Queue } from 'bullmq';
import { getRedis } from './redis';

let leadQueueInstance: Queue | null = null;
let messageQueueInstance: Queue | null = null;
let bookingQueueInstance: Queue | null = null;

export function getLeadQueue() {
  if (!leadQueueInstance) {
    leadQueueInstance = new Queue('lead_queue', { connection: getRedis() });
  }
  return leadQueueInstance;
}

export function getMessageQueue() {
  if (!messageQueueInstance) {
    messageQueueInstance = new Queue('message_queue', { connection: getRedis() });
  }
  return messageQueueInstance;
}

export function getBookingQueue() {
  if (!bookingQueueInstance) {
    bookingQueueInstance = new Queue('booking_queue', { connection: getRedis() });
  }
  return bookingQueueInstance;
}
