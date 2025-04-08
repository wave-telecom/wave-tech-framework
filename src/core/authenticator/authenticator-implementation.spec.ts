import type { DatabaseTransactionManager, PrismaTransaction } from 'src/database';
import { WaveAuthenticatorImpl } from './authenticator-implementation';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { ApplicationName, AuthenticatorRepository } from './authenticator-repository';
import { describe, vi, it, expect, beforeEach } from 'vitest';

const mockJson = vi.fn();
const mockStatus = vi.fn();
const mockText = vi.fn();
const mockHeaders = vi.fn();
global.fetch = vi.fn(() => Promise.resolve({
  status: mockStatus(),
  headers: {
    get: mockHeaders,
  },
  json: () => Promise.resolve(mockJson()),
  text: () => Promise.resolve(mockText()),
}) as unknown as Promise<Response>);

interface MakeSut {
  transactionManager: DeepMockProxy<DatabaseTransactionManager>;
  tokenRepository: DeepMockProxy<AuthenticatorRepository>;
  sut: WaveAuthenticatorImpl;
}

const makeSut = (): MakeSut => {
  const transactionManager = mockDeep<DatabaseTransactionManager>();
  const tokenRepository = mockDeep<AuthenticatorRepository>();
  const sut = new WaveAuthenticatorImpl(
    transactionManager,
    tokenRepository,
    {
      authUrl: 'https://auth.wave.com',
      audience: 'https://api.wave.com',
      clientId: 'clientId',
      clientSecret: 'clientSecret',
    },
    {
      tokenExpiryInSeconds: 3600,
    },
  );

  return { transactionManager, tokenRepository, sut };
};

describe('wave authentication impl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authenticate', () => {
    it('should return cached token if not expired', async () => {
      const { sut, tokenRepository } = makeSut();
      const futureTimestamp = Date.now() + 1000000;
      const mockToken = { token: 'cached-token', expiresAt: futureTimestamp, application: 'WAVE_MVNO_APPLICATION' as ApplicationName };

      tokenRepository.get.mockResolvedValueOnce(mockToken);
      mockStatus.mockReturnValueOnce(200);
      const result = await sut.authenticate('WAVE_MVNO_APPLICATION');

      expect(result).toBe(mockToken.token);
      expect(tokenRepository.get).toHaveBeenCalledWith('WAVE_MVNO_APPLICATION');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should fetch new token if cached token is expired', async () => {
      const { sut, tokenRepository, transactionManager } = makeSut();
      const pastTimestamp = Date.now() - 1000;
      const mockToken = { token: 'expired-token', expiresAt: pastTimestamp, application: 'WAVE_MVNO_APPLICATION' as ApplicationName };
      const newToken = { access_token: 'new-token', expires_in: 3600, application: 'WAVE_MVNO_APPLICATION' as ApplicationName };

      tokenRepository.get.mockResolvedValueOnce(mockToken);
      mockJson.mockReturnValueOnce(newToken);
      mockStatus.mockReturnValueOnce(200);
      transactionManager.execute.mockImplementationOnce(
        (callback) => callback({} as PrismaTransaction)
      );

      const result = await sut.authenticate('WAVE_MVNO_APPLICATION');

      expect(result).toBe(newToken.access_token);
      expect(tokenRepository.get).toHaveBeenCalledWith('WAVE_MVNO_APPLICATION');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://auth.wave.com/oauth/token',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic Y2xpZW50SWQ6Y2xpZW50U2VjcmV0',
          },
        })
      );
      expect(tokenRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          application: 'WAVE_MVNO_APPLICATION',
          token: newToken.access_token,
        }),
        expect.anything()
      );
    });

    it('should handle non-JSON error responses with status 401', async () => {
      const { sut, tokenRepository, transactionManager } = makeSut();

      tokenRepository.get.mockResolvedValueOnce(undefined);
      mockStatus.mockReturnValueOnce(401);
      mockText.mockReturnValueOnce('Unauthorized');
      mockHeaders.mockReturnValueOnce('text/plain');
      transactionManager.execute.mockImplementationOnce(
        (callback) => callback({} as PrismaTransaction)
      );

      await expect(sut.authenticate('WAVE_MVNO_APPLICATION')).rejects.toThrow('Unauthorized');
    });

    it('should handle JSON error responses with status 400', async () => {
      const { sut, tokenRepository, transactionManager } = makeSut();

      tokenRepository.get.mockResolvedValueOnce(undefined);
      mockStatus.mockReturnValueOnce(400);
      mockJson.mockReturnValueOnce({ error: 'invalid_request' });
      mockHeaders.mockReturnValueOnce('application/json');
      transactionManager.execute.mockImplementationOnce(
        (callback) => callback({} as PrismaTransaction)
      );

      await expect(sut.authenticate('WAVE_MVNO_APPLICATION')).rejects.toThrow('{"error":"invalid_request"}');
    });

    it('should use default expiry when token response has no expiresIn', async () => {
      const { sut, tokenRepository, transactionManager } = makeSut();
      const pastTimestamp = Date.now() - 1000;
      const mockToken = { token: 'expired-token', expiresAt: pastTimestamp, application: 'WAVE_MVNO_APPLICATION' as ApplicationName };
      const newToken = { access_token: 'new-token', expires_in: 3600, application: 'WAVE_MVNO_APPLICATION' as ApplicationName }; // No expiresIn

      tokenRepository.get.mockResolvedValueOnce(mockToken);
      mockJson.mockReturnValueOnce(newToken);
      mockStatus.mockReturnValueOnce(200);
      transactionManager.execute.mockImplementationOnce(
        (callback) => callback({} as PrismaTransaction)
      );

      await sut.authenticate('WAVE_MVNO_APPLICATION');

      expect(tokenRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          application: 'WAVE_MVNO_APPLICATION',
          token: newToken.access_token,
          expiresAt: expect.any(Number),
        }),
        expect.anything()
      );
    });
  });
});
