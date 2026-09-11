/**
 * The API key is valid and recognised by wave-auth-api, but the request is
 * still refused: the matched route has no permission mapped to it (deny by
 * default), the key doesn't hold the required permission, or the resolved
 * broker scope came back empty. Maps to `403 Forbidden`.
 */
export class PermissionDeniedError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'PermissionDeniedError';
  }
}
