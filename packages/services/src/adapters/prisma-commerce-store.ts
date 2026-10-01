/**
 * Prisma-backed implementation of the commerce store.
 *
 * This is the production persistence path and the only module in
 * `@ruangnode/services` that knows about Prisma. It maps rows onto the domain
 * records, so no generated model type ever leaves this file
 * (`.clinerules` → API: never expose raw Prisma models).
 *
 * Invariants enforced here:
 *   - a duplicate slug/SKU/name surfaces as the same structured conflict error
 *     the service pre-checks for, because the unique index is the real guard
 *   - an `update` returns `null` when the row disappeared, instead of throwing a
 *     driver error into the service
 *   - `updateStatus` is a compare-and-swap inside `updateMany`, so a concurrent
 *     transition cannot overwrite a newer state
 *   - an order and its lines are written in one nested create
 *   - money stays `BigInt` from the database to the domain: nothing is converted
 *     to a JavaScript number
 */
import { Prisma, type PrismaClient } from '@ruangnode/database';

import type { ProductRecord, ProductVariantRecord } from '../catalog/types.js';
import { duplicateProductSlugError, duplicateVariantSkuError } from '../errors.js';
import type { OrderItemMetadataSnapshot, OrderRecord, OrderStatus } from '../orders/types.js';
import { isOrderItemSnapshot } from '../orders/serialization.js';
import type {
  CommerceStore,
  CreateOrderData,
  OrderRepository,
  ProductListFilter,
  ProductRepository,
  ProductVariantRepository,
  ProductWriteData,
  ResourceProfileRepository,
  ResourceProfileListFilter,
  ResourceProfileWriteData,
  VariantListFilter,
  VariantWriteData,
} from '../ports.js';
import type { ResourceProfileRecord } from '../resources/types.js';

/** Either the root client or an interactive-transaction client. */
type PrismaLike = PrismaClient | Prisma.TransactionClient;

/** True for a PostgreSQL unique-constraint violation reported by Prisma. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/** True when an update/delete targeted a row that no longer exists. */
function isMissingRow(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2025'
  );
}

/** SQL `NULL` for a nullable JSON column (`Prisma.JsonNull` would store JSON null). */
function jsonColumn(value: unknown): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  if (value === undefined || value === null) {
    return Prisma.DbNull;
  }

  return value as Prisma.InputJsonValue;
}

/** Row shapes this adapter relies on (structural, so no model imports). */
interface ProductRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  type: ProductRecord['type'];
  status: ProductRecord['status'];
  serviceType: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface VariantRow {
  id: string;
  productId: string;
  name: string;
  sku: string;
  price: bigint;
  currency: string;
  billingPeriod: ProductVariantRecord['billingPeriod'];
  resourceProfileId: string | null;
  /** Prisma column name in the schema is `storageQuota`. */
  storageQuota: bigint | null;
  configurationSchema: unknown;
  status: ProductVariantRecord['status'];
  createdAt: Date;
  updatedAt: Date;
}

interface ResourceProfileRow {
  id: string;
  name: string;
  cpuLimit: number;
  memoryLimitBytes: bigint;
  memorySwapBytes: bigint | null;
  memorySwapPolicy: ResourceProfileRecord['memorySwapPolicy'];
  diskLimitBytes: bigint;
  diskPolicy: ResourceProfileRecord['diskPolicy'];
  pidsLimit: number;
  networkPolicy: string | null;
  description: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface OrderItemRow {
  id: string;
  orderId: string;
  productVariantId: string;
  quantity: number;
  unitPrice: bigint;
  totalPrice: bigint;
  metadataSnapshot: unknown;
}

interface OrderRow {
  id: string;
  userId: string;
  status: OrderStatus;
  currency: string;
  subtotal: bigint;
  discount: bigint;
  total: bigint;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items: OrderItemRow[];
}

function toProductRecord(row: ProductRow): ProductRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    type: row.type,
    status: row.status,
    serviceType: row.serviceType,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toVariantRecord(row: VariantRow): ProductVariantRecord {
  return {
    id: row.id,
    productId: row.productId,
    name: row.name,
    sku: row.sku,
    priceMinor: row.price,
    currency: row.currency,
    billingPeriod: row.billingPeriod,
    resourceProfileId: row.resourceProfileId,
    storageQuotaBytes: row.storageQuota,
    configurationSchema: row.configurationSchema ?? null,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toResourceProfileRecord(row: ResourceProfileRow): ResourceProfileRecord {
  return {
    id: row.id,
    name: row.name,
    cpuLimitMillicores: row.cpuLimit,
    memoryLimitBytes: row.memoryLimitBytes,
    memorySwapBytes: row.memorySwapBytes,
    memorySwapPolicy: row.memorySwapPolicy,
    diskLimitBytes: row.diskLimitBytes,
    diskPolicy: row.diskPolicy,
    pidsLimit: row.pidsLimit,
    networkPolicy: row.networkPolicy,
    description: row.description,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Reads back the snapshot that was written with the order.
 *
 * A malformed snapshot is an invariant violation, not a user error: it throws so
 * the request fails as an internal error instead of returning a half-empty order.
 */
function toSnapshot(value: unknown): OrderItemMetadataSnapshot {
  if (isOrderItemSnapshot(value)) {
    return value;
  }

  throw new Error('Stored order item metadata snapshot is malformed.');
}

function toOrderRecord(row: OrderRow): OrderRecord {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    currency: row.currency,
    subtotalMinor: row.subtotal,
    discountMinor: row.discount,
    totalMinor: row.total,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    items: row.items.map((item) => ({
      id: item.id,
      orderId: item.orderId,
      productVariantId: item.productVariantId,
      quantity: item.quantity,
      unitPriceMinor: item.unitPrice,
      totalPriceMinor: item.totalPrice,
      metadataSnapshot: toSnapshot(item.metadataSnapshot),
    })),
  };
}

function buildProducts(client: PrismaLike): ProductRepository {
  const where = (filter: ProductListFilter | undefined) => ({
    ...(filter?.statuses === undefined ? {} : { status: { in: [...filter.statuses] } }),
    ...(filter?.type === undefined ? {} : { type: filter.type }),
    ...(filter?.serviceType === undefined ? {} : { serviceType: filter.serviceType }),
  });

  return {
    async list(filter?: ProductListFilter): Promise<ProductRecord[]> {
      const rows = await client.product.findMany({
        where: where(filter),
        orderBy: { createdAt: 'desc' },
        ...(filter?.limit === undefined ? {} : { take: filter.limit }),
        ...(filter?.offset === undefined ? {} : { skip: filter.offset }),
      });

      return rows.map(toProductRecord);
    },

    async findById(id: string): Promise<ProductRecord | null> {
      const row = await client.product.findUnique({ where: { id } });

      return row === null ? null : toProductRecord(row);
    },

    async findBySlug(slug: string): Promise<ProductRecord | null> {
      const row = await client.product.findUnique({ where: { slug } });

      return row === null ? null : toProductRecord(row);
    },

    async create(data: ProductWriteData): Promise<ProductRecord> {
      try {
        const row = await client.product.create({ data });

        return toProductRecord(row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw duplicateProductSlugError();
        }

        throw error;
      }
    },

    async update(id: string, data: Partial<ProductWriteData>): Promise<ProductRecord | null> {
      try {
        const row = await client.product.update({ where: { id }, data });

        return toProductRecord(row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw duplicateProductSlugError();
        }

        if (isMissingRow(error)) {
          return null;
        }

        throw error;
      }
    },
  };
}
function buildVariants(client: PrismaLike): ProductVariantRepository {
  const where = (filter: VariantListFilter | undefined) => ({
    ...(filter?.productId === undefined ? {} : { productId: filter.productId }),
    ...(filter?.productIds === undefined ? {} : { productId: { in: [...filter.productIds] } }),
    ...(filter?.resourceProfileId === undefined
      ? {}
      : { resourceProfileId: filter.resourceProfileId }),
    ...(filter?.statuses === undefined ? {} : { status: { in: [...filter.statuses] } }),
  });

  return {
    async list(filter?: VariantListFilter): Promise<ProductVariantRecord[]> {
      const rows = await client.productVariant.findMany({
        where: where(filter),
        orderBy: { createdAt: 'asc' },
        ...(filter?.limit === undefined ? {} : { take: filter.limit }),
      });

      return rows.map(toVariantRecord);
    },

    async findById(id: string): Promise<ProductVariantRecord | null> {
      const row = await client.productVariant.findUnique({ where: { id } });

      return row === null ? null : toVariantRecord(row);
    },

    async findBySku(sku: string): Promise<ProductVariantRecord | null> {
      const row = await client.productVariant.findUnique({ where: { sku } });

      return row === null ? null : toVariantRecord(row);
    },

    async create(data: VariantWriteData): Promise<ProductVariantRecord> {
      try {
        const row = await client.productVariant.create({
          data: {
            productId: data.productId,
            name: data.name,
            sku: data.sku,
            price: data.priceMinor,
            currency: data.currency,
            billingPeriod: data.billingPeriod,
            resourceProfileId: data.resourceProfileId,
            storageQuota: data.storageQuotaBytes,
            configurationSchema: jsonColumn(data.configurationSchema),
            status: data.status,
          },
        });

        return toVariantRecord(row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw duplicateVariantSkuError();
        }

        throw error;
      }
    },

    async update(
      id: string,
      data: Partial<VariantWriteData>,
    ): Promise<ProductVariantRecord | null> {
      try {
        const row = await client.productVariant.update({
          where: { id },
          data: {
            ...(data.name === undefined ? {} : { name: data.name }),
            ...(data.sku === undefined ? {} : { sku: data.sku }),
            ...(data.priceMinor === undefined ? {} : { price: data.priceMinor }),
            ...(data.currency === undefined ? {} : { currency: data.currency }),
            ...(data.billingPeriod === undefined ? {} : { billingPeriod: data.billingPeriod }),
            ...(data.resourceProfileId === undefined
              ? {}
              : { resourceProfileId: data.resourceProfileId }),
            ...(data.storageQuotaBytes === undefined
              ? {}
              : { storageQuota: data.storageQuotaBytes }),
            ...(data.configurationSchema === undefined
              ? {}
              : { configurationSchema: jsonColumn(data.configurationSchema) }),
            ...(data.status === undefined ? {} : { status: data.status }),
          },
        });

        return toVariantRecord(row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw duplicateVariantSkuError();
        }

        if (isMissingRow(error)) {
          return null;
        }

        throw error;
      }
    },
  };
}



function buildOrders(client: PrismaLike): OrderRepository {
  return {
    async listForUser(userId: string, options): Promise<OrderRecord[]> {
      const rows = await client.order.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: { items: true },
        ...(options?.limit === undefined ? {} : { take: options.limit }),
        ...(options?.offset === undefined ? {} : { skip: options.offset }),
      });

      return rows.map(toOrderRecord);
    },

    async findById(orderId: string): Promise<OrderRecord | null> {
      const row = await client.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      return row === null ? null : toOrderRecord(row);
    },

    async findByIdForUser(userId: string, orderId: string): Promise<OrderRecord | null> {
      const row = await client.order.findFirst({
        where: { id: orderId, userId },
        include: { items: true },
      });

      return row === null ? null : toOrderRecord(row);
    },

    async findOwnerUserId(orderId: string): Promise<string | null> {
      const row = await client.order.findUnique({
        where: { id: orderId },
        select: { userId: true },
      });

      return row === null ? null : row.userId;
    },

    async create(data: CreateOrderData): Promise<OrderRecord> {
      const row = await client.order.create({
        data: {
          userId: data.userId,
          status: data.status,
          currency: data.currency,
          subtotal: data.subtotalMinor,
          discount: data.discountMinor,
          total: data.totalMinor,
          expiresAt: data.expiresAt,
          // The order and its lines are one statement: either both exist or neither.
          items: {
            create: data.items.map((item) => ({
              productVariantId: item.productVariantId,
              quantity: item.quantity,
              unitPrice: item.unitPriceMinor,
              totalPrice: item.totalPriceMinor,
              metadataSnapshot: item.metadataSnapshot as unknown as Prisma.InputJsonValue,
            })),
          },
        },
        include: { items: true },
      });

      return toOrderRecord(row);
    },

    async updateStatus(orderId: string, from: OrderStatus, to: OrderStatus): Promise<boolean> {
      // Compare-and-swap: only one writer can move an order out of `from`.
      const result = await client.order.updateMany({
        where: { id: orderId, status: from },
        data: { status: to },
      });

      return result.count === 1;
    },
  };
}

/**
 * Creates the production commerce store.
 *
 * The returned store is the only thing the services see. `transaction` binds a
 * store to one database transaction; a nested call reuses that transaction
 * instead of trying to open a second one.
 */
export function createPrismaCommerceStore(prisma: PrismaClient): CommerceStore {
  return buildStore(prisma, (work) =>
    prisma.$transaction(async (tx) => {
      const scoped = buildStore(tx, (nested) => nested(scoped));

      return work(scoped);
    }),
  );
}

function buildStore(client: PrismaLike, transaction: CommerceStore['transaction']): CommerceStore {
  return {
    products: buildProducts(client),
    variants: buildVariants(client),
    resourceProfiles: buildResourceProfiles(client),
    orders: buildOrders(client),
    transaction,
  };
}
function buildResourceProfiles(client: PrismaLike): ResourceProfileRepository {
  return {
    async list(filter?: ResourceProfileListFilter): Promise<ResourceProfileRecord[]> {
      const rows = await client.resourceProfile.findMany({
        where: {
          ...(filter?.includeInactive === true ? {} : { active: true }),
          ...(filter?.ids === undefined ? {} : { id: { in: [...filter.ids] } }),
        },
        orderBy: { name: 'asc' },
      });

      return rows.map(toResourceProfileRecord);
    },

    async findById(id: string): Promise<ResourceProfileRecord | null> {
      const row = await client.resourceProfile.findUnique({ where: { id } });

      return row === null ? null : toResourceProfileRecord(row);
    },

    async findByName(name: string): Promise<ResourceProfileRecord | null> {
      const row = await client.resourceProfile.findUnique({ where: { name } });

      return row === null ? null : toResourceProfileRecord(row);
    },

    async create(data: ResourceProfileWriteData): Promise<ResourceProfileRecord> {
      // The schema column is `cpuLimit` (millicores); the domain name is explicit.
      const row = await client.resourceProfile.create({
        data: {
          name: data.name,
          cpuLimit: data.cpuLimitMillicores,
          memoryLimitBytes: data.memoryLimitBytes,
          memorySwapPolicy: data.memorySwapPolicy,
          memorySwapBytes: data.memorySwapBytes,
          diskLimitBytes: data.diskLimitBytes,
          diskPolicy: data.diskPolicy,
          pidsLimit: data.pidsLimit,
          networkPolicy: data.networkPolicy,
          description: data.description,
          active: data.active,
        },
      });

      return toResourceProfileRecord(row);
    },

    async update(
      id: string,
      data: Partial<ResourceProfileWriteData>,
    ): Promise<ResourceProfileRecord | null> {
      try {
        const row = await client.resourceProfile.update({
          where: { id },
          data: {
            ...(data.name === undefined ? {} : { name: data.name }),
            ...(data.cpuLimitMillicores === undefined
              ? {}
              : { cpuLimit: data.cpuLimitMillicores }),
            ...(data.memoryLimitBytes === undefined
              ? {}
              : { memoryLimitBytes: data.memoryLimitBytes }),
            ...(data.memorySwapPolicy === undefined
              ? {}
              : { memorySwapPolicy: data.memorySwapPolicy }),
            ...(data.memorySwapBytes === undefined
              ? {}
              : { memorySwapBytes: data.memorySwapBytes }),
            ...(data.diskLimitBytes === undefined
              ? {}
              : { diskLimitBytes: data.diskLimitBytes }),
            ...(data.diskPolicy === undefined ? {} : { diskPolicy: data.diskPolicy }),
            ...(data.pidsLimit === undefined ? {} : { pidsLimit: data.pidsLimit }),
            ...(data.networkPolicy === undefined ? {} : { networkPolicy: data.networkPolicy }),
            ...(data.description === undefined ? {} : { description: data.description }),
            ...(data.active === undefined ? {} : { active: data.active }),
          },
        });

        return toResourceProfileRecord(row);
      } catch (error) {
        if (isMissingRow(error)) {
          return null;
        }

        throw error;
      }
    },
  };
}

