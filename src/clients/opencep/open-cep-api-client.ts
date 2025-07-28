import type { OpenCepResponse } from './types';

export interface OpenCepAPIClient {
    getCep: (cep: string) => Promise<OpenCepResponse | undefined>;
}
