# @wave-tech/framework/auth

Integration with the **Wave Auth API**. Today it covers one step: registering,
at deploy time, the permission catalogue a service declares in its own code.

## Why it lives here

The registration is the same operation in every API that authorises against the
Auth API — same endpoint, same body, same error policy. Only the list of names
differs. Left to each service, the tenth one invents a `POST` with another body
shape and finds out on the first 403 in production.

## `registerPermissionCatalogue`

```ts
import { registerPermissionCatalogue } from '@wave-tech/framework/auth';

const { created, unchanged } = await registerPermissionCatalogue({
  authApiUrl: process.env.AUTH_API_URL,
  apiKey: process.env.AUTH_CATALOGUE_UPSERT_KEY,
  permissions: MY_PERMISSION_CATALOG,
});
```

Sends `PUT {authApiUrl}/permissions` with `{ permissions: [{ name }] }` and the
`x-api-key` header. The key must hold `auth.permission.upsert`.

| Parameter | Required | Notes |
|---|---|---|
| `authApiUrl` | yes | The environment's Auth API base, e.g. `https://api.dev.acme.example/auth`. A trailing slash is normalised. |
| `apiKey` | yes | Managed API key holding `auth.permission.upsert`. |
| `permissions` | yes | Every name the service declares. An empty list is refused. |
| `timeoutMs` | no | Defaults to 10 s. |

Returns `{ created, unchanged }` — what the call registered, and what was
already there.

**The call is idempotent**, because the endpoint is: it registers the names the
registry is missing and leaves the rest as they are. Sending the full list on
every deploy creates nothing after the first.

**Registering grants nothing.** The name becomes sayable; handing it to a broker
(`POST /brokers/{broker}/permissions`) and minting keys that name it stay
operational steps, outside any pipeline.

### Failures

Throws an `Error` in three cases, each before reaching the network where it can:

- empty `authApiUrl` or `apiKey` — a deploy job missing the variable would
  otherwise request `undefined/permissions`, or take an opaque 401.
- empty `permissions` — almost always a broken import, and the endpoint would
  answer 200 having registered nothing.
- a non-2xx response — the message carries the status and the body, which is
  where the problem detail says which key was refused or which name the schema
  rejected.

It deliberately **does not log**: the caller decides what to print. In a
bootstrap script that output goes to the tenant project's Cloud Logging.

## Using it from a bootstrap script

`wave-foundation-iac` runs a module's `scripts/bootstrap.js` from its image as a
Cloud Run job after each deploy — the file existing in the image is the whole
opt-in, with nothing to register on the IaC side. The script is a thin
orchestrator:

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

The catalogue must come from the **same source the service authorises against**
— its route → permission registry — and never from a hand-written list, which
would drift.
