export * from './outbox-relay-dbos';
// The durable engine moved to `@wave-tech/framework/dbos`, where a service with
// no outbox relay can import it. Re-exported so existing consumers keep working.
export * from '../../dbos/dbos-runtime';
