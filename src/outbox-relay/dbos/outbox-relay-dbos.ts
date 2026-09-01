import { DBOS, WorkflowQueue } from '@dbos-inc/dbos-sdk';
import { Logger } from '../../core/logger';
import type { OutboxRelayService } from '../outbox-relay-service';
import { NonRetryableSinkError } from '../event-sink';

/** Retry tuning of one durable step. Absent fields keep the built-in default. */
export interface RelayStepRetryOptions {
  maxAttempts?: number;
  intervalSeconds?: number;
  backoffRate?: number;
}

export interface OutboxRelayDbosOptions {
  service: OutboxRelayService;
  /**
   * Distinguishes this relay's queue, workflows, deduplication id and schedule
   * in the DBOS system database. Required when one process registers more than
   * one relay; when omitted, the bare legacy names are used, so a module that
   * migrated from its own in-tree relay keeps its persisted schedule and
   * queue continuity.
   */
  name?: string;
  /** Drain at most this many batches per run; a queued tick picks up the rest. */
  maxBatchesPerRun: number;
  /**
   * Per-step retry tuning. Defaults: claim 3 attempts; deliver 8 attempts
   * with 1s interval doubling each time; settle 5 attempts.
   */
  stepRetries?: {
    claim?: RelayStepRetryOptions;
    deliver?: RelayStepRetryOptions;
    settle?: RelayStepRetryOptions;
  };
  schedule: {
    /** Requires always-allocated CPU (or Kubernetes) — see reconcileSchedule. */
    enabled: boolean;
    /** 5- or 6-field crontab; 6 fields give second granularity. */
    cron: string;
  };
}

export interface DrainSummary {
  delivered: number;
  parked: number;
  batches: number;
  /** True when the last claim came back empty — the outbox is fully drained. */
  drained: boolean;
  /** Set when the run stopped early (sink outage past retries, or a 401). */
  aborted?: string;
}

export interface OutboxRelayHandle {
  /** Enqueues a drain (or joins the one in flight) and waits for its result. */
  startDrainNow: () => Promise<DrainSummary>;
  /**
   * Creates, updates or deletes the internal schedule to match configuration.
   * Schedules persist in the system database, so flipping the flag off must
   * actively delete what a previous deploy created. Call after DBOS.launch().
   */
  reconcileSchedule: () => Promise<void>;
}

/**
 * Wires the relay into DBOS. The mechanism is trigger-agnostic: the internal
 * schedule and whatever external trigger the module exposes (an HTTP job
 * endpoint, typically) both funnel into the same queue with the same
 * deduplication id, so at most one drain runs across every replica
 * (globalConcurrency: 1) and at most one more waits behind it.
 *
 * Call before DBOS.launch() — DBOS resolves its registry at launch.
 */
export function registerOutboxRelay(options: OutboxRelayDbosOptions): OutboxRelayHandle {
  const suffix = options.name ? `:${options.name}` : '';
  const queueName = `outbox-relay-queue${suffix}`;
  const deduplicationId = `outbox-relay-drain${suffix}`;
  const scheduleName = `outbox-relay-tick${suffix}`;
  const logPrefix = options.name ? `[OutboxRelay:${options.name}]` : '[OutboxRelay]';

  const claimRetry = { maxAttempts: 3, ...options.stepRetries?.claim };
  const deliverRetry = {
    maxAttempts: 8,
    intervalSeconds: 1,
    backoffRate: 2,
    ...options.stepRetries?.deliver,
  };
  const settleRetry = { maxAttempts: 5, ...options.stepRetries?.settle };

  const queue = new WorkflowQueue(queueName, { globalConcurrency: 1 });

  const drainOutboxEvents = DBOS.registerWorkflow(
    async (): Promise<DrainSummary> => {
      const summary: DrainSummary = { delivered: 0, parked: 0, batches: 0, drained: false };

      for (let batch = 0; batch < options.maxBatchesPerRun; batch++) {
        const events = await DBOS.runStep(() => options.service.claimBatch(), {
          name: 'claim-batch',
          retriesAllowed: true,
          ...claimRetry,
        });

        if (events.length === 0) {
          summary.drained = true;
          break;
        }
        summary.batches += 1;

        // Pure and deterministic — safe to recompute on replay from the
        // checkpointed claim result.
        const plan = options.service.planDelivery(events);

        try {
          if (plan.oversized.length > 0) {
            await DBOS.runStep(
              () => options.service.settle({ deliveredIds: [], parked: plan.oversized }),
              { name: 'settle-oversized', retriesAllowed: true, ...settleRetry },
            );
            summary.parked += plan.oversized.length;
          }

          for (const chunk of plan.chunks) {
            const outcome = await DBOS.runStep(() => options.service.deliverChunk(chunk), {
              name: 'deliver-chunk',
              retriesAllowed: true,
              ...deliverRetry,
              // Contract 400s are isolated inside deliverChunk; what escapes as
              // non-retryable is a configuration failure — retrying cannot fix it.
              shouldRetry: (error) => !(error instanceof NonRetryableSinkError),
            });

            await DBOS.runStep(() => options.service.settle(outcome), {
              name: 'settle-chunk',
              retriesAllowed: true,
              ...settleRetry,
            });

            summary.delivered += outcome.deliveredIds.length;
            summary.parked += outcome.parked.length;
          }
        } catch (error) {
          // Sink outage past the retry budget, or a 401: stop the run with the
          // remaining events still pending. The next tick simply tries again —
          // an outage costs latency, never events.
          summary.aborted = error instanceof Error ? error.message : String(error);
          Logger.error(`${logPrefix} Drain aborted, events remain pending`, {
            data: { summary },
          }, error);
          return summary;
        }
      }

      return summary;
    },
    { name: `drainOutboxEvents${suffix}` },
  );

  const enqueueDrain = async () => {
    return DBOS.startWorkflow(drainOutboxEvents, {
      queueName: queue.name,
      enqueueOptions: { deduplicationID: deduplicationId },
      // A tick that lands while a drain is queued or running joins it instead
      // of stacking another behind it.
      duplicationPolicy: 'return-existing',
    })();
  };

  // Takes none of the (scheduledAt, context) args a ScheduledWorkflowFn gets —
  // every tick does the same thing: join or start the single global drain.
  const outboxRelayTick = DBOS.registerWorkflow(
    async (): Promise<void> => {
      await enqueueDrain();
    },
    { name: `outboxRelayTick${suffix}` },
  );

  return {
    async startDrainNow(): Promise<DrainSummary> {
      const handle = await enqueueDrain();
      return handle.getResult();
    },

    async reconcileSchedule(): Promise<void> {
      if (options.schedule.enabled) {
        await DBOS.applySchedules([
          {
            scheduleName,
            workflowFn: outboxRelayTick,
            schedule: options.schedule.cron,
          },
        ]);
        Logger.info(`${logPrefix} Internal schedule active`, {
          data: { schedule: options.schedule.cron },
        });
        return;
      }

      const existing = await DBOS.getSchedule(scheduleName);
      if (existing) {
        await DBOS.deleteSchedule(scheduleName);
        Logger.info(`${logPrefix} Internal schedule removed; external trigger only`);
      }
    },
  };
}
