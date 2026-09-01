# Outbox relay (`@wave-tech/framework/outbox-relay`)

Drena eventos de uma tabela de outbox e os entrega em lote na `wave-events-api`
(`POST /events`), com execução durável (DBOS), retry/backoff, isolamento de
poison pill e no máximo **um drain rodando no cluster inteiro** — qualquer
número de réplicas, em qualquer runtime.

Dois entrypoints:

| Subpath | Conteúdo | Dependência extra |
|---|---|---|
| `@wave-tech/framework/outbox-relay` | contratos (`RelayEvent`, `OutboxRelaySource`, `EventSink`), ciclo de drain (`OutboxRelayService`), sink HTTP da events-api (`HttpEventSink`), helpers de mapper (`promoteOccurredAt`, `promoteCorrelationId`) | nenhuma |
| `@wave-tech/framework/outbox-relay/dbos` | wiring durável (`registerOutboxRelay`) e runtime (`launchDbos`, `shutdownDbos`, `buildPostgresUrl`) | `@dbos-inc/dbos-sdk` (peer dependency opcional) |

## O que o seu serviço escreve (~2 arquivos)

1. **Source** — implementa `OutboxRelaySource` sobre a SUA tabela de outbox:
   - `claimPendingBatch` é um **SELECT simples, sem lock e sem transação** — a
     exclusividade vem da fila DBOS, não do banco. Ordene por `created_at ASC`
     e filtre pelo cutoff de rollout, se houver.
   - `markDelivered` é idempotente (UPDATE por ids).
   - `park` tira o evento da fila e registra o motivo (sem coluna própria:
     marque entregue + log de erro; com colunas, um `relay_status='parked'`).
2. **Mapper** — linha do outbox → `RelayEvent`. `source` = nome do seu serviço;
   use `promoteOccurredAt(payload, row.createdAt)` e
   `promoteCorrelationId(payload)` para promover campos do envelope de
   auditoria; payload viaja **verbatim** (o barramento não valida a forma —
   consumidores validam).

## Composição (composition root)

```ts
import { HttpEventSink, OutboxRelayService } from '@wave-tech/framework/outbox-relay';
import {
  buildPostgresUrl,
  launchDbos,
  registerOutboxRelay,
  shutdownDbos,
} from '@wave-tech/framework/outbox-relay/dbos';

const service = new OutboxRelayService(
  new MyOutboxRelaySource(db, config.outboxRelaySince),
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
