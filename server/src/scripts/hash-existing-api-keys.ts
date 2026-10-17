/**
 * Migration script: Hashes any plaintext API keys currently stored in the database.
 *
 * Dry run (default, read-only):
 *   npx tsx src/scripts/hash-existing-api-keys.ts
 * Apply:
 *   npx tsx src/scripts/hash-existing-api-keys.ts --apply
 */
import { prisma } from '../config/prisma';
import { hashApiKey, isHashedApiKey } from '../utils/apiKey';

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`[hash-existing-api-keys] Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  const apiKeys = await prisma.apiKey.findMany();
  console.log(`[hash-existing-api-keys] Found ${apiKeys.length} total API key records in database.`);

  let alreadyHashed = 0;
  let migrated = 0;

  for (const record of apiKeys) {
    if (isHashedApiKey(record.key)) {
      alreadyHashed++;
      continue;
    }

    const hashed = hashApiKey(record.key);
    console.log(`  - Record ${record.id} ("${record.name}") is plaintext (${record.key.slice(0, 6)}...). New SHA-256 hash: ${hashed.slice(0, 8)}...`);

    if (APPLY) {
      await prisma.apiKey.update({
        where: { id: record.id },
        data: { key: hashed },
      });
    }
    migrated++;
  }

  console.log(`\nSummary:`);
  console.log(`  Already hashed: ${alreadyHashed}`);
  console.log(`  ${APPLY ? 'Migrated to SHA-256' : 'Needs migration'}: ${migrated}`);
  if (!APPLY && migrated > 0) {
    console.log(`\nRun with --apply to write these hashed keys to the database.`);
  }
}

main()
  .catch((err) => {
    console.error('[hash-existing-api-keys] Error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
