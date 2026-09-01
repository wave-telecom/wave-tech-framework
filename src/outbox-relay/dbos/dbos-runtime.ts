import { DBOS } from '@dbos-inc/dbos-sdk';
import { Logger } from '../../core/logger';

export interface DbosRuntimeConfig {
  /** Application name — namespaces workflows in the system database. */
  name: string;
  /**
   * Recovery boundary: pending workflows are resumed only by executors of the
   * same version. LEAVE UNSET in services — DBOS then derives it by hashing
   * the registered workflow code, so recovery crosses deploys that did not
   * change a workflow and stops (by design) at deploys that did, identically
   * on any runtime. Setting a per-deploy value (K_REVISION, image tag) would
   * orphan a drain interrupted mid-rollout. Override only in tests.
   */
  applicationVersion?: string;
  /**
   * Postgres URL for the DBOS system database — a database DEDICATED to DBOS,
   * never the app database itself (keeps workflow state out of app
   * backups/truncates/migrations). Naming it is the module's responsibility,
   * following whatever convention its platform provisions (at Wave,
   * `<app db>_dbos_sys` on the same instance — see wave-foundation-iac).
   */
  systemDatabaseUrl: string;
  /** Kept small on purpose: this pool is billed per replica. */
  systemDatabasePoolSize?: number;
  /**
   * Serve the DBOS admin HTTP server. Default false: it would open a second
   * port unwanted in single-port runtimes such as Cloud Run.
   */
  runAdminServer?: boolean;
}

/**
 * Starts the durable workflow engine. Must be called after every workflow,
 * queue and schedule handler has been registered and before the HTTP server
 * starts listening: DBOS resolves its registry at launch, and launching also
 * resumes workflows a previous process of the same version left mid-flight.
 */
export async function launchDbos(config: DbosRuntimeConfig): Promise<void> {
  DBOS.setConfig({
    name: config.name,
    // Unset → DBOS derives the version from a hash of the workflow code.
    ...(config.applicationVersion !== undefined
      ? { applicationVersion: config.applicationVersion }
      : {}),
    systemDatabaseUrl: config.systemDatabaseUrl,
    systemDatabasePoolSize: config.systemDatabasePoolSize ?? 4,
    runAdminServer: config.runAdminServer ?? false,
  });
  await DBOS.launch();
  Logger.info('[DbosRuntime] DBOS launched', {
    data: { applicationVersion: config.applicationVersion ?? 'derived from workflow code' },
  });
}

export async function shutdownDbos(): Promise<void> {
  await DBOS.shutdown();
  Logger.info('[DbosRuntime] DBOS shut down');
}

/**
 * Builds a Postgres URL from the discrete connection settings the app already
 * holds. Naming the system database is the module's responsibility — pass the
 * full name of the dedicated database your platform provisions for DBOS.
 */
export function buildPostgresUrl(params: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}): string {
  const user = encodeURIComponent(params.user);
  const password = encodeURIComponent(params.password);
  return `postgresql://${user}:${password}@${params.host}:${params.port}/${params.database}`;
}

