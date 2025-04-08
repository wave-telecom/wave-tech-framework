import type { PrismaTransaction } from '../../database';

export type ApplicationName = 'WAVE_MVNO_APPLICATION' | 'WAVE_PROVISIONING_APPLICATION' | 'WAVE_TENANT_APPLICATION';

export interface WaveToken {
  token: string;
  application: ApplicationName;
  expiresAt: number;
}

export interface SaveTokenParams {
  application: ApplicationName;
  token: string;
  expiresAt: number;
}

export interface AuthenticatorRepository {
  get: (application: ApplicationName) => Promise<WaveToken | undefined>;
  save: (params: SaveTokenParams, tx?: PrismaTransaction) => Promise<void>;
}
