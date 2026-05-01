import { Worker } from 'bullmq';
import { processAssistantBuildRun } from '@/lib/assistant-builder';
import { getRedis } from '@/lib/redis';

new Worker(
  'assistant_builder_queue',
  async (job) => {
    const buildRunId = String((job.data as { buildRunId?: string })?.buildRunId || '').trim();
    if (!buildRunId) {
      throw new Error('buildRunId_required');
    }

    await processAssistantBuildRun(buildRunId);
  },
  { connection: getRedis() }
);
