/**
 * The key's resolved scope covers more than one broker, but the matched
 * route requires exactly one (the default for every route, unless declared
 * otherwise — see `RouteProperties.singleBroker`/`singleBrokerWhen`). The
 * caller must resend the request with a `x-broker-id` header selecting one.
 * Maps to `400 Bad Request` — this is a shape problem with the request, not
 * an authorization failure.
 */
export class AmbiguousBrokerTargetError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'AmbiguousBrokerTargetError';
  }
}
