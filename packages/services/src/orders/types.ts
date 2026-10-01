/**
 * Order domain types.
 *
 * `OrderStatus` comes from the schema (`@ruangnode/database`), and it stays
 * separate from `PaymentStatus`, `SubscriptionStatus` and `ProvisioningJobStatus`
 * — an order being paid is not the same as an entitlement being active
 * (docs/DATABASE.md → state separation).
 *
 * `metadataSnapshot` is written once, when the order is created, and never
 * recomputed: a later price change must not rewrite history.
 */
import type { BillingPeriod, OrderStatus, ProductType } from '@ruangnode/database';

import type { MinorUnits, MoneyJson } from '../money.js';
import type { PublicResourceProfile } from '../resources/serialization.js';

export type { OrderStatus };

/** Current shape version of `OrderItemMetadataSnapshot`. */
export const ORDER_ITEM_SNAPSHOT_VERSION = 1;

/** The resource class as it was at purchase time (no description needed). */
export type SnapshotResourceProfile = Omit<PublicResourceProfile, 'description'>;

/** Non-secret commercial snapshot of the purchased line. */
export interface OrderItemMetadataSnapshot {
  snapshotVersion: number;
  capturedAt: string;
  product: {
    id: string;
    slug: string;
    name: string;
    type: ProductType;
    serviceType: string | null;
  };
  variant: {
    id: string;
    name: string;
    sku: string;
    billingPeriod: BillingPeriod;
    /** Currency of the line; matches the order currency. */
    currency: string;
    unitPriceMinor: string;
  };
  resourceProfile: SnapshotResourceProfile | null;
  storageQuotaBytes: string | null;
}

/** Domain view of an `OrderItem` row. */
export interface OrderItemRecord {
  id: string;
  orderId: string;
  productVariantId: string;
  quantity: number;
  unitPriceMinor: MinorUnits;
  totalPriceMinor: MinorUnits;
  metadataSnapshot: OrderItemMetadataSnapshot;
}

/** Domain view of an `Order` row with its lines. */
export interface OrderRecord {
  id: string;
  userId: string;
  status: OrderStatus;
  currency: string;
  subtotalMinor: MinorUnits;
  discountMinor: MinorUnits;
  totalMinor: MinorUnits;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items: OrderItemRecord[];
}

/** An order line as the owning customer sees it. */
export interface OrderItemView {
  id: string;
  productVariantId: string;
  quantity: number;
  unitPrice: MoneyJson;
  totalPrice: MoneyJson;
  snapshot: OrderItemMetadataSnapshot;
}

/** An order as the owning customer (or an administrator) sees it. */
export interface OrderView {
  id: string;
  userId: string;
  status: OrderStatus;
  currency: string;
  subtotal: MoneyJson;
  discount: MoneyJson;
  total: MoneyJson;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItemView[];
}
