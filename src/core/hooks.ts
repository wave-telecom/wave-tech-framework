import { AsyncLocalStorage } from 'node:async_hooks';

interface HookContext {
    correlationId: string | undefined;
    tenantId: string | undefined;
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

export const getHookCorrelationId = () => {
    const context = getHookContext();
    return context.get('correlationId');
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
    const tenantId = context.get('tenantId');
    if (!tenantId) throw new Error('Tenant ID not found');
    return tenantId;
};
