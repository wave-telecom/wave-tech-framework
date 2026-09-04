# Outbox relay (`@wave-tech/framework/outbox-relay`)

Drena eventos de uma tabela de outbox e os entrega em lote na `wave-events-api`
(`POST /events`), com execução durável (DBOS), retry/backoff, isolamento de
poison pill e no máximo **um drain rodando no cluster inteiro** — qualquer
número de réplicas, em qualquer runtime.

Dois entrypoints:

| Subpath | Conteúdo | Dependência extra |
|---|---|---|
| `@wave-tech/framework/outbox-relay` | contratos (`RelayEvent`, `OutboxRelaySource`, `EventSink`), ciclo de drain (`OutboxRelayService`), sink HTTP da events-api (`HttpEventSink`), **source padrão** (`PrismaOutboxRelaySource` + `toRelayEvent` para a tabela padronizada), helpers de mapper (`promoteOccurredAt`, `promoteCorrelationId`) | nenhuma |
| `@wave-tech/framework/outbox-relay/dbos` | wiring durável (`registerOutboxRelay`) e runtime (`launchDbos`, `shutdownDbos`, `buildPostgresUrl`) | `@dbos-inc/dbos-sdk` (peer dependency opcional) |

## O que o seu serviço escreve

Com a tabela **padronizada** (colunas do transporte de audit + `parked_at`/
`park_reason` + `sink` — o caso de todo módulo novo), **nada além do wiring**: a lib já
traz `PrismaOutboxRelaySource` (claim sem lock, `markDelivered` idempotente,
park de primeira classe) e o mapper `toRelayEvent` (promove `occurredAt`/
`correlationId` do envelope de audit; payload viaja **verbatim**). O nome do
serviço entra como parâmetro do source.

Um módulo cuja tabela **diverge** do padrão (filtros próprios, cutoff de
rollout, park sem colunas — o caso do wave-billing-api) implementa o seu
`OutboxRelaySource`:
   - `claimPendingBatch` é um **SELECT simples, sem lock e sem transação** — a
     exclusividade vem da fila DBOS, não do banco. Ordene por `created_at ASC`.
   - `markDelivered` é idempotente (UPDATE por ids).
   - `park` tira o evento da fila e registra o motivo.

## Composição (composition root)

```ts
import {
  HttpEventSink,
  OutboxRelayService,
  PrismaOutboxRelaySource,
} from '@wave-tech/framework/outbox-relay';
import {
  buildPostgresUrl,
  launchDbos,
  registerOutboxRelay,
  shutdownDbos,
} from '@wave-tech/framework/outbox-relay/dbos';

const service = new OutboxRelayService(
  new PrismaOutboxRelaySource(prisma, 'wave-<seu>-api'),
  new HttpEventSink({ baseUrl: config.eventsApiUrl, apiKey: config.eventsApiKey }),
  { batchSize: 100, maxBatchBytes: 800 * 1024 },   // limites da events-api: 100 itens / ~1MiB
);

const relay = registerOutboxRelay({
  service,
  maxBatchesPerRun: 25,
  schedule: { enabled: config.outboxRelayScheduleEnabled, cron: '*/10 * * * * *' },
});

// registrar ANTES de launch; launch antes do listen:
await launchDbos({
  name: 'wave-<seu>-api',
  // applicationVersion: DEIXE SEM — DBOS deriva por hash do código dos
  // workflows, e recovery cruza deploys que não mudaram workflow. Um valor
  // por deploy (K_REVISION, image tag) órfãria um drain interrompido no rollout.
  // O nome do system database é responsabilidade do SEU módulo — siga a
  // convenção da plataforma (`<seu db>_dbos_sys`, provisionado pelo IaC):
  systemDatabaseUrl: buildPostgresUrl({
    host: config.databaseHost,
    port: config.databasePort,
    database: `${config.databaseName}_dbos_sys`,
    user: config.databaseUser,
    password: config.databasePassword,
  }),
});
await relay.reconcileSchedule();
// SIGTERM: await shutdownDbos()
// gatilho operacional: endpoint de job → relay.startDrainNow()
```

## Customização na inicialização (sem release da lib)

- `HttpEventSink`: `eventsPath` (default `/events`), `apiKeyHeader` (default
  `x-api-key`), `extraHeaders` (tenant/tracing/gateway — os headers de contrato
  vencem em conflito), `requestTimeoutMillis` (default 30s).
- `registerOutboxRelay`: `name` sufixa fila/dedup/schedule/workflows no system
  database (obrigatório quando um processo registra mais de um relay; omitido,
  usa os nomes legados); `stepRetries.{claim,deliver,settle}` ajusta tentativas
  e backoff por step (defaults: claim 3; deliver 8/1s/×2; settle 5).
- `launchDbos`: `systemDatabasePoolSize` (default 4), `runAdminServer`
  (default `false` — abriria uma segunda porta, indesejada em Cloud Run).
- `promoteCorrelationId(payload, maxLength)` (default 256).

**Fixo de propósito** (invariantes, não configuração): `globalConcurrency: 1`
e o `deduplicationID` compartilhado (garantia de drain único), os statuses
`accepted`/`duplicate` e a validação estrita do body 200 do sink — assumir
sucesso em body malformado marcaria como publicado o que não foi entregue, a
perda silenciosa que o relay existe para fechar.

## Escolhendo o gatilho por runtime

| Runtime | Gatilho |
|---|---|
| Cloud Run com CPU throttled (`cpuIdle` default) e/ou `minInstances: 0` | Cloud Scheduler → endpoint de job, drenando **sincronamente dentro do request** (request aberto = CPU alocada). Schedule interno DESLIGADO. |
| Cloud Run com `cpuIdle: false` + `minInstances ≥ 1`, ou Kubernetes | Schedule interno DBOS (cron de segundos). Cloud Scheduler/K8s CronJob vira heartbeat folgado. |

Os dois gatilhos enfileiram com o mesmo `deduplicationID` (`return-existing`) —
podem coexistir sem drain duplicado. **Nunca rode um loop de I/O em background
num serviço com CPU throttled.**

## Garantias e limites (o que confiar, o que não)

- **Effectively-once no destino**: checkpoint por step do DBOS + dedupe da
  events-api (`idempotencyKey` default `"<source>:<outbox id>"`; `duplicate` é
  sucesso). Crash em qualquer ponto no máximo re-entrega — nunca perde.
- **1 drain global**: `globalConcurrency: 1` com dequeue transacional no
  Postgres. Recovery: outra instância da MESMA `applicationVersion` retoma um
  drain interrompido do último step.
- **Falha permanente de um evento (400)**: isolado item a item e parkeado; os
  demais seguem. 401 aborta o run (erro de configuração, alertável). 5xx/rede:
  retry com backoff no step; esgotou, o próximo tick recomeça — outage vira atraso.
- **Ordem**: `created_at ASC` com drain sequencial — boa na prática, **não é
  garantia estrita** (linha de transação longa pode ficar visível depois).
  Consumidores ordenam por `occurredAt`.
- **Exclusão mútua**: se outro canal escreve o mesmo marcador de entrega,
  imponha no boot que só um canal esteja ativo.

## Roteamento por sink (0.9)

A coluna `sink` da tabela outbox decide **quem entrega a linha** — e é escrita
por quem EMITE o evento, nunca inferida do nome:

- O audit extension grava `sink = 'events-api'` (`EVENTS_API_SINK`) em tudo
  que emite: auditoria sempre viaja o barramento de eventos da plataforma.
- Evento de domínio pertence a outro canal: quem o escreve grava o sink dele
  (ex.: `'pubsub'` no worker legado do billing). **Domínio nunca vai pra
  events-api.**
- `sink = NULL` é linha sem rota: ninguém claima (fail-closed) — o estado
  natural de backlog legado após o backfill.

Um destino novo custa três coisas: um `EventSink` do transporte, um segundo
`registerOutboxRelay({ name: '<sink>' , ... })` (fila/schedule/dedup próprios —
sinks drenam em paralelo e falham isolados) e o valor novo na coluna. Fila
única com um sink roteador é possível por composição, mas perde o isolamento
de falha entre destinos — prefira N filas.

## Retenção (purge, 0.9)

Linha entregue é histórico de transporte — o arquivo de longo prazo é o
change-history. O relay ganha um job diário de expurgo, opcional:

```ts
registerOutboxRelay({
  service, maxBatchesPerRun, schedule,
  purge: {
    enabled: env.OUTBOX_RELAY_SCHEDULE_ENABLED,   // mesma alavanca do cron interno
    cron: '0 4 * * *',
    source,                                        // o mesmo PrismaOutboxRelaySource
    olderThan: () => new Date(Date.now() - 30 * 24 * 3600 * 1000),
    batchSize: 1000,
    maxBatchesPerRun: 50,
  },
});
```

- **Apaga**: `published = true AND published_at < olderThan()` — em lotes
  curtos e idempotentes, de qualquer sink (entregue é entregue).
- **Nunca apaga**: `published = false` — pendentes E parkeadas. Parked é a
  fila de erro; espera um operador.
- Roda na MESMA fila do drain (`globalConcurrency: 1`): nunca concorre com o
  claim do próprio sink. `startPurgeNow()` no handle é o gatilho manual/externo.
- Redrive manual de linha já entregue só funciona dentro da janela de retenção.
- `idempotency_key` é liberada quando a linha some: chaves DEVEM carregar o
  período/ciclo (ex.: `subscription.billing_due-<id>-<data>`) — já é o padrão.
- Índices de suporte por módulo: `(sink, published, created_at)` para o claim e
  parcial `(published_at) WHERE published` para o purge.

## Pré-requisitos de infra

- System database dedicado **`<seu db>_dbos_sys`** na mesma instância Postgres
  (convenção da plataforma — ver módulos `events` e `billing` no
  `wave-foundation-iac`). Em dev/teste o DBOS o cria sozinho quando o role tem
  `CREATEDB`; em produção o IaC o provisiona. O nome é montado pelo seu módulo
  — a lib recebe a URL pronta e não conhece a convenção.
- `EVENTS_API_URL` alcançável pela rede do serviço (egress privado → URL interna
  do Cloud Run do events); `EVENTS_API_KEY` = valor do secret
  `<tenant>-events-internal-api-key`.

Referência de adoção: `wave-billing-api` — source e mapper em
`src/billing/infrastructure/outbox-relay/`, wiring em `src/index.ts`, teste de
integração `src/tests/integration/outbox-relay-dbos.int.spec.ts`
(Testcontainers + DBOS + events-api fake — use como modelo).
