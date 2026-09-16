import { describe, it, expect } from 'vitest';
import { compileRoutes, matchRoute } from './route-matcher';
import type { RouteProperties } from '../route-properties';

const route = (permissionName: string): RouteProperties => ({ permissionName });

describe('route-matcher', () => {
  it('matches an unambiguous request to its one obviously-right pattern', () => {
    const compiled = compileRoutes({
      'GET /accounts/:accountId': route('usage.account.get'),
      'GET /accounts/:accountId/balances': route('usage.balance.get'),
    });

    expect(matchRoute(compiled, 'GET', '/accounts/123')?.permissionName).toBe('usage.account.get');
    expect(matchRoute(compiled, 'GET', '/accounts/123/balances')?.permissionName).toBe(
      'usage.balance.get',
    );
  });

  it('never matches across methods or unmapped paths', () => {
    const compiled = compileRoutes({ 'GET /accounts/:accountId': route('usage.account.get') });

    expect(matchRoute(compiled, 'POST', '/accounts/123')).toBeUndefined();
    expect(matchRoute(compiled, 'GET', '/nowhere')).toBeUndefined();
  });

  it('never matches two different segment counts against each other', () => {
    const compiled = compileRoutes({
      'GET /accounts/:accountId': route('usage.account.get'),
      'GET /accounts/:accountId/balances': route('usage.balance.get'),
    });

    // `/accounts/123` has 2 segments and must only ever match the 2-segment
    // pattern, never the 3-segment one, and vice versa.
    expect(matchRoute(compiled, 'GET', '/accounts/123')?.permissionName).toBe('usage.account.get');
  });

  it(
    'resolves a genuine overlap by map order — the exact shape found live in ' +
      'wave-usage-api’s bff module (/accounts/by-external-code/:externalCode vs ' +
      '/accounts/:accountId/balances, both matching /accounts/by-external-code/balances)',
    () => {
      const byExternalCodeFirst = compileRoutes({
        'GET /accounts/by-external-code/:externalCode': route('usage.account.get-by-external-code'),
        'GET /accounts/:accountId/balances': route('usage.balance.get'),
      });
      expect(
        matchRoute(byExternalCodeFirst, 'GET', '/accounts/by-external-code/balances')?.permissionName,
      ).toBe('usage.account.get-by-external-code');

      const balancesFirst = compileRoutes({
        'GET /accounts/:accountId/balances': route('usage.balance.get'),
        'GET /accounts/by-external-code/:externalCode': route('usage.account.get-by-external-code'),
      });
      expect(
        matchRoute(balancesFirst, 'GET', '/accounts/by-external-code/balances')?.permissionName,
      ).toBe('usage.balance.get');
    },
  );

  it('rejects optional segments, wildcards and regex-constrained params at compile time', () => {
    expect(() => compileRoutes({ 'GET /accounts/:id?': route('x') })).toThrow();
    expect(() => compileRoutes({ 'GET /accounts/*': route('x') })).toThrow();
    expect(() => compileRoutes({ 'GET /accounts/:id(\\d+)': route('x') })).toThrow();
  });

  it('rejects a route key with no space between method and path', () => {
    expect(() => compileRoutes({ 'GET/accounts': route('x') })).toThrow();
  });
});
