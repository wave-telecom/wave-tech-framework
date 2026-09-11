# @wave-tech/framework/auth

Integração com a **Wave Auth API**. Hoje cobre um passo: registrar, no deploy, o
catálogo de permissions que o serviço declara no próprio código.

## Por que fica aqui

O registro é a mesma operação em toda API que usa a Auth API — mesmo endpoint,
mesmo corpo, mesma política de erro. O que varia é só a lista de nomes. Sem um
util compartilhado, a décima aplicação inventa um `POST` com o corpo em outro
formato e descobre no primeiro 403 em produção.

## `registerPermissionCatalogue`

```ts
import { registerPermissionCatalogue } from '@wave-tech/framework/auth';

const { created, unchanged } = await registerPermissionCatalogue({
  authApiUrl: process.env.AUTH_API_URL,
  apiKey: process.env.AUTH_CATALOGUE_UPSERT_KEY,
  permissions: MY_PERMISSION_CATALOG,
});
```

Faz `PUT {authApiUrl}/permissions` com `{ permissions: [{ name }] }` e o header
`x-api-key`. A chave precisa ter `auth.permission.upsert`.

| Parâmetro | Obrigatório | Observação |
|---|---|---|
| `authApiUrl` | sim | Base da Auth API do ambiente, ex. `https://api.dev.acme.example/auth`. Barra final é normalizada. |
| `apiKey` | sim | API key gerenciada com `auth.permission.upsert`. |
| `permissions` | sim | Todos os nomes que o serviço declara. Lista vazia é recusada. |
| `timeoutMs` | não | Padrão 10 s. |

Retorna `{ created, unchanged }` — o que a chamada registrou e o que já existia.

**A chamada é idempotente**, porque o endpoint é: registra os nomes que faltam e
deixa o resto como está. Mandar a lista completa em todo deploy não cria nada
depois da primeira vez.

**Registrar não concede nada.** O nome passa a ser dizível; entregá-lo a um
broker (`POST /brokers/{broker}/permissions`) e emitir keys que o citam
continuam sendo passos operacionais, fora do pipeline.

### Falhas

Lança `Error` em três casos, todos antes de chegar na rede quando possível:

- `authApiUrl` ou `apiKey` vazios — um deploy job sem a variável pediria
  `undefined/permissions` ou tomaria um 401 opaco.
- `permissions` vazio — quase sempre um import quebrado, e o endpoint
  responderia 200 sem registrar nada.
- Resposta não-2xx — a mensagem carrega o status e o corpo, que é onde está o
  problem detail dizendo qual chave foi recusada ou qual nome o schema rejeitou.

O util **não loga**: quem chama decide o que imprimir. Num script de bootstrap a
saída vai para o Cloud Logging do projeto do tenant.

## Como usar no bootstrap

`wave-foundation-iac` roda `scripts/bootstrap.js` da imagem do módulo como
Cloud Run job depois de cada deploy — basta o arquivo existir na imagem, não há
nada a registrar no IaC. O script é um orquestrador fino:

```js
#!/usr/bin/env node
import { registerPermissionCatalogue } from '@wave-tech/framework/auth';
import { MY_PERMISSION_CATALOG } from '../dist/.../route-permissions.js';

const { created, unchanged } = await registerPermissionCatalogue({
  authApiUrl: process.env.AUTH_API_URL,
  apiKey: process.env.AUTH_CATALOGUE_UPSERT_KEY,
  permissions: MY_PERMISSION_CATALOG,
});

console.log(`Permission catalogue: ${created.length} created, ${unchanged.length} unchanged`);
```

O catálogo deve vir da **mesma fonte que o serviço usa para autorizar** — o
registro rota → permission — e nunca de uma lista escrita à mão, que divergiria.
