import { z } from 'zod';
import { PermissionValidatorUnauthorizedError } from '../errors/permission-validator-unauthorized-error';
import { PermissionValidatorUnavailableError } from '../errors/permission-validator-unavailable-error';
import type {
  PermissionValidationRequest,
  PermissionValidationResult,
  PermissionValidator,
} from './permission-validator';
import { correlationHeaders } from '../shared/correlation-headers';

/** Not version-prefixed: this is the path wave-auth-api itself publishes. */
const VALIDATE_PATH = '/auth/permissions/validate';

const validateResponseSchema = z.object({
  authorized: z.boolean(),
  brokers: z.array(z.string()),
});

/**
 * Client for `POST {baseUrl}/auth/permissions/validate`. Forwards the
 * caller's own `x-api-key`, propagates `x-correlation-id`, and translates a
 * downstream failure into `PermissionValidatorUnavailableError`.
 */
export class WaveAuthPermissionValidator implements PermissionValidator {
  private readonly validateUrl: string;

  constructor(
    baseUrl: string,
    private readonly timeoutMs: number,
  ) {
    this.validateUrl = `${baseUrl.replace(/\/+$/, '')}${VALIDATE_PATH}`;
  }

  async validate(request: PermissionValidationRequest): Promise<PermissionValidationResult> {
    const response = await this.post(request);

    if (response.status === 401) {
      throw new PermissionValidatorUnauthorizedError();
    }

    // Only `401` is a verdict about the credential itself. Any other non-2xx
    // — `5xx`, a contract `400`, `429` — is the absence of a verdict, and the
    // caller must fail closed instead of treating it as a denial.
    if (!response.ok) {
      throw new PermissionValidatorUnavailableError(
        `${this.validateUrl} responded ${response.status}`,
      );
    }

    const parsed = validateResponseSchema.safeParse(await readJsonBody(response));
    if (!parsed.success) {
      throw new PermissionValidatorUnavailableError(
        'the validate response body does not carry authorized and brokers',
      );
    }

    // The verdict is the body's `authorized`, never the HTTP status: a
    // denial also arrives as `200`, so reading the status as the permission
    // would authorize every denial.
    return { authorized: parsed.data.authorized, brokers: parsed.data.brokers };
  }

  private async post(request: PermissionValidationRequest): Promise<Response> {
    try {
      return await fetch(this.validateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': request.apiKey,
          ...correlationHeaders(),
        },
        body: JSON.stringify(requestBody(request)),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new PermissionValidatorUnavailableError(
        `${this.validateUrl} — ${describeFailure(cause)}`,
      );
    }
  }
}

/**
 * Identity goes in the `x-api-key` header, never the body. `brokers` is
 * omitted rather than sent as `undefined` when absent: the downstream schema
 * rejects an empty array, and omitting the key is what tells it "no scope
 * requested" instead of "an invalid scope was requested".
 */
const requestBody = (
  { permission, brokers }: PermissionValidationRequest,
): Record<string, unknown> => (brokers === undefined ? { permission } : { permission, brokers });

const readJsonBody = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch (cause) {
    throw new PermissionValidatorUnavailableError(
      `the validate response body is not JSON (${describeFailure(cause)})`,
    );
  }
};

const describeFailure = (cause: unknown): string =>
  cause instanceof Error ? `${cause.name}: ${cause.message}` : 'unknown transport failure';
