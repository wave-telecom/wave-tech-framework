import type { WaveAuthenticator, WaveAuthenticatorConfig, WaveAuthenticatorParams, WaveAuthenticatorResult } from './authenticator-types';
import type { ApplicationName, AuthenticatorRepository } from './authenticator-repository';
import type { DatabaseTransactionManager } from 'src/database';
import { secondsToMillis } from 'src/utils';
import { Logger } from 'src/core';

export class WaveAuthenticatorImpl implements WaveAuthenticator<ApplicationName> {
  private applicationTokens: Record<ApplicationName, WaveAuthenticatorResult> = {
    'WAVE_MVNO_APPLICATION': { token: '', expiresIn: 0 },
    'WAVE_PROVISIONING_APPLICATION': { token: '', expiresIn: 0 },
    'WAVE_TENANT_APPLICATION': { token: '', expiresIn: 0 },
  };

  constructor(
    private readonly transactionManager: DatabaseTransactionManager,
    private readonly tokenRepository: AuthenticatorRepository,
    private readonly params: WaveAuthenticatorParams,
    private readonly config: WaveAuthenticatorConfig,
  ) { }

  private isTokenExpired(expiresIn: number): boolean {
    return Date.now() > expiresIn;
  }

  private async getToken(): Promise<WaveAuthenticatorResult> {
    try {
      const credentials = `${this.params.clientId}:${this.params.clientSecret}`;
      const encodedCredentials = Buffer.from(credentials).toString('base64');

      const response = await fetch(`${this.params.authUrl}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${encodedCredentials}`,
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          audience: this.params.audience,
        }),
      });

      if (response.status < 200 || response.status >= 400) {
        const contentType = response.headers.get('Content-Type');
        const errorMessage = contentType?.includes('json') ?
          JSON.stringify(await response.json()) :
          await response.text();
        throw new Error(errorMessage);
      }

      const data = await response.json();

      return {
        token: data.access_token,
        expiresIn: data.expires_in,
      };
    } catch (error) {
      Logger.error('[Authenticator Get Token] An error occurred when trying to authenticate to wave application', { clientId: this.params.clientId, audience: this.params.audience, authUrl: this.params.authUrl }, error);
      throw error;
    }
  }

  async authenticate(application: ApplicationName): Promise<string> {
    const { token, expiresIn } = this.applicationTokens[application];

    if (!token || this.isTokenExpired(expiresIn)) {
      const result = await this.tokenRepository.get(application) ?? { token: '', expiresAt: 0 };
      this.applicationTokens[application] = { token: result.token, expiresIn: result.expiresAt };
      Logger.info(`[Authenticator Get Token] Token refreshed for application ${application}`, { application });
    }

    const tokenExpiresAt = this.applicationTokens[application].expiresIn;
    if (!this.isTokenExpired(tokenExpiresAt)) {
      return this.applicationTokens[application].token;
    }

    await this.transactionManager.execute(async (tx) => {
      Logger.info(`[Authenticator Get Token] Refreshing token for application ${application}`, { application });

      const { token, expiresIn } = await this.getToken();

      const tokenExpiracy = !expiresIn ? this.config.tokenExpiryInSeconds : expiresIn;
      const expiresAt = Date.now() + secondsToMillis(tokenExpiracy);

      this.applicationTokens[application] = { token, expiresIn: expiresAt };
      await this.tokenRepository.save({ application, token, expiresAt }, tx);

      Logger.info(`[Authenticator Get Token] Token refreshed for application ${application}`, { application });
    });

    return this.applicationTokens[application].token;
  }
}
