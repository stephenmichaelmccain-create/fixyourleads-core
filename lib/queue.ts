import { Queue } from 'bullmq';
import { getRedis } from './redis';

let leadQueueInstance: Queue | null = null;
let messageQueueInstance: Queue | null = null;
let bookingQueueInstance: Queue | null = null;
let workflowQueueInstance: Queue | null = null;
let crmSyncQueueInstance: Queue | null = null;
let calendarSyncQueueInstance: Queue | null = null;

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

export function getWorkflowQueue() {
  if (!workflowQueueInstance) {
    workflowQueueInstance = new Queue('workflow_queue', { connection: getRedis() });
  }
  return workflowQueueInstance;
}

export function getCrmSyncQueue() {
  if (!crmSyncQueueInstance) {
    crmSyncQueueInstance = new Queue('crm_sync_queue', { connection: getRedis() });
  }
  return crmSyncQueueInstance;
}

export function getCalendarSyncQueue() {
  if (!calendarSyncQueueInstance) {
    calendarSyncQueueInstance = new Queue('calendar_sync_queue', { connection: getRedis() });
  }
  return calendarSyncQueueInstance;
}
