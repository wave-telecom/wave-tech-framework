---
date: 2026-04-29
researcher: Gabriel de Jesus Rodrigues
git_commit: 262a061c0bc5c56ddd04317f9f8a24fa7a03b38a
branch: main
repository: wave-tech-framework
topic: "Como o correlationId é settado, obtido e propagado nos logs de um request"
tags: [research, correlation-id, logging, middleware, async-hooks, winston]
status: complete
last_updated: 2026-04-29
last_updated_by: Gabriel de Jesus Rodrigues
---

# Research: Fluxo do `correlationId` (set, get e propagação nos logs)

**Date**: 2026-04-29
**Researcher**: Gabriel de Jesus Rodrigues
**Git Commit**: 262a061c0bc5c56ddd04317f9f8a24fa7a03b38a
**Branch**: main
**Repository**: wave-tech-framework

## Research Question
Como o `correlationId` é settado e como ele é obtido. Como ele é settado nos logs de um request. Hoje o `correlationId` é o mesmo em todos os logs de um request — documentar o porquê.

## Summary

`correlationId` vive em um `AsyncLocalStorage` (módulo `node:async_hooks`) instanciado em `src/core/hooks.ts`. O fluxo de um request HTTP segue três fases:

1. **Bootstrap do contexto** — middleware `setContext` (Express) ou `setContextHono` (Hono) chama `asyncStorage.run(...)`. Tudo executado dentro do `next()`/`next` herda o mesmo `Map` de contexto via propagação async-hooks do Node.
2. **Resolução do correlationId** — middleware `setCorrelationId` lê (em ordem) `req.body.message.attributes.correlationId` → header `x-correlation-id` → fallback `Uuid.random()`. Resultado é gravado no `Map` via `setHookCorrelationId`.
3. **Leitura no logger** — `Logger.log` em `src/core/logger.ts` chama `getHookCorrelationId()` a cada chamada (`debug`/`info`/`http`/`warn`/`error`) e injeta o valor no objeto `meta` do Winston.

Por causa do `AsyncLocalStorage`, qualquer await/callback descendente do `setContext` enxerga o mesmo `Map` — daí o `correlationId` ser idêntico em todos os logs do mesmo request.

## Detailed Findings

### 1. Storage do contexto — `src/core/hooks.ts`

Define um `AsyncLocalStorage<Map<keyof HookContext, ...>>`:

- `src/core/hooks.ts:1` — `import { AsyncLocalStorage } from 'node:async_hooks';`
- `src/core/hooks.ts:3-6` — interface `HookContext { correlationId, tenantId }`
- `src/core/hooks.ts:8-10` — instância singleton `asyncStorage`
- `src/core/hooks.ts:13-18` — `getHookContext()` retorna `asyncStorage.getStore() ?? new Map(...)`. Se não houver store ativo, retorna um `Map` vazio efêmero (não persiste).
- `src/core/hooks.ts:20-23` — `getHookCorrelationId()` faz `getHookContext().get('correlationId')`.
- `src/core/hooks.ts:25-27` — `setHookContext(callback)` envolve com `asyncStorage.run(getHookContext(), callback)`. Esse `run` é o que cria a "zona" assíncrona e propaga o `Map` para todos os descendentes async.
- `src/core/hooks.ts:29-32` — `setHookCorrelationId(value)` faz `getHookContext().set('correlationId', value)`.

Por que vale para todo o request: `AsyncLocalStorage.run(store, fn)` registra `store` como contexto da execução de `fn` e de qualquer continuação async iniciada de dentro dela (Promises, `setTimeout`, callbacks, etc.). Como o controller é executado dentro do `next()` chamado por `setContext`, todos os logs subsequentes tocam o mesmo `Map`.

### 2. Middleware Express — `src/middlewares/context.ts`

- `src/middlewares/context.ts:6-8` — `setContext`: chama `setHookContext(() => { next(); })`. Esse é o entrypoint que ativa o `AsyncLocalStorage` para o request.
- `src/middlewares/context.ts:10-22` — `setCorrelationId`:
  - `:11` lê `req.headers['x-correlation-id']`.
  - `:12-13` lê `req.body?.message?.attributes?.correlationId` (caminho usado por mensagens Pub/Sub que chegam via subscriber HTTP).
  - `:14` precedência: **attribute > header**.
  - `:16-18` se nenhum, gera `Uuid.random().value` (UUID v4).
  - `:20` grava com `setHookCorrelationId(correlationId)`.
  - `:21` `next()`.

Ordem de uso esperada na app consumidora: `app.use(setContext); app.use(setCorrelationId);` — `setContext` precisa rodar antes para que `setCorrelationId` escreva dentro de uma zona ALS ativa.

### 3. Middleware Hono — `src/middlewares/context.ts`

- `src/middlewares/context.ts:33-35` — `setContextHono`: `await setHookContext(() => next())`. Versão async.
- `src/middlewares/context.ts:37-47` — `setCorrelationIdHono`: lê só o header `x-correlation-id` (não checa body); fallback `Uuid.random().value`; grava com `setHookCorrelationId`. Diferença vs Express: **não há leitura de `body.message.attributes.correlationId`** no caminho Hono.

### 4. Logger — `src/core/logger.ts`

- `src/core/logger.ts:3` — `import { getHookCorrelationId } from './hooks';`
- `src/core/logger.ts:9-39` — `WinstonLogger.getInstance(serviceName?)` constrói singleton Winston com `format.json()`, `format.timestamp()`, `format.errors({ stack: true })`, transport `Console`, `level: 'http'`, `defaultMeta: { service }`.
- `src/core/logger.ts:56-76` — método estático `Logger.log(severity, message, meta?, err?)`:
  - `:72` `const correlationId = getHookCorrelationId();` — leitura **a cada log**.
  - `:74` `const metaObj = { ...meta, err: errObject, correlationId };` — injeção como campo `meta` do Winston.
  - `:75` `logger.log(severity, logMessage, metaObj)`.
- `src/core/logger.ts:78-96` — wrappers públicos: `debug`, `info`, `http`, `warn`, `error`. Todos delegam ao `log` privado, então todos carregam o `correlationId`.
- `src/core/logger.ts:98-104` — `formatMetadata` (usado por `warn`/`error`) adiciona `notify` e `jsonString`, mas o `correlationId` é injetado depois no `log` privado.

Pormenor: o `correlationId` aparece no payload Winston como propriedade do meta — ou seja, no JSON final do `Console` transport ele fica como campo top-level junto a `service`, `severity`, `timestamp`, `message`, `err`.

### 5. Por que o `correlationId` é o mesmo em todos os logs do request

Cadeia:

1. Express invoca `setContext` → `setHookContext(cb)` → `asyncStorage.run(map, cb)`.
2. Dentro de `cb`, `next()` é chamado. Tudo que vier depois (próximos middlewares, controllers, useCases, awaits, callbacks de I/O) executa **dentro da zona ALS** desse `Map`.
3. `setCorrelationId` (próximo middleware) faz `map.set('correlationId', X)`. A mesma referência `Map` é usada.
4. Cada `Logger.info(...)` etc. chama `getHookCorrelationId()` → `asyncStorage.getStore()` → retorna o **mesmo** `Map` → mesmo `X`.
5. O `Map` só desaparece quando a callback inicial passada ao `asyncStorage.run` retorna. Como o request encerra dentro daquela zona, todos os logs do request enxergam o mesmo valor.

Em paralelo: outro request entra em outra invocação de `asyncStorage.run` com outro `Map` — isolamento por request é garantido pelo Node async-hooks.

### 6. Onde o logger é usado dentro do framework

- `src/controllers/base-controller.ts:15` — `Logger.error('[BaseController] Unexpected error occurred', {}, err);` no `catch` de `execute`.
- `src/controllers/subscriber-controller.ts:27` — `Logger.warn('Some validation errors occurred', { body }, errors);` em validação falha.

Esses dois pontos confirmam que o logger é chamado de dentro do handler do request (após middlewares de contexto), portanto sempre dentro da zona ALS — `correlationId` correto.

### 7. Inicialização do logger — `src/core/logger.ts:46-49`

`Logger.initialize(serviceName)` define `serviceName` no `defaultMeta`. Lazy: se não chamado, `Logger.getLogger()` (`:51-54`) inicializa com `'app'`. Em `NODE_ENV === 'test'` o serviço vira `'test'` e o format-fn (`:17-21`) retorna `false` silenciando todos os logs.

### 8. Tests — `tests/middlewares/context.spec.ts`

Confirmam o contrato:

- `tests/middlewares/context.spec.ts:38-48` — header `x-correlation-id` repassado para `setHookCorrelationId`.
- `tests/middlewares/context.spec.ts:50-64` — `body.message.attributes.correlationId` repassado.
- `tests/middlewares/context.spec.ts:66-74` — sem nenhum, `Uuid.random().value` é usado.
- `tests/middlewares/context.spec.ts:76-94` — quando ambos presentes, atributo (Pub/Sub) tem precedência sobre header.
- `tests/middlewares/context.spec.ts:153-174` — versão Hono: só header → fallback UUID.

## Code References

- `src/core/hooks.ts:1` — import `AsyncLocalStorage`.
- `src/core/hooks.ts:8-10` — instância `asyncStorage`.
- `src/core/hooks.ts:20-23` — `getHookCorrelationId()`.
- `src/core/hooks.ts:25-27` — `setHookContext()` que faz o `asyncStorage.run`.
- `src/core/hooks.ts:29-32` — `setHookCorrelationId()`.
- `src/middlewares/context.ts:6-8` — middleware `setContext` (Express).
- `src/middlewares/context.ts:10-22` — middleware `setCorrelationId` (Express, lê body+header+fallback UUID).
- `src/middlewares/context.ts:33-35` — `setContextHono`.
- `src/middlewares/context.ts:37-47` — `setCorrelationIdHono` (só header + fallback UUID).
- `src/core/logger.ts:72-75` — leitura do `correlationId` do ALS e injeção no meta do Winston.
- `src/core/uuid.ts:18-20` — `Uuid.random()` usa `uuid.v4()`.
- `src/controllers/base-controller.ts:15` — exemplo de log dentro do request scope.
- `src/controllers/subscriber-controller.ts:27` — exemplo de log com body.

## Architecture Documentation

Padrão observado:

- **Per-request context via AsyncLocalStorage**: zona criada por middleware `setContext`/`setContextHono`, dados gravados por middlewares irmãos (`setCorrelationId`, `setTenantId`), lidos por consumidores (`Logger`, qualquer chamada de `getHookCorrelationId`/`getHookTenantId`).
- **Resolução por precedência**:
  - Express: `body.message.attributes.correlationId` > header `x-correlation-id` > UUID novo.
  - Hono: header `x-correlation-id` > UUID novo.
- **Logger singleton** Winston (`format.json()`, `level: 'http'`, transport `Console`) com `correlationId` injetado por chamada (não via `defaultMeta`).
- **Convenção de exports**: middlewares expostos por `src/middlewares/index.ts`; hooks por `src/core/index.ts` → consumidor importa via `@wave-tech/framework`.
- **Isolamento de request**: garantido pela semântica de `AsyncLocalStorage.run` do Node — cada request tem sua própria invocação `run` e seu próprio `Map`.

## Historical Context (from git log)

- `2879a2a Add context hooks` — introdução inicial do sistema de hooks de contexto.
- `ff04786` / `af98d8a` — `restructure project exports and module organization` (move/expor hooks e middlewares).
- `52ef8c6` / `26fc2ee` — `setTenantId` virou função que aceita `defaultTenantId` opcional e lança erro caso nem header nem default existam.
- `76fa7ef` / `30d1b2f` — `add metadata fields to warn and error logs` (introduziu `formatMetadata` no `Logger`).
- `84efab8` / `3bab231` — `add Hono context middleware` (adicionou as variantes `*Hono`).

## Related Research

Nenhuma pesquisa prévia em `docs/research/` (pasta criada nesta sessão).

## Open Questions

- Não há, dentro deste repo, log explícito de propagação saindo (ex.: cliente HTTP que reenvia `x-correlation-id` em chamadas downstream). `src/clients/opencep/open-cep-api-client-impl.ts` não foi inspecionado neste research; investigar se chamadas outbound propagam o `correlationId` via header.
- O caminho Hono não checa `body.message.attributes.correlationId` — comportamento intencional ou divergência vs Express não está documentado.
