# Plan: `setHookLogMetadata` — Per-Request Log Metadata via AsyncLocalStorage

**Date**: 2026-04-29
**Author**: Gabriel de Jesus Rodrigues
**Repository**: wave-tech-framework
**Branch**: main
**Status**: ready for implementation
**Related research**: `docs/research/2026-04-29-correlation-id-flow.md`

## Context

Hoje todo log de um request inclui automaticamente o `correlationId` injetado pelo `Logger` em `src/core/logger.ts:72-75`. O dev consegue passar metadados ad-hoc por chamada (`Logger.info('msg', { foo })`), mas não há forma de **propagar metadados request-scoped** que apareçam em **todos os logs subsequentes** sem repetir o objeto a cada `Logger.X` call.

Caso de uso típico: middleware/usecase resolve `userId`/`orderId`/`channel` cedo no request → quer que **todos** os logs daquele request carreguem esses campos automaticamente, igual `correlationId` faz hoje.

Solução: nova hook fn `setHookLogMetadata` que escreve no mesmo `AsyncLocalStorage` Map já usado por `correlationId`/`tenantId` (`src/core/hooks.ts:8-10`). Logger lê e mescla nos meta do Winston a cada chamada. Isolamento per-request automático via `asyncStorage.run(...)` em `setContextHono`/`setContext` — mesmo mecanismo que hoje protege `correlationId` (research em `docs/research/2026-04-29-correlation-id-flow.md`).

## Requirements Summary

| Requisito | Decisão |
|---|---|
| API location | Hook fn em `src/core/hooks.ts` (não método de `Logger`) |
| Verbo | `set` (mantém convenção `setHookCorrelationId`/`setHookTenantId`) |
| Assinatura | 2 overloads — `setHookLogMetadata(meta: Record<string, unknown>)` e `setHookLogMetadata(key: string, value: unknown)` |
| Semântica | Shallow merge upsert — novas chaves entram, mesma chave sobrescreve |
| Output JSON | Top-level flat — cada chave do meta vira campo top-level no Winston JSON (igual `correlationId`) |
| Precedência | Per-call meta > hook meta > reserved (`err`, `correlationId`) |
| Validação reserved keys | Sem validação write-time; spread order garante reserved sempre vencem |
| Isolamento per-request | Automático via `AsyncLocalStorage.run` existente em `setContext`/`setContextHono` (`src/middlewares/context.ts:6-8,33-35`) |

## Acceptance Criteria

1. `setHookLogMetadata({ userId: '1', orderId: 'x' })` faz com que `Logger.info('msg')` produza JSON com `userId: '1'` e `orderId: 'x'` como campos top-level.
2. `setHookLogMetadata('userId', '1')` (key/value) tem o mesmo efeito de `setHookLogMetadata({ userId: '1' })`.
3. Chamadas sucessivas mesclam — `setHookLogMetadata({ a: 1 })` seguido de `setHookLogMetadata({ b: 2 })` resulta em `{ a: 1, b: 2 }` no log.
4. Mesma chave em chamadas sucessivas sobrescreve — `setHookLogMetadata({ a: 1 })` seguido de `setHookLogMetadata({ a: 2 })` resulta em `a: 2`.
5. Per-call meta sobrescreve hook meta — `setHookLogMetadata({ x: 'hook' })` + `Logger.info('m', { x: 'call' })` → log com `x: 'call'`.
6. `correlationId` per-call ou via hookMeta NÃO sobrescreve o `correlationId` real do request — `correlationId` é sempre o último no spread em `Logger.log`.
7. Requests paralelos têm metadados isolados (validado por teste com 2 zonas ALS concorrentes via `setHookContext`).
8. Tipo TS exporta ambos overloads e o caminho object aceita `Record<string, unknown>`.
9. `Logger.warn`/`Logger.error` (que passam por `formatMetadata` em `src/core/logger.ts:98-104`) também recebem o hook meta corretamente.

## Implementation Steps

### Step 1 — `src/core/hooks.ts`: storage + writer + reader

**1a. Expandir interface `HookContext` (linha 3-6):**

```ts
interface HookContext {
    correlationId: string | undefined;
    tenantId: string | undefined;
    logMetadata: Record<string, unknown> | undefined;
}
```

A declaração `asyncStorage` em `src/core/hooks.ts:8-10` (`Map<keyof HookContext, HookContext[keyof HookContext]>`) widening automático para `string | Record<string, unknown> | undefined`. Sem alteração textual nessa linha — só na interface.

**1b. Adicionar `setHookLogMetadata` (overloaded) após linha 32:**

```ts
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
```

**1c. Adicionar `getHookLogMetadata` (consumido por `Logger.log`):**

```ts
export const getHookLogMetadata = (): Record<string, unknown> => {
    const context = getHookContext();
    return (context.get('logMetadata') as Record<string, unknown> | undefined) ?? {};
};
```

Notas:
- Sem validação de chaves reservadas — proteção vem da ordem de spread em `Logger.log` (Step 2).
- `getHookContext()` (linhas 13-18) já lida com ausência de zona ALS retornando Map novo. Mesma semântica silenciosa de `setHookCorrelationId` quando middleware `setContext` não rodou — escreve em Map efêmero, não persiste. Comportamento idêntico ao existente.

### Step 2 — `src/core/logger.ts`: injetar hook meta

**2a. Import (linha 3):**

```ts
import { getHookCorrelationId, getHookLogMetadata } from './hooks';
```

**2b. Modificar `Logger.log` (`src/core/logger.ts:56-76`) na construção de `metaObj` (linha 74):**

```ts
const correlationId = getHookCorrelationId();
const hookMeta = getHookLogMetadata();
const logMessage = `${message}. ${errorMsg}`;
const metaObj = { ...hookMeta, ...meta, err: errObject, correlationId };
logger!.log(severity, logMessage, metaObj);
```

Ordem de spread garante:
- `hookMeta` campos top-level no JSON (campos individuais, não nested)
- `meta` per-call sobrescreve `hookMeta` em colisão
- `err` e `correlationId` últimos → não podem ser sobrescritos por hook nem per-call

`formatMetadata` (`src/core/logger.ts:98-104`) usado por `warn`/`error` continua intocado — recebe só o `meta` per-call, e o resultado é passado adiante como `meta` ao `log` privado. Hook meta é mesclado depois. Funciona sem alteração.

### Step 3 — `src/core/index.ts`: sem mudanças

`export * from './hooks'` (linha 5) já exporta `setHookLogMetadata` e `getHookLogMetadata` automaticamente.

### Step 4 — `tests/core/hooks.spec.ts`: novo arquivo

Não existe `tests/core/hooks.spec.ts` hoje (`tests/core/` contém só `utils/`). Tests mockam hooks via `vi.mock('../../src/core/hooks')` em `tests/middlewares/context.spec.ts` — então o impl real do hook não é exercitado em testes hoje. Criar arquivo novo com **ALS real** (sem mock) para testar a impl.

Cobertura mínima (7 casos):

```ts
import { describe, it, expect } from 'vitest';
import {
    setHookContext,
    setHookLogMetadata,
    getHookLogMetadata,
} from '../../src/core/hooks';

describe('setHookLogMetadata', () => {
    it('object overload — sets all keys', () => {
        setHookContext(() => {
            setHookLogMetadata({ a: 1, b: 2 });
            expect(getHookLogMetadata()).toEqual({ a: 1, b: 2 });
        });
    });

    it('key/value overload — sets single key', () => {
        setHookContext(() => {
            setHookLogMetadata('a', 1);
            expect(getHookLogMetadata()).toEqual({ a: 1 });
        });
    });

    it('merges new keys without dropping previous', () => {
        setHookContext(() => {
            setHookLogMetadata({ a: 1 });
            setHookLogMetadata({ b: 2 });
            expect(getHookLogMetadata()).toEqual({ a: 1, b: 2 });
        });
    });

    it('overwrites same key on subsequent call', () => {
        setHookContext(() => {
            setHookLogMetadata({ a: 1 });
            setHookLogMetadata({ a: 2 });
            expect(getHookLogMetadata()).toEqual({ a: 2 });
        });
    });

    it('mixed overloads merge correctly', () => {
        setHookContext(() => {
            setHookLogMetadata({ a: 1 });
            setHookLogMetadata('b', 2);
            expect(getHookLogMetadata()).toEqual({ a: 1, b: 2 });
        });
    });

    it('returns empty object outside ALS zone', () => {
        expect(getHookLogMetadata()).toEqual({});
    });

    it('isolates metadata between parallel ALS zones', async () => {
        const captured: Record<string, unknown>[] = [];
        await Promise.all([
            new Promise<void>((resolve) =>
                setHookContext(() => {
                    setHookLogMetadata({ zone: 'A' });
                    setImmediate(() => {
                        captured.push(getHookLogMetadata());
                        resolve();
                    });
                })
            ),
            new Promise<void>((resolve) =>
                setHookContext(() => {
                    setHookLogMetadata({ zone: 'B' });
                    setImmediate(() => {
                        captured.push(getHookLogMetadata());
                        resolve();
                    });
                })
            ),
        ]);
        expect(captured).toContainEqual({ zone: 'A' });
        expect(captured).toContainEqual({ zone: 'B' });
    });
});
```

### Step 5 — Tests existentes: regressão

Não estritamente necessário modificar `tests/middlewares/context.spec.ts` — não há novo middleware. Mock de `hooks` em `vi.mock('../../src/core/hooks')` ignora as novas fns automaticamente. Rodar para confirmar.

## Critical Files to Modify

| File | Change Type | Reason |
|---|---|---|
| `src/core/hooks.ts` | Modify | Add `logMetadata` to `HookContext`, add `setHookLogMetadata` (overloaded) + `getHookLogMetadata` |
| `src/core/logger.ts` | Modify | Import `getHookLogMetadata`; modify `Logger.log` spread order on line 74 |
| `tests/core/hooks.spec.ts` | Create | New file with 7 cases — overloads, merge, overwrite, mixed, no-zone, isolation |

## Existing Functions to Reuse

- `getHookContext()` — `src/core/hooks.ts:13-18` — reusado por `setHookLogMetadata`/`getHookLogMetadata` para acessar o Map ALS.
- `asyncStorage` — `src/core/hooks.ts:8-10` — singleton já existe; novo metadado vive como nova chave (`'logMetadata'`) no mesmo Map.
- `setHookContext` — `src/core/hooks.ts:25-27` — usado nos tests para abrir zona ALS real (sem mock).
- `Logger.log` — `src/core/logger.ts:56-76` — apenas extender o spread; sem novo método.
- `format.json()` — `src/core/logger.ts:25` — Winston transformer já flattens meta object para top-level fields no JSON output.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Dev escreve chave reservada (ex: `setHookLogMetadata({ correlationId: 'x' })`) e quebra log search | Spread order em `Logger.log` garante `correlationId` final — hook não consegue sobrescrever. Documentar no JSDoc da fn que `correlationId`/`err`/Winston-reserved são sempre overwritados pelo Logger. |
| Dev chama `setHookLogMetadata` fora de zona ALS (sem `setContextHono`) e perde dado silenciosamente | Comportamento idêntico ao `setHookCorrelationId` existente — não é regressão. Mencionar no JSDoc: "must be called inside a `setHookContext` zone (i.e., within request scope)". |
| Performance: spread extra em todo log call | Negligenciável — `Logger.log` já faz spread (`{ ...meta, err, correlationId }`). Adicionar `...hookMeta` é O(n) sobre keys do hook, executado uma vez por log. Custo dominado por `format.json()` Winston transformer já presente. |
| TypeScript Map value type widening quebra `setHookCorrelationId`/`setHookTenantId` | Map value type passa de `string \| undefined` para `string \| Record<string, unknown> \| undefined`. `setHookCorrelationId` faz `set('correlationId', value: string)` — válido. `getHookCorrelationId` faz `get('correlationId')` retornando o union — `Logger.log:72` usa em template string, `app/src/index.ts:106` usa em `c.res.headers.set('x-correlation-id', correlationId)` que requer string. Possível erro de tipo nesse último. **Verificar com `pnpm build` e adicionar narrowing/cast em `getHookCorrelationId` se necessário** (`return context.get('correlationId') as string \| undefined`). |
| Colisão acidental com Winston reserved fields (`level`, `message`, `timestamp`, `service`, `severity`) ao colocar tudo top-level | Spread order: per-call > hook, mas Winston reserved não estão na nossa spread chain. Se hook coloca `level: 'foo'`, Winston **vai** sobrescrever no transport. Aceitável: documentar no JSDoc. Validação write-time descartada na entrevista — proteção é responsabilidade do dev. |
| Caminho Hono não tem leitura de `body.message.attributes.correlationId` (research linha 158) — divergência pré-existente | Fora do escopo deste plano. Documentado em `docs/research/2026-04-29-correlation-id-flow.md` como questão aberta. Sem ação aqui. |

## Verification Steps

Executar nesta ordem após implementação:

1. **Lint**: `pnpm lint` — zero warnings/errors.
2. **Build**: `pnpm build` — TS compila com novo overload e Map type widening; verificar se `getHookCorrelationId` precisa de narrowing/cast (ver risco TS acima).
3. **Tests**: `pnpm test` — todos os tests passam, incluindo os 7 novos casos em `tests/core/hooks.spec.ts`.
4. **Regressão**: confirmar que `tests/middlewares/context.spec.ts` (todos os blocos `Express Context Middleware` e `Hono Context Middleware`) continuam verdes — mock de hooks não toca nas novas fns.
5. **Tipo check do consumidor** (TS-only, sem rodar):
   ```ts
   setHookLogMetadata({ a: 1 });            // OK (object overload)
   setHookLogMetadata('a', 1);              // OK (key/value)
   setHookLogMetadata('a');                 // OK — value: undefined
   ```
6. **Manual smoke** (opcional, REPL/script `tsx`):
   ```ts
   import { setHookContext, setHookLogMetadata } from './src/core/hooks';
   import { Logger } from './src/core/logger';
   process.env.NODE_ENV = 'development';
   Logger.initialize('test-svc');
   setHookContext(() => {
       setHookLogMetadata({ userId: '42', orderId: 'abc' });
       Logger.info('hello');           // userId='42', orderId='abc' top-level
       setHookLogMetadata('userId', '99');
       Logger.info('after overwrite'); // userId='99', orderId='abc'
       Logger.info('per-call wins', { userId: 'xx' }); // userId='xx', orderId='abc'
   });
   ```
   Esperado em stdout: 3 linhas JSON com os campos top-level esperados, todas carregando o mesmo `correlationId` (gerado pelo middleware no fluxo real, ou ausente nesse smoke já que `setCorrelationId` não foi chamado).

## Out of Scope

- Validação write-time de chaves reservadas (descartado na entrevista).
- Façade `Logger.addMetadata` (descartado — manter API em hooks; pode ser adicionada depois sem breaking change).
- Propagação outbound (HTTP client reenviar `x-correlation-id` ou logMetadata em chamadas downstream) — questão aberta no research.
- Paridade Express/Hono no parsing de `body.message.attributes.correlationId` — pré-existente, fora do escopo.
