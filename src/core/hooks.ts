import { AsyncLocalStorage } from 'node:async_hooks';

interface HookContext {
    correlationId: string | undefined;
    tenantId: string | undefined;
    logMetadata: Record<string, unknown> | undefined;
}

const asyncStorage = new AsyncLocalStorage<
    Map<keyof HookContext, HookContext[keyof HookContext]>
>();


export const getHookContext = () => {
    return (
        asyncStorage.getStore() ??
        new Map<keyof HookContext, HookContext[keyof HookContext]>()
    );
};

export const getHookCorrelationId = (): string | undefined => {
    const context = getHookContext();
    return context.get('correlationId') as string | undefined;
};

export const setHookContext = <R>(callback: (...args: unknown[]) => R): R => {
    return asyncStorage.run(getHookContext(), callback);
};

export const setHookCorrelationId = (correlationId: string) => {
    const context = getHookContext();
    context.set('correlationId', correlationId);
};

export const setHookTenantId = (tenantId: string) => {
    const context = getHookContext();
    context.set('tenantId', tenantId);
};

export const getHookTenantId = () => {
    const context = getHookContext();
    const tenantId = context.get('tenantId') as string | undefined;
    if (!tenantId) throw new Error('Tenant ID not found');
    return tenantId;
};

export function setHookLogMetadata(metadata: Record<string, unknown>): void;
export function setHookLogMetadata(key: string, value: unknown): void;
export function setHookLogMetadata(
    keyOrMetadata: string | Record<string, unknown>,
    value?: unknown
): void {
    const context = getHookContext();
    const current =
        (context.get('logMetadata') as Record<string, unknown> | undefined) ?? {};
    const next =
        typeof keyOrMetadata === 'string'
            ? { ...current, [keyOrMetadata]: value }
            : { ...current, ...keyOrMetadata };
    context.set('logMetadata', next);
}

export const getHookLogMetadata = (): Record<string, unknown> => {
    const context = getHookContext();
    return (
        (context.get('logMetadata') as Record<string, unknown> | undefined) ?? {}
    );
};
