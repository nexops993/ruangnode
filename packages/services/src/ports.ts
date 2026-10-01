/**
 * Storage ports of the commerce domain.
 *
 * Services talk to these interfaces only. The production implementation is
 * Prisma-backed (`adapters/prisma-commerce-store.ts`); tests use the real
 * adapter against a real PostgreSQL migration (see `tests/integration`). No
 * service imports Prisma, and no Prisma model type appears in a service
 * signature (`.clinerules` → dependency injection for infrastructure adapters,
 * API: never expose raw Prisma models).
 *
 * `CommerceStore.transaction` exists because an order and its lines must be
 * written together: the callback receives a store bound to one database
 * transaction, so a failure cannot leave a half-written order behind.
 */
import type { BillingPeriod, PaymentStatus, ProductStatus, ProductType } from '@ruangnode/database';

import type { ProductRecord, ProductVariantRecord } from './catalog/types.js';
import type {
  OrderItemMetadataSnapshot,
  OrderRecord,
  OrderStatus,
} from './orders/types.js';
import type { ResourceProfileRecord } from './resources/types.js';
import type { AuditEvent, PaymentRecord, WebhookEventRecord } from './payments/types.js';

export interface Pagination {
  limit: number;
  offset: number;
}

export interface ProductListFilter extends Partial<Pagination> {
  /** When omitted, every status is returned (admin view). */
  statuses?: readonly ProductStatus[];
  type?: ProductType;
  serviceType?: string;
}

/** Fields an administrator may write on a product. */
export interface ProductWriteData {
  slug: string;
  name: string;
  description: string | null;
  type: ProductType;
  serviceType: string | null;
  status: ProductStatus;
}

export interface ProductRepository {
  list(filter?: ProductListFilter): Promise<ProductRecord[]>;
  findById(id: string): Promise<ProductRecord | null>;
  findBySlug(slug: string): Promise<ProductRecord | null>;
  create(data: ProductWriteData): Promise<ProductRecord>;
  /** Returns `null` when the row disappeared between the read and the write. */
  update(id: string, data: Partial<ProductWriteData>): Promise<ProductRecord | null>;
}

export interface VariantListFilter {
  productId?: string;
  productIds?: readonly string[];
  resourceProfileId?: string;
  /** When omitted, every status is returned (admin view). */
  statuses?: readonly ProductStatus[];
  limit?: number;
}

export interface VariantWriteData {
  productId: string;
  name: string;
  sku: string;
  priceMinor: bigint;
  currency: string;
  billingPeriod: BillingPeriod;
  resourceProfileId: string | null;
  storageQuotaBytes: bigint | null;
  configurationSchema: unknown | null;
  status: ProductStatus;
}

export interface ProductVariantRepository {
  list(filter?: VariantListFilter): Promise<ProductVariantRecord[]>;
  findById(id: string): Promise<ProductVariantRecord | null>;
  findBySku(sku: string): Promise<ProductVariantRecord | null>;
  create(data: VariantWriteData): Promise<ProductVariantRecord>;
  update(id: string, data: Partial<VariantWriteData>): Promise<ProductVariantRecord | null>;
}

export interface ResourceProfileListFilter {
  includeInactive?: boolean;
  ids?: readonly string[];
}

export interface ResourceProfileWriteData {
  name: string;
  cpuLimitMillicores: number;
  memoryLimitBytes: bigint;
  memorySwapPolicy: ResourceProfileRecord['memorySwapPolicy'];
  memorySwapBytes: bigint | null;
  diskLimitBytes: bigint;
  diskPolicy: ResourceProfileRecord['diskPolicy'];
  pidsLimit: number;
  networkPolicy: string | null;
  description: string | null;
  active: boolean;
}

export interface ResourceProfileRepository {
  list(filter?: ResourceProfileListFilter): Promise<ResourceProfileRecord[]>;
  findById(id: string): Promise<ResourceProfileRecord | null>;
  findByName(name: string): Promise<ResourceProfileRecord | null>;
  create(data: ResourceProfileWriteData): Promise<ResourceProfileRecord>;
  update(
    id: string,
    data: Partial<ResourceProfileWriteData>,
  ): Promise<ResourceProfileRecord | null>;
}

/** One line of a new order. Prices are computed by the service, never supplied. */
export interface CreateOrderItemData {
  productVariantId: string;
  quantity: number;
  unitPriceMinor: bigint;
  totalPriceMinor: bigint;
  metadataSnapshot: OrderItemMetadataSnapshot;
}

/** A new order. Status, totals and ownership are server-owned values. */
export interface CreateOrderData {
  userId: string;
  status: OrderStatus;
  currency: string;
  subtotalMinor: bigint;
  discountMinor: bigint;
  totalMinor: bigint;
  expiresAt: Date | null;
  items: readonly CreateOrderItemData[];
}

export interface OrderRepository {
  listForUser(userId: string, options?: Partial<Pagination>): Promise<OrderRecord[]>;
  /** Unscoped read. Only ever used together with an explicit ownership check. */
  findById(orderId: string): Promise<OrderRecord | null>;
  /** Scoped by owner: an order of another account is indistinguishable from a missing one. */
  findByIdForUser(userId: string, orderId: string): Promise<OrderRecord | null>;
  /**
   * Owner of an order, or `null` when it does not exist. Used by the API's
   * ownership guard, so an endpoint never loads another tenant's order to decide
   * whether to answer it.
   */
  findOwnerUserId(orderId: string): Promise<string | null>;
  create(data: CreateOrderData): Promise<OrderRecord>;
  /**
   * Compare-and-swap status change: returns `false` when the order is not in
   * `from` any more, which is what makes a concurrent transition safe.
   */
  updateStatus(orderId: string, from: OrderStatus, to: OrderStatus): Promise<boolean>;
}

export interface PaymentCreateData {
  orderId: string;
  provider: string;
  providerPaymentId: string;
  status: PaymentStatus;
  amountMinor: bigint;
  currency: string;
  rawReference: string | null;
}

export interface PaymentRepository {
  findById(paymentId: string): Promise<PaymentRecord | null>;
  findByProviderPaymentId(provider: string, providerPaymentId: string): Promise<PaymentRecord | null>;
  create(data: PaymentCreateData): Promise<PaymentRecord>;
  updateStatus(
    paymentId: string,
    from: PaymentStatus,
    to: PaymentStatus,
    paidAt: Date | null,
    rawReference: string | null,
  ): Promise<boolean>;
}

export interface WebhookRepository {
  find(provider: string, externalEventId: string): Promise<WebhookEventRecord | null>;
  create(data: Omit<WebhookEventRecord, 'id' | 'createdAt' | 'processedAt' | 'processingError'>): Promise<WebhookEventRecord>;
  markProcessed(id: string, processedAt: Date): Promise<void>;
  markFailed(id: string, processingError: string): Promise<void>;
}

export interface AuditRepository {
  record(event: AuditEvent): Promise<void>;
}

export interface CommerceStore {
  products: ProductRepository;
  variants: ProductVariantRepository;
  resourceProfiles: ResourceProfileRepository;
  orders: OrderRepository;
  payments: PaymentRepository;
  webhooks: WebhookRepository;
  audit: AuditRepository;
  /**
   * Runs `work` inside one database transaction, with a store bound to it.
   * Any thrown error rolls the whole unit of work back.
   */
  transaction<T>(work: (store: CommerceStore) => Promise<T>): Promise<T>;
}
