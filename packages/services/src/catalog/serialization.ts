/**
 * Catalog serialisation.
 *
 * Two projections over the same records:
 *
 *   - **public**: what a store front and an anonymous visitor may see. Only
 *     publicly available entries are ever built into these shapes, so the
 *     projections carry no status, no internal ids beyond the ones a customer
 *     needs to buy, and no admin-only fields.
 *   - **admin**: the full commercial state, including statuses and timestamps.
 *
 * Money and byte quantities are rendered as decimal strings; `BigInt` never
 * reaches a serializer (`JSON.stringify(1n)` throws).
 */
import { toMoneyJson, type MoneyJson } from '../money.js';
import type { PublicResourceProfile } from '../resources/serialization.js';
import type {
  AdminProduct,
  AdminVariant,
  ProductRecord,
  ProductVariantRecord,
  PublicProduct,
  PublicVariant,
} from './types.js';

export function toPublicVariant(
  record: ProductVariantRecord,
  resourceProfile: PublicResourceProfile | null,
): PublicVariant {
  return {
    id: record.id,
    name: record.name,
    sku: record.sku,
    billingPeriod: record.billingPeriod,
    price: toMoneyJson(record.priceMinor, record.currency),
    storageQuotaBytes:
      record.storageQuotaBytes === null ? null : record.storageQuotaBytes.toString(),
    resourceProfile,
    configurationSchema: record.configurationSchema,
  };
}

export function toAdminVariant(
  record: ProductVariantRecord,
  resourceProfile: PublicResourceProfile | null,
): AdminVariant {
  return {
    id: record.id,
    productId: record.productId,
    name: record.name,
    sku: record.sku,
    price: toMoneyJson(record.priceMinor, record.currency),
    currency: record.currency,
    billingPeriod: record.billingPeriod,
    resourceProfileId: record.resourceProfileId,
    resourceProfile,
    storageQuotaBytes:
      record.storageQuotaBytes === null ? null : record.storageQuotaBytes.toString(),
    configurationSchema: record.configurationSchema,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toPublicProduct(record: ProductRecord, variants: PublicVariant[]): PublicProduct {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    description: record.description,
    type: record.type,
    serviceType: record.serviceType,
    priceFrom: lowestPrice(variants),
    variants,
  };
}

export function toAdminProduct(record: ProductRecord, variants: AdminVariant[]): AdminProduct {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    description: record.description,
    type: record.type,
    status: record.status,
    serviceType: record.serviceType,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    variants,
  };
}

/** Cheapest purchasable variant of a product, or `null` when none is offered. */
export function lowestPrice(variants: readonly PublicVariant[]): MoneyJson | null {
  let lowest: PublicVariant | null = null;

  for (const variant of variants) {
    if (lowest === null || BigInt(variant.price.amount) < BigInt(lowest.price.amount)) {
      lowest = variant;
    }
  }

  return lowest === null ? null : lowest.price;
}
