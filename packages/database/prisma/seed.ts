/**
 * RuangNode development seed.
 *
 * Run with: `pnpm --filter @ruangnode/database db:seed`
 * (or `prisma db seed` from `packages/database`).
 *
 * Scope and safety rules:
 *   - development/test data only; the script refuses to run when
 *     NODE_ENV=production
 *   - catalog data only: resource profiles, products and product variants
 *   - no credentials, API keys, passwords, node registrations or payment data
 *     are ever seeded, so nothing in this file is secret
 *   - idempotent: every row is upserted on its natural key, so running the seed
 *     repeatedly converges to the same state
 *
 * Resource values mirror the documented examples in docs/RESOURCE_ISOLATION.md.
 */
import { createDatabaseClient } from '../src/client.js';
import { databaseUrlFromEnv, loadEnvironmentFiles } from '../src/config.js';

const MEBIBYTE = 1024n * 1024n;
const GIBIBYTE = 1024n * MEBIBYTE;

/** ISO 4217 code used by the seeded catalog. */
const CURRENCY = 'IDR';

const RESOURCE_PROFILES = [
  {
    name: 'STARTER',
    cpuLimit: 1000,
    memoryLimitBytes: 1n * GIBIBYTE,
    memorySwapBytes: null,
    memorySwapPolicy: 'EQUAL_TO_MEMORY',
    diskLimitBytes: 5n * GIBIBYTE,
    diskPolicy: 'ALLOCATED',
    pidsLimit: 256,
    networkPolicy: 'UNMETERED',
    description: '1 vCPU, 1 GiB RAM, 5 GiB disk, 256 PIDs.',
    active: true,
  },
  {
    name: 'PRO',
    cpuLimit: 2000,
    memoryLimitBytes: 2n * GIBIBYTE,
    memorySwapBytes: null,
    memorySwapPolicy: 'EQUAL_TO_MEMORY',
    diskLimitBytes: 10n * GIBIBYTE,
    diskPolicy: 'ALLOCATED',
    pidsLimit: 512,
    networkPolicy: 'UNMETERED',
    description: '2 vCPU, 2 GiB RAM, 10 GiB disk, 512 PIDs.',
    active: true,
  },
  {
    name: 'POWER',
    cpuLimit: 4000,
    memoryLimitBytes: 8n * GIBIBYTE,
    memorySwapBytes: null,
    memorySwapPolicy: 'EQUAL_TO_MEMORY',
    diskLimitBytes: 30n * GIBIBYTE,
    diskPolicy: 'ALLOCATED',
    pidsLimit: 1024,
    networkPolicy: 'UNMETERED',
    description: '4 vCPU, 8 GiB RAM, 30 GiB disk, 1024 PIDs.',
    active: true,
  },
] as const;

const CATALOG = [
  {
    product: {
      slug: 'hermes-managed',
      name: 'Hermes Agent (Managed)',
      description: 'Managed Hermes Agent instance on isolated RuangNode capacity.',
      type: 'MANAGED_SERVICE',
      serviceType: 'hermes',
      status: 'ACTIVE',
    },
    variants: [
      {
        sku: 'HERMES-STARTER',
        name: 'Starter',
        price: 149_000n,
        billingPeriod: 'MONTHLY',
        resourceProfile: 'STARTER',
        storageQuota: 5n * GIBIBYTE,
      },
      {
        sku: 'HERMES-PRO',
        name: 'Pro',
        price: 299_000n,
        billingPeriod: 'MONTHLY',
        resourceProfile: 'PRO',
        storageQuota: 10n * GIBIBYTE,
      },
      {
        sku: 'HERMES-POWER',
        name: 'Power',
        price: 749_000n,
        billingPeriod: 'MONTHLY',
        resourceProfile: 'POWER',
        storageQuota: 30n * GIBIBYTE,
      },
    ],
  },
  {
    product: {
      slug: 'digital-starter-kit',
      name: 'RuangNode Digital Starter Kit',
      description: 'Downloadable starter assets for self-hosted deployments.',
      type: 'DIGITAL',
      serviceType: null,
      status: 'ACTIVE',
    },
    variants: [
      {
        sku: 'KIT-STARTER-001',
        name: 'Single licence',
        price: 99_000n,
        billingPeriod: 'ONE_TIME',
        resourceProfile: null,
        storageQuota: 512n * MEBIBYTE,
      },
    ],
  },
] as const;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed: the development seed must never run in production.');
  }

  loadEnvironmentFiles();

  const prisma = createDatabaseClient({ connectionString: databaseUrlFromEnv() });

  try {
    const profileIds = new Map<string, string>();

    for (const profile of RESOURCE_PROFILES) {
      const record = await prisma.resourceProfile.upsert({
        where: { name: profile.name },
        create: { ...profile },
        update: { ...profile },
      });

      profileIds.set(profile.name, record.id);
    }

    for (const entry of CATALOG) {
      const product = await prisma.product.upsert({
        where: { slug: entry.product.slug },
        create: { ...entry.product },
        update: { ...entry.product },
      });

      for (const variant of entry.variants) {
        const { resourceProfile, ...fields } = variant;
        const resourceProfileId =
          resourceProfile === null ? null : (profileIds.get(resourceProfile) ?? null);

        if (resourceProfile !== null && resourceProfileId === null) {
          throw new Error(`Seed data references an unknown resource profile: ${resourceProfile}`);
        }

        const data = { ...fields, productId: product.id, resourceProfileId, currency: CURRENCY };

        await prisma.productVariant.upsert({
          where: { sku: variant.sku },
          create: data,
          update: data,
        });
      }
    }

    console.log(
      `Seeded ${RESOURCE_PROFILES.length} resource profiles and ` +
        `${CATALOG.length} products (catalog data only, no credentials).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

await main();
