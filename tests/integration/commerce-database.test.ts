import { createDatabaseClient, type PrismaClient } from '@ruangnode/database';
import {
  createPrismaCommerceStore,
  type CommerceStore,
  type CreateOrderData,
} from '@ruangnode/services';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startEmbeddedPostgres, type EmbeddedPostgres } from '../support/embedded-postgres.js';

const TEST_TIMEOUT_MS = 30_000;

let database: EmbeddedPostgres;
let prisma: PrismaClient;
let store: CommerceStore;

beforeAll(async () => {
  database = await startEmbeddedPostgres();
  prisma = createDatabaseClient({ connectionString: database.url });
  store = createPrismaCommerceStore(prisma);
}, TEST_TIMEOUT_MS);

afterAll(async () => {
  await prisma?.$disconnect();
  await database?.stop();
});

function profileData(name: string) {
  return {
    name,
    cpuLimitMillicores: 1000,
    memoryLimitBytes: 536_870_912n,
    memorySwapPolicy: 'EQUAL_TO_MEMORY' as const,
    memorySwapBytes: null,
    diskLimitBytes: 10_737_418_240n,
    diskPolicy: 'ALLOCATED' as const,
    pidsLimit: 256,
    networkPolicy: null,
    description: null,
    active: true,
  };
}

describe('Prisma commerce adapter over PostgreSQL', () => {
  it(
    'round-trips BigInt, nullable JSON and nested order snapshots',
    async () => {
      const user = await prisma.user.create({
        data: { email: 'commerce-adapter@example.com' },
      });
      const product = await store.products.create({
        slug: 'adapter-digital',
        name: 'Adapter Digital',
        description: null,
        type: 'DIGITAL',
        serviceType: null,
        status: 'ACTIVE',
      });
      const variant = await store.variants.create({
        productId: product.id,
        name: 'Download',
        sku: 'ADAPTER-DOWNLOAD',
        priceMinor: 149_001n,
        currency: 'IDR',
        billingPeriod: 'ONE_TIME',
        resourceProfileId: null,
        storageQuotaBytes: null,
        configurationSchema: null,
        status: 'ACTIVE',
      });

      const orderData: CreateOrderData = {
        userId: user.id,
        status: 'PENDING',
        currency: 'IDR',
        subtotalMinor: 298_002n,
        discountMinor: 0n,
        totalMinor: 298_002n,
        expiresAt: null,
        items: [
          {
            productVariantId: variant.id,
            quantity: 2,
            unitPriceMinor: 149_001n,
            totalPriceMinor: 298_002n,
            metadataSnapshot: {
              snapshotVersion: 1,
              capturedAt: '2026-10-01T00:00:00.000Z',
              product: {
                id: product.id,
                slug: product.slug,
                name: product.name,
                type: product.type,
                serviceType: product.serviceType,
              },
              variant: {
                id: variant.id,
                name: variant.name,
                sku: variant.sku,
                billingPeriod: variant.billingPeriod,
                currency: variant.currency,
                unitPriceMinor: '149001',
              },
              resourceProfile: null,
              storageQuotaBytes: null,
            },
          },
        ],
      };

      const order = await store.orders.create(orderData);
      const rawVariant = await prisma.productVariant.findUniqueOrThrow({
        where: { id: variant.id },
      });
      const rawOrder = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { items: true },
      });

      expect(rawVariant.price).toBe(149_001n);
      expect(rawVariant.storageQuota).toBeNull();
      expect(rawVariant.configurationSchema).toBeNull();
      expect(rawOrder.subtotal).toBe(298_002n);
      expect(rawOrder.items[0]?.totalPrice).toBe(298_002n);
      expect(rawOrder.items[0]?.metadataSnapshot).toMatchObject({ snapshotVersion: 1 });
      expect((await store.orders.findById(order.id))?.items[0]?.unitPriceMinor).toBe(149_001n);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'rolls back all writes when an order transaction fails',
    async () => {
      const productId = await (async () => {
        try {
          return await store.transaction(async (transaction) => {
            const product = await transaction.products.create({
              slug: 'rolled-back-product',
              name: 'Rolled Back',
              description: null,
              type: 'DIGITAL',
              serviceType: null,
              status: 'DRAFT',
            });

            throw new Error(`rollback-${product.id}`);
          });
        } catch {
          return 'rolled-back-product';
        }
      })();

      expect(await prisma.product.findUnique({ where: { slug: productId } })).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'enforces restricted resource-profile references in PostgreSQL',
    async () => {
      const profile = await store.resourceProfiles.create(profileData('ADAPTER-PROFILE'));
      const product = await store.products.create({
        slug: 'adapter-managed',
        name: 'Adapter Managed',
        description: null,
        type: 'MANAGED_SERVICE',
        serviceType: 'hermes',
        status: 'DRAFT',
      });
      await store.variants.create({
        productId: product.id,
        name: 'Managed plan',
        sku: 'ADAPTER-MANAGED',
        priceMinor: 40_000n,
        currency: 'IDR',
        billingPeriod: 'MONTHLY',
        resourceProfileId: profile.id,
        storageQuotaBytes: null,
        configurationSchema: null,
        status: 'DRAFT',
      });

      await expect(prisma.resourceProfile.delete({ where: { id: profile.id } })).rejects.toThrow();
    },
    TEST_TIMEOUT_MS,
  );
});
