/**
 * Seed the local operator directory.
 *
 * The workbook's Rule 5 says dummy integrations are real development
 * artefacts and no fake data should be hard-coded into the UI. Identity is
 * different from the OrgaTEX/scale/scanner/printer dummies: it is a LOCAL
 * concern, so the honest way to make it demonstrable is to seed the real
 * credential store — not to have the UI fall back to a hard-coded operator.
 *
 * Usage:
 *   npx tsx scripts/seed-identity.ts
 *
 * The PINs are development credentials for a local training build. They are
 * printed once, at seed time, and are never stored in plaintext.
 */
import {
  buildIdentityModule,
} from '../src/008-operator-identity/infrastructure/composition-root.js';
import { loadIdentityConfig } from '../src/008-operator-identity/infrastructure/config/identity-config.js';
import { OperatorId } from '../src/008-operator-identity/domain/value-objects/operator-id.js';
import { OperatorRole } from '../src/008-operator-identity/domain/value-objects/operator-role.js';
import { Operator } from '../src/008-operator-identity/domain/entities/operator.js';

interface SeedOperator {
  id: string;
  displayName: string;
  role: 'OPERATOR' | 'SUPERVISOR';
  secret: string;
}

const SEED_OPERATORS: readonly SeedOperator[] = [
  {
    id: 'OP-001',
    displayName: 'R. Karim',
    role: 'OPERATOR',
    secret: '4821',
  },
  {
    id: 'OP-002',
    displayName: 'T. Haque',
    role: 'OPERATOR',
    secret: '7359',
  },
  {
    id: 'SUP-001',
    displayName: 'S. Ahmed',
    role: 'SUPERVISOR',
    secret: '9164',
  },
];

async function main(): Promise<void> {
  const config = loadIdentityConfig();
  const identity = buildIdentityModule({ config });

  try {
    for (const seed of SEED_OPERATORS) {
      const operatorId = OperatorId.create(seed.id);
      const existing = await identity.operatorRepository.findById(operatorId);

      const operator = new Operator(
        operatorId,
        seed.displayName,
        seed.role === 'SUPERVISOR'
          ? OperatorRole.supervisor()
          : OperatorRole.operator(),
        true,
        new Date(),
      );

      if (existing === null) {
        await identity.operatorRepository.save(operator);
        console.log(`created operator ${seed.id} (${seed.displayName})`);
      } else {
        console.log(`operator ${seed.id} already exists — leaving untouched`);
      }

      const credentials = await identity.credentialRepository.findByOperator(
        operatorId,
      );
      if (credentials.length === 0) {
        await identity.credentials.create(
          operatorId,
          operator.role,
          seed.secret,
        );
        console.log(`  credential created (hashed, Argon2id)`);
      } else {
        console.log(`  credential already exists — leaving untouched`);
      }
    }

    console.log('\nLocal operator directory seeded.');
    console.log('Development credentials (PINs are stored hashed, never in plaintext):');
    for (const seed of SEED_OPERATORS) {
      console.log(`  ${seed.id.padEnd(9)} ${seed.displayName.padEnd(14)} ${seed.role.padEnd(11)} PIN ${seed.secret}`);
    }
  } finally {
    identity.close();
  }
}

main().catch((e: unknown) => {
  console.error('Seeding failed:', e);
  process.exit(1);
});
