import type { WaveRequest } from './shared/wave-request';

/**
 * Declares what a single route (or a standalone `assertHasPermission` check)
 * requires: which permission wave-auth-api must grant, and whether the
 * resolved broker scope must collapse to exactly one broker.
 */
export interface RouteProperties {
  /** Opaque `resource.action` name — wave-auth-api compares it by exact equality, no hierarchy. */
  permissionName: string;
  /**
   * Requires the resolved scope to collapse to exactly one broker; a scope
   * with more than one broker answers `400`, asking the caller to select one
   * via the broker id header. Defaults to `true` — the safer default, since
   * a route that never considered multi-broker scope should not silently
   * accept it.
   */
  singleBroker?: boolean;
  /**
   * Same requirement as `singleBroker`, decided per request instead of
   * statically (e.g. only when a query parameter selects a broker-scoped
   * ordering). Takes precedence over `singleBroker` when present.
   *
   * Shared between the Fastify and Express integrations, so `request` is
   * the minimal `WaveRequest` shape both satisfy — only `headers` and
   * `query` are available here, never a framework-specific field like
   * Fastify's `routeOptions`/`server` or Express's `params` (unpopulated on
   * Express at the point this runs, so it would silently mean different
   * things per framework).
   */
  singleBrokerWhen?: (request: WaveRequest) => boolean;
  /**
   * Lets this route accept `Authorization: Bearer <sessionToken>` as an
   * alternative to `x-api-key`. wave-auth-api's session token deliberately
   * carries no permission grant (only `sub` and `brokers`) — a token must
   * not carry an authorization decision that revoking the underlying key
   * can't take back — so a route that opts in is *not* permission-checked
   * when authenticated this way: the opt-in itself is the authorization
   * decision, trusting only the token's broker scope. Defaults to `false`.
   */
  acceptsSessionToken?: boolean;
  /**
   * Set to `false` for a route that isn't scoped to any particular
   * broker at all — e.g. a tenant-wide operation, authorized for the
   * credential's whole tenant rather than a subset of its brokers. Skips
   * broker scope resolution entirely: `x-broker-id` is not read, an empty
   * broker scope on the verdict/token is not treated as a denial, and
   * `request.brokerContext` is left unset — a handler for a route like
   * this must not call `requireBrokerContext`. Defaults to `true`.
   */
  brokerScoped?: boolean;
}
