/**
 * The composition root — where the layers are wired together.
 *
 * This is the ONLY place that knows both the domain interfaces and the
 * concrete adapters. Everything else depends on the ports.
 *
 * It is also where the `IdentityProvider` seam is bound to its LOCAL
 * implementation. When Q-08 is answered and FCI supplies a directory, this
 * is the line that changes — plus one new adapter class.
 */
import { AuthenticationService } from '../domain/services/authentication-service.js';
import { SessionPolicy } from '../domain/services/session-policy.js';
import { SessionFactory } from '../domain/services/session-factory.js';
import { OperatorStampFactory } from '../domain/services/operator-stamp-factory.js';
import { CredentialService } from '../domain/services/credential-service.js';
import type { IdentityProvider } from '../domain/services/identity-provider.js';
import { LocalIdentityProvider } from './security/local-identity-provider.js';
import { Argon2SecretHasher } from './security/argon2-secret-hasher.js';
import { generateSessionToken } from './security/session-token-generator.js';
import {
  SqliteOperatorRepository,
} from './persistence/sqlite-operator-repository.js';
import {
  SqliteCredentialRepository,
} from './persistence/sqlite-credential-repository.js';
import {
  SqliteSessionRepository,
} from './persistence/sqlite-session-repository.js';
import { openDatabase, type SqliteDatabase } from './persistence/database.js';
import type { IdentityConfig } from './config/identity-config.js';

export interface IdentityModule {
  readonly db: SqliteDatabase;
  readonly authentication: AuthenticationService;
  readonly credentials: CredentialService;
  readonly operatorRepository: SqliteOperatorRepository;
  readonly credentialRepository: SqliteCredentialRepository;
  readonly sessionRepository: SqliteSessionRepository;
  readonly provider: IdentityProvider;
  close(): void;
}

export interface BuildIdentityOptions {
  readonly config: IdentityConfig;
  readonly clock?: () => Date;
  /** Override the provider — used by tests to exercise the Q-08 seam. */
  readonly provider?: IdentityProvider;
}

export function buildIdentityModule(
  options: BuildIdentityOptions,
): IdentityModule {
  const { config } = options;
  const clock = options.clock ?? (() => new Date());

  const db = openDatabase(config.databasePath);

  const operatorRepository = new SqliteOperatorRepository(db);
  const credentialRepository = new SqliteCredentialRepository(db);
  const sessionRepository = new SqliteSessionRepository(db);

  const hasher = new Argon2SecretHasher({
    memory: config.argon2Memory,
    passes: config.argon2Passes,
    parallelism: 1,
    tagLength: 32,
    saltLength: 16,
  });

  // ── THE Q-08 SEAM ──
  // Binding LOCAL here. Swapping in a DIRECTORY provider later changes
  // this line and adds one adapter class; nothing else in the system
  // changes.
  const provider =
    options.provider ??
    new LocalIdentityProvider(operatorRepository, credentialRepository, hasher);

  const policy = new SessionPolicy(clock);
  const stamps = new OperatorStampFactory();
  const sessionFactory = new SessionFactory(sessionRepository, generateSessionToken);

  const authentication = new AuthenticationService(
    provider,
    operatorRepository,
    sessionRepository,
    policy,
    stamps,
    sessionFactory,
    config.sessionLifetimeMs,
  );

  const credentials = new CredentialService(
    hasher,
    credentialRepository,
    clock,
  );

  return {
    db,
    authentication,
    credentials,
    operatorRepository,
    credentialRepository,
    sessionRepository,
    provider,
    close() {
      db.close();
    },
  };
}
