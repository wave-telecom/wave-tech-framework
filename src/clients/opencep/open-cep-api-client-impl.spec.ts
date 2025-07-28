import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenCepAPIClientImpl } from './open-cep-api-client-impl'
import { Logger } from '../../core/logger'

const mockedInfoLogger = vi.fn()
const mockedWarnLogger = vi.fn()

describe('client open-cep', () => {
  beforeEach(() => {
    vi.spyOn(Logger, 'info').mockImplementation(mockedInfoLogger)
    vi.spyOn(Logger, 'warn').mockImplementation(mockedWarnLogger)
  })

  it('should call the correct open-cep url', async () => {
    const mockedFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            cep: '12345678',
            logradouro: '',
            complemento: '',
            bairro: '',
            localidade: '',
            uf: '',
            ibge: '',
          }),
      })
    )

    vi.stubGlobal('fetch', mockedFetch)

    const client = new OpenCepAPIClientImpl('https://opencep.com')

    const result = await client.getCep('12345678')

    expect(mockedFetch).toBeCalledWith('https://opencep.com/v1/12345678.json')
    expect(result?.cep).toBe('12345678')
    expect(mockedInfoLogger).toBeCalledWith('Starting getCep [cep=12345678]')
  })

  it('should logs a warn when an error occurs when calling the open-cep api', async () => {
    const mockedFetch = vi.fn(() =>
      Promise.reject({ message: 'Network Error' })
    )

    vi.stubGlobal('fetch', mockedFetch)

    const client = new OpenCepAPIClientImpl('https://opencep.com')
    await client.getCep('12345678')
    expect(mockedWarnLogger).toBeCalledWith({ message: 'Network Error' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })
})
