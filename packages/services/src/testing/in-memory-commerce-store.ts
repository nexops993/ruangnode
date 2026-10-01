/**
 * In-memory implementation of the commerce store.
 *
 * Test double for `CommerceStore` (`../ports.js`). It mirrors the documented
 * behaviour of the Prisma adapter (`../adapters/prisma-commerce-store.js`):
 * duplicate slug/SKU/profile name throws the same structured conflict error,
 * `update` returns `null` for a missing row, `updateStatus` is a
 * compare-and-swap, and `transaction` rolls back on failure.
 *
 * Never used by the control plane process: `apps/api/src/index.ts` always
 * wires the Prisma store. IDs use `crypto.randomUUID()`, like the database.
 */
import type { ProductRecord, ProductVariantRecord } from '../catalog/types.js';
import type { OrderRecord } from '../orders/types.js';
import type { AuditEvent, PaymentRecord, WebhookEventRecord } from '../payments/types.js';
import type { ResourceProfileRecord } from '../resources/types.js';
import type { ProductListFilter, VariantListFilter } from '../ports.js';

export interface CommerceState {
  products: Map<string, ProductRecord>;
  variants: Map<string, ProductVariantRecord>;
  profiles: Map<string, ResourceProfileRecord>;
  orders: Map<string, OrderRecord>;
  payments: Map<string, PaymentRecord>;
  webhooks: Map<string, WebhookEventRecord>;
  audits: AuditEvent[];
}

export function cloneRecord<T extends object>(value: T): T {
  return { ...value };
}

export function cloneOrderRecord(value: OrderRecord): OrderRecord {
  return {
    ...value,
    expiresAt: value.expiresAt === null ? null : new Date(value.expiresAt),
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
    items: value.items.map((item) => ({
      ...item,
      metadataSnapshot: structuredClone(item.metadataSnapshot),
    })),
  };
}

export function cloneState(state: CommerceState): CommerceState {
  return {
    products: new Map([...state.products].map(([id, value]) => [id, cloneRecord(value)] as const)),
    variants: new Map([...state.variants].map(([id, value]) => [id, cloneRecord(value)] as const)),
    profiles: new Map([...state.profiles].map(([id, value]) => [id, cloneRecord(value)] as const)),
    orders: new Map([...state.orders].map(([id, value]) => [id, cloneOrderRecord(value)] as const)),
    payments: new Map([...state.payments].map(([id, value]) => [id, clonePaymentRecord(value)] as const)),
    webhooks: new Map([...state.webhooks].map(([id, value]) => [id, cloneWebhookRecord(value)] as const)),
    audits: state.audits.map((value) => ({ ...value, ...(value.metadata === undefined ? {} : { metadata: { ...value.metadata } }) })),
  };
}

export function emptyState(): CommerceState {
  return { products: new Map(), variants: new Map(), profiles: new Map(), orders: new Map(), payments: new Map(), webhooks: new Map(), audits: [] };
}

/**
 * Restores `target` from `snapshot` in place.
 *
 * The repositories hold the state object by reference, so rollback mutates the
 * same object instead of replacing it — otherwise a failed transaction would
 * leave the pre-transaction repositories pointing at discarded state.
 */
export function restoreState(target: CommerceState, snapshot: CommerceState): void {
  target.products = snapshot.products;
  target.variants = snapshot.variants;
  target.profiles = snapshot.profiles;
  target.orders = snapshot.orders;
  target.payments = snapshot.payments;
  target.webhooks = snapshot.webhooks;
  target.audits = snapshot.audits;
}

export function clonePaymentRecord(value: PaymentRecord): PaymentRecord {
  return { ...value, paidAt: value.paidAt === null ? null : new Date(value.paidAt), createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) };
}

export function cloneWebhookRecord(value: WebhookEventRecord): WebhookEventRecord {
  return { ...value, processedAt: value.processedAt === null ? null : new Date(value.processedAt), createdAt: new Date(value.createdAt) };
}

export function applyProductFilter(rows: ProductRecord[], filter?: ProductListFilter): ProductRecord[] {
  let result = rows;

  if (filter?.statuses !== undefined) {
    const statuses = new Set(filter.statuses);
    result = result.filter((row) => statuses.has(row.status));
  }

  if (filter?.type !== undefined) {
    result = result.filter((row) => row.type === filter.type);
  }

  if (filter?.serviceType !== undefined) {
    result = result.filter((row) => row.serviceType === filter.serviceType);
  }

  result = [...result].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const offset = filter?.offset ?? 0;
  const limit = filter?.limit;

  return (limit === undefined ? result.slice(offset) : result.slice(offset, offset + limit)).map(
    cloneRecord,
  );
}

export function applyVariantFilter(
  rows: ProductVariantRecord[],
  filter?: VariantListFilter,
): ProductVariantRecord[] {
  let result = rows;

  if (filter?.productId !== undefined) {
    result = result.filter((row) => row.productId === filter.productId);
  }

  if (filter?.productIds !== undefined) {
    const ids = new Set(filter.productIds);
    result = result.filter((row) => ids.has(row.productId));
  }

  if (filter?.resourceProfileId !== undefined) {
    result = result.filter((row) => row.resourceProfileId === filter.resourceProfileId);
  }

  if (filter?.statuses !== undefined) {
    const statuses = new Set(filter.statuses);
    result = result.filter((row) => statuses.has(row.status));
  }

  result = [...result].sort((a, b) => a.sku.localeCompare(b.sku));

  return (filter?.limit === undefined ? result : result.slice(0, filter.limit)).map(cloneRecord);
}
