import type { NextFunction, Request, Response } from 'express';
import { Uuid } from 'src/core/uuid';
import { setHookContext, setHookCorrelationId, setHookTenantId } from 'src/hooks';

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

export const setTenantId = (req: Request, res: Response, next: NextFunction) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    setHookTenantId(tenantId);
    next();
};
