import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { registerScheduledJob } from './scheduled-job';

vi.mock('@dbos-inc/dbos-sdk', () => ({
  DBOS: {
    registerWorkflow: vi.fn((fn: unknown) => fn),
    applySchedules: vi.fn(() => Promise.resolve()),
    getSchedule: vi.fn(() => Promise.resolve(null)),
    deleteSchedule: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../core/logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const dbos = vi.mocked(DBOS);

const options = (overrides: Partial<Parameters<typeof registerScheduledJob>[0]> = {}) => ({
  name: 'sweepThings',
  schedule: { enabled: true, cron: '0 * * * *' },
  run: vi.fn(() => Promise.resolve()),
  ...overrides,
});

describe('registerScheduledJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbos.getSchedule.mockResolvedValue(null);
  });

  it('S1: registra o workflow na chamada, antes de qualquer reconciliação', () => {
    registerScheduledJob(options());

    expect(dbos.registerWorkflow).toHaveBeenCalledTimes(1);
    expect(dbos.registerWorkflow).toHaveBeenCalledWith(expect.any(Function), {
      name: 'sweepThings',
    });
    expect(dbos.applySchedules).not.toHaveBeenCalled();
  });

  it('S2: o workflow registrado passa o instante agendado ao trabalho', async () => {
    const run = vi.fn(() => Promise.resolve());
    registerScheduledJob(options({ run }));

    const [registered] = dbos.registerWorkflow.mock.calls[0] as [
      (scheduledAt: Date) => Promise<void>,
    ];
    const scheduledAt = new Date('2026-03-01T10:00:00.000Z');
    await registered(scheduledAt);

    expect(run).toHaveBeenCalledWith(scheduledAt);
  });

  it('S3: habilitado, aplica o agendamento com o cron e sem backfill', async () => {
    const job = registerScheduledJob(options());

    await job.reconcileSchedule();

    expect(dbos.applySchedules).toHaveBeenCalledWith([
      expect.objectContaining({
        scheduleName: 'sweepThings',
        schedule: '0 * * * *',
        automaticBackfill: false,
      }),
    ]);
    expect(dbos.deleteSchedule).not.toHaveBeenCalled();
  });

  it('S4: o fuso só vai quando configurado', async () => {
    await registerScheduledJob(
      options({ schedule: { enabled: true, cron: '0 * * * *', timezone: 'America/Sao_Paulo' } }),
    ).reconcileSchedule();
    const [[withZone]] = dbos.applySchedules.mock.calls[0] as [Record<string, unknown>[]];
    expect(withZone).toMatchObject({ cronTimezone: 'America/Sao_Paulo' });

    vi.clearAllMocks();

    await registerScheduledJob(options()).reconcileSchedule();
    const [[withoutZone]] = dbos.applySchedules.mock.calls[0] as [Record<string, unknown>[]];
    expect(withoutZone).not.toHaveProperty('cronTimezone');
  });

  it('S5: desabilitado, apaga o agendamento que um deploy anterior deixou', async () => {
    dbos.getSchedule.mockResolvedValue({ scheduleName: 'sweepThings' } as never);
    const job = registerScheduledJob(options({ schedule: { enabled: false, cron: '0 * * * *' } }));

    await job.reconcileSchedule();

    expect(dbos.deleteSchedule).toHaveBeenCalledWith('sweepThings');
    expect(dbos.applySchedules).not.toHaveBeenCalled();
  });

  it('S6: desabilitado e sem nada persistido, não apaga nada', async () => {
    const job = registerScheduledJob(options({ schedule: { enabled: false, cron: '0 * * * *' } }));

    await job.reconcileSchedule();

    expect(dbos.deleteSchedule).not.toHaveBeenCalled();
  });
});
