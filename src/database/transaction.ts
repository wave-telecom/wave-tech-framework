import type { PrismaClient } from '@prisma/client';

type PrismaTransaction = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;
type TransactionCallback<T> = (tx: PrismaTransaction) => Promise<T | T[]>;

export interface DatabaseTransactionManager {
  execute: <T>(action: TransactionCallback<T>, timeout?: number) => Promise<T | T[]>;
}

interface Config {
  timeout?: number;
  isolationLevel?: 'Serializable' | 'ReadCommitted' | 'ReadUncommitted' | 'RepeatableRead';
}

export class PrismaTransactionManagerImpl implements DatabaseTransactionManager {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: Config = {
      timeout: 30000,
      isolationLevel: 'ReadCommitted',
    }
  ) { }

  async execute<T>(action: TransactionCallback<T>): Promise<T | T[]> {
    const result = await this.prisma.$transaction(action, this.config);
    return result;
  }
}
