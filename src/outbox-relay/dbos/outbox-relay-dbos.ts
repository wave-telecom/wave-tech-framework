import { DBOS, WorkflowQueue } from '@dbos-inc/dbos-sdk';
import { Logger } from '../../core/logger';
import type { OutboxRelayService } from '../outbox-relay-service';
import type { OutboxPurgeSource } from '../outbox-relay-source';
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
  /**
   * Retention job for DELIVERED rows. Absent = nothing is ever deleted
   * (today's behavior). Pending and parked rows are never touched — see
   * {@link OutboxPurgeSource}. Configure it on ONE relay instance only when a
   * process registers several: the purge is sink-agnostic by design.
   */
  purge?: {
    /** Same caveat as the drain schedule: needs CPU outside requests. */
    enabled: boolean;
    /** Daily cadence is the intent, e.g. '0 4 * * *'. */
    cron: string;
    /** The store to purge — typically the same PrismaOutboxRelaySource. */
    source: OutboxPurgeSource;
    /** Rows older than this instant are eligible. Re-evaluated per run. */
    olderThan: () => Date;
    /** Rows deleted per step; keeps each DELETE short-lived. */
    batchSize: number;
    /** Caps one run; the leftovers wait for the next tick. */
    maxBatchesPerRun: number;
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

export interface PurgeSummary {
  deleted: number;
  batches: number;
  /** True when the last batch came back short — nothing eligible remains. */
  drained: boolean;
}

export interface OutboxRelayHandle {
  /** Enqueues a drain (or joins the one in flight) and waits for its result. */
  startDrainNow: () => Promise<DrainSummary>;
  /**
   * Enqueues a purge run (or joins the one in flight) and waits for it.
   * Rejects when the relay was registered without `purge`.
   */
  startPurgeNow: () => Promise<PurgeSummary>;
  /**
   * Creates, updates or deletes the internal schedules (drain AND purge) to
   * match configuration. Schedules persist in the system database, so flipping
   * a flag off must actively delete what a previous deploy created. Call after
   * DBOS.launch().
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
  const purgeDeduplicationId = `outbox-relay-purge${suffix}`;
  const purgeScheduleName = `outbox-purge-tick${suffix}`;
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

  // Retention. Sharing the drain's queue is deliberate: globalConcurrency 1
  // means a purge never runs concurrently with this sink's drain — a bulk
  // DELETE competing with the claim is exactly the interference to avoid.
  const purge = options.purge;
  const purgeOutboxEvents = DBOS.registerWorkflow(
    async (): Promise<PurgeSummary> => {
      const summary: PurgeSummary = { deleted: 0, batches: 0, drained: false };
      if (!purge) return summary;

      for (let batch = 0; batch < purge.maxBatchesPerRun; batch++) {
        // Idempotent by construction: a retried or replayed step deletes
        // whatever eligible rows remain.
        const deleted = await DBOS.runStep(
          () => purge.source.purgeDeliveredBatch(purge.olderThan(), purge.batchSize),
          { name: 'purge-batch', retriesAllowed: true },
        );
        summary.deleted += deleted;
        summary.batches += 1;
        if (deleted < purge.batchSize) {
          summary.drained = true;
          break;
        }
      }

      Logger.info(`${logPrefix} Purge run finished`, { data: { summary } });
      return summary;
    },
    { name: `purgeOutboxEvents${suffix}` },
  );

  const enqueuePurge = async () => {
    return DBOS.startWorkflow(purgeOutboxEvents, {
      queueName: queue.name,
      enqueueOptions: { deduplicationID: purgeDeduplicationId },
      duplicationPolicy: 'return-existing',
    })();
  };

  const outboxPurgeTick = DBOS.registerWorkflow(
    async (): Promise<void> => {
      await enqueuePurge();
    },
    { name: `outboxPurgeTick${suffix}` },
  );

  // Takes none of the (scheduledAt, context) args a ScheduledWorkflowFn gets —
  // every tick does the same thing: join or start the single global drain.
  const outboxRelayTick = DBOS.registerWorkflow(
    async (): Promise<void> => {
      await enqueueDrain();
    },
    { name: `outboxRelayTick${suffix}` },
  );

  /** Applies or deletes one persisted schedule to match its `enabled` flag. */
  const reconcileOne = async (
    name: string,
    enabled: boolean,
    cron: string,
    workflowFn: () => Promise<void>,
    label: string,
  ): Promise<void> => {
    if (enabled) {
      await DBOS.applySchedules([{ scheduleName: name, workflowFn, schedule: cron }]);
      Logger.info(`${logPrefix} ${label} schedule active`, { data: { schedule: cron } });
      return;
    }

    const existing = await DBOS.getSchedule(name);
    if (existing) {
      await DBOS.deleteSchedule(name);
      Logger.info(`${logPrefix} ${label} schedule removed`);
    }
  };

  return {
    async startDrainNow(): Promise<DrainSummary> {
      const handle = await enqueueDrain();
      return handle.getResult();
    },

    async startPurgeNow(): Promise<PurgeSummary> {
      if (!purge) {
        throw new Error(`${logPrefix} This relay was registered without a purge configuration`);
      }
      const handle = await enqueuePurge();
      return handle.getResult();
    },

    async reconcileSchedule(): Promise<void> {
      await reconcileOne(
        scheduleName,
        options.schedule.enabled,
        options.schedule.cron,
        outboxRelayTick,
        'Internal drain',
      );
      await reconcileOne(
        purgeScheduleName,
        purge?.enabled ?? false,
        purge?.cron ?? '0 4 * * *',
        outboxPurgeTick,
        'Retention purge',
      );
    },
  };
}
