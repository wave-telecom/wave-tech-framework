import type { NextFunction, Request, Response } from 'express';
import type { Context, Next } from 'hono';
import { setHookContext, setHookCorrelationId, setHookTenantId } from '../core/hooks';
import { Uuid } from '../core/uuid';

export const setContext = (req: Request, res: Response, next: NextFunction) => {
    setHookContext(() => { next(); });
};

export const setCorrelationId = (req: Request, res: Response, next: NextFunction) => {
    const correlationIdHeader = req.headers['x-correlation-id'] as string | undefined;
    const correlationIdAttribute = req.body
        ?.message?.attributes?.correlationId as string | undefined;
    let correlationId = correlationIdAttribute ?? correlationIdHeader;

    if (!correlationId) {
        correlationId = Uuid.random().value;
    }

    setHookCorrelationId(correlationId);
    next();
};

export const setTenantId = (defaultTenantId?: string) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const tenantId = req.headers['x-tenant-id'] as string | undefined ?? defaultTenantId;
        if (!tenantId) throw new Error('Tenant ID is required, but it is not present in the request headers');
        setHookTenantId(tenantId);
        next();
    };
};

export const setContextHono = async (ctx: Context, next: Next) => {
    await setHookContext(() => next());
};

export const setCorrelationIdHono = (ctx: Context, next: Next) => {
    const correlationIdHeader = ctx.req.header('x-correlation-id');
    let correlationId = correlationIdHeader;

    if (!correlationId) {
        correlationId = Uuid.random().value;
    }

    setHookCorrelationId(correlationId);
    return next();
};

export const setTenantIdHono = (defaultTenantId?: string) => {
    return async (ctx: Context, next: Next) => {
        const tenantId = ctx.req.header('x-tenant-id') ?? defaultTenantId;
        if (!tenantId) throw new Error('Tenant ID is required, but it is not present in the request headers');
        setHookTenantId(tenantId);
        await next();
    };
};
