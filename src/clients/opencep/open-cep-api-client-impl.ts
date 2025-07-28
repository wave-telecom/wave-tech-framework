import { Logger } from '../../core/logger'
import type { OpenCepAPIClient } from './open-cep-api-client'
import type { OpenCepResponse } from './types'

export class OpenCepAPIClientImpl implements OpenCepAPIClient {
  constructor(private readonly apiURL: string) {}

  async getCep(cep: string): Promise<OpenCepResponse | undefined> {
    Logger.info(`Starting getCep [cep=${cep}]`)
    return fetch(`${this.apiURL}/v1/${cep}.json`)
      .then((response) => response.json())
      .catch((error) => {
        Logger.warn(error)
      })
  }
}
