/**
 * Catalog domain types.
 *
 * These are the shapes the services work with; they are deliberately *not* the
 * Prisma models (`.clinerules` → API: never expose raw Prisma models). The
 * enumerations come from the schema itself (`@ruangnode/database` re-exports the
 * generated enums), so a new value in `schema.prisma` can never be silently
 * missing here.
 *
 * Money and byte quantities are `bigint` in the domain and decimal strings on
 * the wire (see `money.ts` and docs/API.md).
 */
import type { BillingPeriod, ProductStatus, ProductType } from '@ruangnode/database';

import type { MinorUnits, MoneyJson } from '../money.js';
import type { PublicResourceProfile } from '../resources/serialization.js';

export type { BillingPeriod, ProductStatus, ProductType };

/** Domain view of a `Product` row. */
export interface ProductRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  type: ProductType;
  status: ProductStatus;
  serviceType: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Domain view of a `ProductVariant` row. */
export interface ProductVariantRecord {
  id: string;
  productId: string;
  name: string;
  sku: string;
  /** Integer minor units of `currency`. */
  priceMinor: MinorUnits;
  currency: string;
  billingPeriod: BillingPeriod;
  resourceProfileId: string | null;
  storageQuotaBytes: MinorUnits | null;
  /** JSON Schema of the configuration a customer may submit. Never secret. */
  configurationSchema: unknown | null;
  status: ProductStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** A purchasable plan as a customer (and the store front) sees it. */
export interface PublicVariant {
  id: string;
  name: string;
  sku: string;
  billingPeriod: BillingPeriod;
  price: MoneyJson;
  storageQuotaBytes: string | null;
  resourceProfile: PublicResourceProfile | null;
  configurationSchema: unknown | null;
}

/**
 * A publicly available product.
 *
 * Only `status: ACTIVE` products with at least one purchasable variant are ever
 * built into this shape, so the type carries no status field.
 */
export interface PublicProduct {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  type: ProductType;
  serviceType: string | null;
  /** Cheapest purchasable variant, or `null` when none is offered. */
  priceFrom: MoneyJson | null;
  variants: PublicVariant[];
}

/** A variant as an administrator sees it, including its commercial state. */
export interface AdminVariant {
  id: string;
  productId: string;
  name: string;
  sku: string;
  price: MoneyJson;
  currency: string;
  billingPeriod: BillingPeriod;
  resourceProfileId: string | null;
  resourceProfile: PublicResourceProfile | null;
  storageQuotaBytes: string | null;
  configurationSchema: unknown | null;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
}

/** A product as an administrator sees it: every variant, every status. */
export interface AdminProduct {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  type: ProductType;
  status: ProductStatus;
  serviceType: string | null;
  createdAt: string;
  updatedAt: string;
  variants: AdminVariant[];
}
