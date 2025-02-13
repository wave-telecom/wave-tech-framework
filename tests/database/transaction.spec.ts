/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import { PrismaTransactionManagerImpl } from '../../src/database/transaction';

describe('prisma transaction manager', () => {
  const prismaClient = mockDeep<PrismaClient>();
  const sut = new PrismaTransactionManagerImpl(prismaClient);

  it('should call transaction with default values if no values are provided', async () => {
    prismaClient.$transaction.mockImplementationOnce(async (action: any) => {
      return Promise.resolve(action(prismaClient));
    });

    await sut.execute(async (prismaClient: PrismaClient) => {
      return Promise.resolve(prismaClient.user.findMany());
    });

    expect(prismaClient.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 30000,
      isolationLevel: 'ReadCommitted',
    });
  });

  it('should execute a transaction', async () => {
    prismaClient.$transaction.mockImplementationOnce(async (action: any) => {
      return Promise.resolve(action(prismaClient));
    });

    prismaClient.user.findMany.mockResolvedValue([]);

    const result = await sut.execute(async (prismaClient: PrismaClient) => {
      return Promise.resolve(prismaClient.user.findMany());
    });

    expect(prismaClient.user.findMany).toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
