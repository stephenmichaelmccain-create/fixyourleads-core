import './process_new_lead';
import './handle_incoming_message';
import './booking';
import { startWorkerHeartbeat } from '@/lib/worker-heartbeat';

console.log('FixYourLeads workers online');
startWorkerHeartbeat();
