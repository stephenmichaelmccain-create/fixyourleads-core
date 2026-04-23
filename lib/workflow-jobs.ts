import { getWorkflowQueue } from '@/lib/queue';

type ScheduleWorkflowRunInput = {
  workflowRunId: string;
  nextRunAt: Date | null;
};

export async function scheduleWorkflowRun({ workflowRunId, nextRunAt }: ScheduleWorkflowRunInput) {
  if (!nextRunAt) {
    return null;
  }

  const delayMs = Math.max(0, nextRunAt.getTime() - Date.now());

  return getWorkflowQueue().add(
    'run_workflow_step',
    {
      workflowRunId,
      nextRunAt: nextRunAt.toISOString()
    },
    {
      delay: delayMs,
      jobId: `workflow_run:${workflowRunId}:${nextRunAt.getTime()}`,
      removeOnComplete: 500,
      removeOnFail: 500
    }
  );
}
