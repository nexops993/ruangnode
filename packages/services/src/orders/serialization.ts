/**
 * Order serialisation.
 *
 * Every monetary value becomes `{ amount, currency }` with the amount as a
 * decimal string of integer minor units; byte quantities become decimal strings
 * too. No `BigInt` reaches a response serializer.
 */
import { toMoneyJson } from '../money.js';
import type { OrderItemMetadataSnapshot, OrderItemRecord, OrderRecord, OrderView } from './types.js';

export function toOrderItemView(record: OrderItemRecord, currency: string): OrderView['items'][number] {
  return {
    id: record.id,
    productVariantId: record.productVariantId,
    quantity: record.quantity,
    unitPrice: toMoneyJson(record.unitPriceMinor, currency),
    totalPrice: toMoneyJson(record.totalPriceMinor, currency),
    snapshot: record.metadataSnapshot,
  };
}

export function toOrderView(record: OrderRecord): OrderView {
  return {
    id: record.id,
    userId: record.userId,
    status: record.status,
    currency: record.currency,
    subtotal: toMoneyJson(record.subtotalMinor, record.currency),
    discount: toMoneyJson(record.discountMinor, record.currency),
    total: toMoneyJson(record.totalMinor, record.currency),
    expiresAt: record.expiresAt === null ? null : record.expiresAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    items: record.items.map((item) => toOrderItemView(item, record.currency)),
  };
}

/** Type guard used when a snapshot is read back from the database. */
export function isOrderItemSnapshot(value: unknown): value is OrderItemMetadataSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'snapshotVersion' in value &&
    'variant' in value
  );
}
