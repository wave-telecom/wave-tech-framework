# @wave-tech/framework/audit

Padrão de **Audit Events**: captura automática das mudanças de entidade
(Created / Updated / Deleted) e grava um evento no **mesmo commit** da escrita de
negócio, via Prisma Client Extension. O motor mora no framework; cada API só
fornece a **configuração** (o que auditar) e a **tabela de transporte** (`outbox`)
no seu schema.

> Nomenclatura: **"audit"** é o padrão (trilha de quem mudou o quê, com
> before/after). O **`outbox`** é apenas o transporte (tabela onde o evento é
> gravado e de onde o relay publica). Um não é sinônimo do outro.

## O que o framework fornece

| Arquivo | Responsabilidade |
|---|---|
| `audit-context.ts` | ALS que carrega o `tx` da transação ativa até a extension. |
| `registry.ts` | Guarda o client estendido (`registerAuditedClient`). |
| `run-in-transaction.ts` | `withTransaction` — abre/junta transação e publica o `tx` no ALS. |
| `audit-actor.ts` | `getAuditActor()` — lê `userId`/`correlationId` dos hooks de request. |
| `build-audit-event.ts` | Contrato do evento: nome (`${prefix}${Model}Created/Updated/Deleted`), payload, diff, serialização segura. |
| `create-audit-extension.ts` | Factory da Prisma extension a partir da config da API + guardas. |

## O que fica na API

1. **Tabela de transporte no schema** (colunas padronizadas):

```prisma
model Outbox {
  id           String    @id @db.Uuid
  resourceId   String    @map("resource_id") @db.Uuid
  resourceType String    @map("resource_type") @db.VarChar(256)
  eventType    String    @map("event_type") @db.VarChar(256)
  payload      Json
  published    Boolean   @default(false)
  publishedAt  DateTime? @map("published_at") @db.Timestamptz(6)
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([published, createdAt])
  @@map("outbox")
}
```

2. **Config + wiring no boot** (o app usa o client estendido em todo lugar):

```typescript
import { createAuditExtension, registerAuditedClient } from '@wave-tech/framework/audit';

const auditExtension = createAuditExtension({
  Broker: { operations: new Set(['upsert']), emitOn: new Set(['CREATE', 'UPDATE']) },
  // eventPrefix default = 'Audit.' -> Audit.BrokerCreated, Audit.BrokerUpdated
});

const prisma = new PrismaClient();
const audited = prisma.$extends(auditExtension) as unknown as PrismaClient;
registerAuditedClient(audited); // withTransaction e o auto-wrap usam este client
// devolva `audited` para os repositórios/DI
```

## Formas suportadas de escrever um model auditado

Todas gravam o evento no MESMO commit da escrita. A extension descobre a
transação de três formas:

1. **`withTransaction` — recomendado (API pública).** Sempre para múltiplas
   escritas atômicas; serve também para escrita única.
   ```typescript
   import { withTransaction } from '@wave-tech/framework/audit';
   await withTransaction(async (tx) => {
     await tx.broker.upsert({ where: { id }, create: {...}, update: {...} });
   });
   ```
2. **`prisma.$transaction(async (tx) => ...)` cru.** A extension detecta a
   transação interativa (via `__internalParams`) e grava o evento nela.
3. **Escrita isolada direta no client** (ex.: `db.productProvider.upsert(...)`).
   A extension faz auto-wrap: abre a transação e grava o evento junto, atômico.
   Ideal para agregado de tabela única.

### A ÚNICA forma proibida

`prisma.$transaction([...])` em **array (batch)** contendo escrita de model
auditado → a extension **lança erro** (o batch não expõe um `tx` interativo).
Converta para escritas sequenciais dentro de `withTransaction` (ou de um
`$transaction` interativo).

> Nota técnica: as formas (2) e (3) usam APIs internas do Prisma
> (`__internalParams` / `_createItxClient`), validadas na 6.8. Se um upgrade do
> Prisma quebrá-las, o `withTransaction` (API pública) continua funcionando — por
> isso ele é o caminho recomendado.

## Diff de campos (opcional, desligado por padrão)

Por padrão o `payload.changes` de um UPDATE vem `null` (não calcula o diff nem
lê o registro anterior). Para habilitar num model, marque `diff: true` na regra:

```typescript
createAuditExtension({
  Broker: { operations: new Set(['upsert']), emitOn: new Set(['CREATE','UPDATE']), diff: true },
});
```

Com `diff: true`, o UPDATE preenche `changes: { campo: { from, to } }` (a
extension faz um `findUnique` do "before" para montá-lo).

## Chave primária (`resourceId`)

O `resourceId` é lido do campo `id` do registro por padrão. Se o model usar outra
PK, informe `idField` na regra:

```typescript
createAuditExtension({
  UserProfile: {
    operations: new Set(['update']),
    emitOn: new Set(['UPDATE']),
    idField: 'userId',
  },
});
```

Se o campo configurado não existir no registro, o `resourceId` sai vazio (`''`) e
um `warn` é logado, em vez de gravar a string literal `"undefined"`.

## eventType e prefixo (namespace)

O `eventType` segue `${prefix}${Model}${Created|Updated|Deleted}`. O `eventPrefix`
é opção da extension, default `'Audit.'` — ex.: `Audit.BrokerCreated`. Facilita o
filtro no consumidor (`startsWith('Audit.')`). Passe `eventPrefix: ''` para
desativar o namespace.

## Contrato do evento (payload)

```jsonc
{
  "operation": "CREATE | UPDATE | DELETE",
  "occurredAt": "2026-07-06T12:00:00.000Z",
  "actorId": "user-123 | null",
  "correlationId": "…",
  "changes": null,          // null em CREATE; { campo: { from, to } } em UPDATE (se diff on)
  "snapshot": { /* linha após a escrita (ou before em DELETE) */ }
}
```

## Guardas embutidas

- `createMany/updateMany/deleteMany` em model auditado → lança erro (não há
  "before" por linha).
- `prisma.$transaction([...])` (batch array) com model auditado → lança erro.
- A tabela de transporte (`outbox`) nunca deve entrar na config (evita recursão).
- Teste de consistência sugerido no CI de cada API:

```typescript
it('todo agregado auditável está registrado', () => {
  const faltando = listAuditableAggregates().filter((m) => !auditedModelsOf(config).has(m));
  expect(faltando).toEqual([]);
});
```

## Dependências

- `@prisma/client` como **peerDependency** (usa `Prisma.defineExtension`; o tipo
  do `tx` resolve para o client gerado do consumidor).
- Hooks de request do framework: `setContext` + `setCorrelationId` + `setUserId`
  (o `getAuditActor` lê `getHookUserId`/`getHookCorrelationId`).
