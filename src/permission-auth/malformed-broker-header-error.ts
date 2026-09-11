/**
 * The `x-broker-id` header (or whatever `brokerIdHeader` is configured to)
 * is malformed: empty, longer than the configured maximum, or sent more than
 * once. Detected before any call to the validator. Maps to `400 Bad Request`.
 */
export class MalformedBrokerHeaderError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'MalformedBrokerHeaderError';
  }
}
