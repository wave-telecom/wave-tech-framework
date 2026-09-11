/**
 * `requireBrokerContext` was called on a request that never went through
 * `registerPermissionAuth`'s hook (or its returned `assertHasPermission`) —
 * a route wiring defect, not something a caller triggered. Maps to
 * `500 Internal Server Error`.
 */
export class BrokerContextNotResolvedError extends Error {
  constructor() {
    super('The broker scope was not resolved for this request');
    this.name = 'BrokerContextNotResolvedError';
  }
}
