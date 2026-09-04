import { DBOS } from '@dbos-inc/dbos-sdk';
import { Logger } from '../core/logger';

export interface ScheduledJobOptions {
  /**
   * Names the workflow and the schedule in the system database. Must stay
   * stable across deploys: renaming it registers a second schedule and leaves
   * the first one running.
   */
  name: string;
  schedule: {
    /** Requires always-allocated CPU (or Kubernetes) — see reconcileSchedule. */
    enabled: boolean;
    /** 5- or 6-field crontab; 6 fields give second granularity. */
    cron: string;
    /** Timezone the crontab is read in. Defaults to UTC. */
    timezone?: string;
  };
  /**
   * The work itself, given the instant it was scheduled for. Must be
   * idempotent: an interrupted run is resumed, and a tick can reach more than
   * one replica.
   *
   * Prefer the scheduled instant over `new Date()` for anything the work
   * compares against — a resumed run then computes the same window it started
   * with.
   */
  run: (scheduledAt: Date) => Promise<void>;
}

export interface ScheduledJobHandle {
  /**
   * Creates, updates or deletes the schedule to match configuration. Schedules
   * persist in the system database, so flipping the flag off must actively
   * delete what a previous deploy created. Call after `launchDbos`.
   */
  reconcileSchedule: () => Promise<void>;
}

/**
 * Registers a durable workflow and drives its schedule from configuration. The
 * schedule lives in the DBOS system database, which is what makes the work
 * survive a restart: a run interrupted mid-flight resumes from its last
 * checkpointed step when a process of the same application version launches.
 *
 * Call before `launchDbos` — DBOS resolves its registry at launch.
 *
 * There is deliberately no "run now" here: `DBOS.triggerSchedule(name)` already
 * fires one off-schedule run, so a caller that needs a manual lever has one
 * without this module exposing a second path into the same work.
 */
export function registerScheduledJob(options: ScheduledJobOptions): ScheduledJobHandle {
  const { name, schedule, run } = options;

  const workflow = DBOS.registerWorkflow(
    async (scheduledAt: Date): Promise<void> => {
      await run(scheduledAt);
    },
    { name },
  );

  return {
    async reconcileSchedule(): Promise<void> {
      if (schedule.enabled) {
        await DBOS.applySchedules([
          {
            scheduleName: name,
            workflowFn: workflow,
            schedule: schedule.cron,
            // Off on purpose: a sweep that missed hours does the same work in
            // one run, so backfilling would queue N identical runs.
            automaticBackfill: false,
            ...(schedule.timezone !== undefined ? { cronTimezone: schedule.timezone } : {}),
          },
        ]);
        Logger.info(`[ScheduledJob] ${name} schedule active`, {
          data: { schedule: schedule.cron },
        });
        return;
      }

      const existing = await DBOS.getSchedule(name);
      if (existing) {
        await DBOS.deleteSchedule(name);
        Logger.info(`[ScheduledJob] ${name} schedule removed`);
      }
    },
  };
}
