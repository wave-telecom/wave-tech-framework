export function isTokenExpired(token?: string) {
  if (!token) return true;
  const base64Url = token.split('.')[1];
  if (!base64Url) return true;

  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = decodeURIComponent(
      atob(base64)
          .split('')
          .map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
          })
          .join('')
  );

  const { exp } = JSON.parse(jsonPayload);
  const expired = Date.now() >= exp * 1000;
  return expired;
}

export function expirationTime(token?: string): Date {
  if (!token) return new Date(1);
  const base64Url = token.split('.')[1];
  if (!base64Url) return new Date(1);

  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = decodeURIComponent(
      atob(base64)
          .split('')
          .map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
          })
          .join('')
  );

  const { exp } = JSON.parse(jsonPayload);
  return new Date(exp * 1000);
}
