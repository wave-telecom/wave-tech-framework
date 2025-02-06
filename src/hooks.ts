import { AsyncLocalStorage } from 'async_hooks';

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
