import type {
  DeliveryResult,
  EventSink } from './event-sink';
import {
  NonRetryableSinkError,
  RetryableSinkError,
} from './event-sink';
import type { RelayEvent } from './relay-event';

export interface HttpEventSinkOptions {
  /** Base URL of the events API, without a trailing path (e.g. "http://wave-events-api"). */
  baseUrl: string;
  /** Value of the api-key header the events API authenticates on. */
  apiKey: string;
  /** Path of the ingestion endpoint under the base URL. Default: "/events". */
  eventsPath?: string;
  /** Name of the header carrying the api key. Default: "x-api-key". */
  apiKeyHeader?: string;
  /**
   * Extra headers sent on every request (tenant routing, tracing, a gateway
   * key). The contract headers (content type and the api key) win on clash.
   */
  extraHeaders?: Record<string, string>;
  /** Per-request timeout. A timeout is retryable — replaying a batch is safe. */
  requestTimeoutMillis?: number;
}

const DEFAULT_EVENTS_PATH = '/events';
const DEFAULT_API_KEY_HEADER = 'x-api-key';
const DEFAULT_REQUEST_TIMEOUT_MILLIS = 30_000;

/**
 * Delivers relay events to the wave-events-api ingestion endpoint
 * (`POST /events`, batch of 1..100, x-api-key auth). The response array comes
 * back in request order, so results are re-keyed to the origin outbox ids —
 * the ids in the response body are the events API's own and are discarded.
 */
export class HttpEventSink implements EventSink {
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly requestTimeoutMillis: number;

  constructor(options: HttpEventSinkOptions) {
    this.url = `${options.baseUrl}${options.eventsPath ?? DEFAULT_EVENTS_PATH}`;
    this.headers = {
      ...options.extraHeaders,
      'content-type': 'application/json',
      [options.apiKeyHeader ?? DEFAULT_API_KEY_HEADER]: options.apiKey,
    };
    this.requestTimeoutMillis =
      options.requestTimeoutMillis ?? DEFAULT_REQUEST_TIMEOUT_MILLIS;
  }

  async deliverBatch(events: RelayEvent[]): Promise<DeliveryResult[]> {
    return this.post(events);
  }

  async deliverOne(event: RelayEvent): Promise<DeliveryResult> {
    const [result] = await this.post([event]);
    return result;
  }

  private async post(events: RelayEvent[]): Promise<DeliveryResult[]> {
    let response: Response;
    try {
      response = await fetch(this.url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(events),
        signal: AbortSignal.timeout(this.requestTimeoutMillis),
      });
    } catch (error) {
      throw new RetryableSinkError(
        `Request to the events API failed: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }

    if (response.status === 200) {
      return this.parseResults(response, events);
    }

    const detail = await response.text().catch(() => '');

    if (response.status === 400) {
      throw new NonRetryableSinkError(
        'contract',
        `The events API rejected the request body (400): ${detail}`,
      );
    }

    if (response.status === 401) {
      throw new NonRetryableSinkError(
        'configuration',
        'The events API rejected the API key (401)',
      );
    }

    throw new RetryableSinkError(
      `The events API responded ${response.status}: ${detail}`,
    );
  }

  /**
   * A 200 only counts per event that the body confirms: an array with exactly
   * one result per sent event, each `accepted` or `duplicate`. Anything else
   * (proxy HTML, empty/short array, unknown status) is a retryable failure —
   * assuming success on a malformed body would mark undelivered events as
   * published, the silent-loss path this relay exists to close. Replaying is
   * safe: whatever did get stored comes back as `duplicate`.
   */
  private async parseResults(
    response: Response,
    events: RelayEvent[],
  ): Promise<DeliveryResult[]> {
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new RetryableSinkError(
        'The events API returned 200 with a body that is not JSON',
        error,
      );
    }

    if (!Array.isArray(body) || body.length !== events.length) {
      throw new RetryableSinkError(
        'The events API returned 200 with a malformed body: expected an array of ' +
        `${events.length} results, got ${Array.isArray(body) ? `${body.length} items` : typeof body}`,
      );
    }

    return events.map((event, index) => {
      const status = (body as Array<{ status?: unknown }>)[index]?.status;
      if (status !== 'accepted' && status !== 'duplicate') {
        throw new RetryableSinkError(
          `The events API returned 200 with an unknown status ${JSON.stringify(status)} at index ${index}`,
        );
      }
      return { id: event.id, status };
    });
  }
}
