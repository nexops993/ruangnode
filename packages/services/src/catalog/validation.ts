/**
 * Input parsing for products and product variants.
 *
 * Everything a client may send is parsed here: formats, ranges, uniqueness of
 * meaning and the cross-field rules that make a catalog entry sellable. Parsers
 * throw `AppError`s that name the field and the rule, and reject unknown keys, so
 * a smuggled `status`, `price` or `total` never reaches the domain.
 */
import { BillingPeriod, ProductStatus, ProductType } from '@ruangnode/database';

import { invalidCommerceInputError } from '../errors.js';
import { CURRENCY_PATTERN, POSITIVE_PRICE_BOUNDS, parseMinorUnits } from '../money.js';
import { TEBIBYTE } from '../numbers.js';
import {
  assertKnownKeys,
  asRecord,
  has,
  readBigInt,
  readConfigurationSchema,
  readEnum,
  readNullableText,
  readString,
  readNullableUuid,
} from '../validation.js';
import type {
  BillingPeriod as BillingPeriodType,
  ProductStatus as ProductStatusType,
  ProductType as ProductTypeType,
} from './types.js';

/** URL-safe, lower-case product slug: `hermes-managed`. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Stock-keeping unit: `HERMES-STARTER`. Compared exactly, stored as typed. */
export const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

/** Extensible service identifier (`hermes`, `managed-app`, …). */
export const SERVICE_TYPE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export const MAX_PRODUCT_NAME_LENGTH = 160;
export const MAX_DESCRIPTION_LENGTH = 4_000;
export const MAX_VARIANT_NAME_LENGTH = 160;

/**
 * Upper bound for the advertised storage allowance of a variant.
 *
 * 16 TiB is far beyond the largest disk a resource profile may describe, so the
 * value stays inside the documented resource model.
 */
export const MAX_STORAGE_QUOTA_BYTES = 16n * TEBIBYTE;

export const PRODUCT_INPUT_KEYS = ['slug', 'name', 'description', 'type', 'serviceType'] as const;

export const VARIANT_INPUT_KEYS = [
  'name',
  'sku',
  'priceMinor',
  'currency',
  'billingPeriod',
  'resourceProfileId',
  'storageQuotaBytes',
  'configurationSchema',
] as const;

export interface CreateProductInput {
  slug: string;
  name: string;
  description: string | null;
  type: ProductTypeType;
  serviceType: string | null;
}

/** A patch: absent keys leave the stored value untouched. */
export interface UpdateProductInput {
  slug?: string;
  name?: string;
  description?: string | null;
  type?: ProductTypeType;
  serviceType?: string | null;
}

/**
 * Cross-field rules of the catalog.
 *
 * A variant is only sellable when its billing period, its resource class and its
 * product type agree. These rules are enforced server-side on every write, so a
 * browser cannot create a "monthly digital download" or a managed service
 * without a resource class.
 */
export function assertBillingPeriodMatchesProductType(
  type: ProductTypeType,
  billingPeriod: BillingPeriodType,
): void {
  const allowed: Readonly<Record<ProductTypeType, readonly BillingPeriodType[]>> = {
    DIGITAL: [BillingPeriod.ONE_TIME],
    MANAGED_SERVICE: [BillingPeriod.ONE_TIME, BillingPeriod.MONTHLY, BillingPeriod.YEARLY],
    SUBSCRIPTION: [BillingPeriod.MONTHLY, BillingPeriod.YEARLY],
  };

  if (!allowed[type].includes(billingPeriod)) {
    throw invalidCommerceInputError('billingPeriod', `must be ${allowed[type].join(' or ')}`);
  }
}

/**
 * A managed service must name the resource class it runs in; a digital product
 * must not claim one (docs/DATABASE.md → ProductVariant).
 */
export function assertResourceProfileMatchesProductType(
  type: ProductTypeType,
  resourceProfileId: string | null,
): void {
  if (type === ProductType.MANAGED_SERVICE && resourceProfileId === null) {
    throw invalidCommerceInputError('resourceProfileId', 'is required for a MANAGED_SERVICE product');
  }

  if (type === ProductType.DIGITAL && resourceProfileId !== null) {
    throw invalidCommerceInputError('resourceProfileId', 'must be null for a DIGITAL product');
  }
}

function readSlug(body: Record<string, unknown>): string {
  return readString(body, 'slug', { minLength: 3, maxLength: 80, pattern: SLUG_PATTERN });
}

function readProductName(body: Record<string, unknown>): string {
  return readString(body, 'name', { maxLength: MAX_PRODUCT_NAME_LENGTH });
}

function readDescription(body: Record<string, unknown>): string | null {
  return readNullableText(body, 'description', { maxLength: MAX_DESCRIPTION_LENGTH });
}

function readServiceType(body: Record<string, unknown>): string | null {
  const value = readNullableText(body, 'serviceType', { maxLength: 64 });

  if (value === null || value.trim() === '') {
    return null;
  }

  if (!SERVICE_TYPE_PATTERN.test(value.trim())) {
    throw invalidCommerceInputError('serviceType', 'must be a lower-case identifier');
  }

  return value.trim();
}

export function parseCreateProductInput(input: unknown): CreateProductInput {
  const body = asRecord(input);
  assertKnownKeys(body, PRODUCT_INPUT_KEYS);

  // `status` is deliberately not accepted: every product starts as DRAFT and is
  // published through the guarded status transition.
  return {
    slug: readSlug(body),
    name: readProductName(body),
    description: readDescription(body),
    type: readEnum(body, 'type', Object.values(ProductType)),
    serviceType: readServiceType(body),
  };
}

/**
 * Reads a requested lifecycle status.
 *
 * Callers ask for a *target* status; whether the transition is allowed is
 * decided by the guarded state machine, never by the request.
 */
export function parseProductStatusInput(input: unknown): ProductStatusType {
  const body = asRecord(input);
  assertKnownKeys(body, ['status']);

  return readEnum(body, 'status', Object.values(ProductStatus));
}

export function parseUpdateProductInput(input: unknown): UpdateProductInput {
  const body = asRecord(input);
  assertKnownKeys(body, PRODUCT_INPUT_KEYS);

  const patch: UpdateProductInput = {};

  if (has(body, 'slug')) {
    patch.slug = readSlug(body);
  }

  if (has(body, 'name')) {
    patch.name = readProductName(body);
  }

  if (has(body, 'description')) {
    patch.description = readDescription(body);
  }

  if (has(body, 'type')) {
    patch.type = readEnum(body, 'type', Object.values(ProductType));
  }

  if (has(body, 'serviceType')) {
    patch.serviceType = readServiceType(body);
  }

  if (Object.keys(patch).length === 0) {
    throw invalidCommerceInputError('body', 'must contain at least one field to update');
  }

  return patch;
}

function readVariantName(body: Record<string, unknown>): string {
  return readString(body, 'name', { maxLength: MAX_VARIANT_NAME_LENGTH });
}

function readSku(body: Record<string, unknown>): string {
  return readString(body, 'sku', { minLength: 3, maxLength: 64, pattern: SKU_PATTERN });
}

/** Price is an integer number of minor units; a decimal string or an integer. */
function readPriceMinor(body: Record<string, unknown>): bigint {
  const value = parseMinorUnits(body['priceMinor'], POSITIVE_PRICE_BOUNDS);

  if (value === null) {
    throw invalidCommerceInputError(
      'priceMinor',
      'must be a positive integer number of minor units, as a decimal string or an integer',
    );
  }

  return value;
}

function readCurrency(body: Record<string, unknown>): string {
  return readString(body, 'currency', { minLength: 3, maxLength: 3, pattern: CURRENCY_PATTERN });
}

function readStorageQuotaBytes(body: Record<string, unknown>): bigint | null {
  if (!has(body, 'storageQuotaBytes') || body['storageQuotaBytes'] === null) {
    return null;
  }

  return readBigInt(body, 'storageQuotaBytes', { min: 0n, max: MAX_STORAGE_QUOTA_BYTES });
}

export function parseCreateVariantInput(input: unknown): CreateVariantInput {
  const body = asRecord(input);
  assertKnownKeys(body, VARIANT_INPUT_KEYS);

  // `status` and `productId` are not accepted: a new variant is always DRAFT and
  // always belongs to the product named by the URL.
  return {
    name: readVariantName(body),
    sku: readSku(body),
    priceMinor: readPriceMinor(body),
    currency: readCurrency(body),
    billingPeriod: readEnum(body, 'billingPeriod', Object.values(BillingPeriod)),
    resourceProfileId: readNullableUuid(body, 'resourceProfileId'),
    storageQuotaBytes: readStorageQuotaBytes(body),
    configurationSchema: readConfigurationSchema(body, 'configurationSchema'),
  };
}

export function parseUpdateVariantInput(input: unknown): UpdateVariantInput {
  const body = asRecord(input);
  assertKnownKeys(body, VARIANT_INPUT_KEYS);

  const patch: UpdateVariantInput = {};

  if (has(body, 'name')) {
    patch.name = readVariantName(body);
  }

  if (has(body, 'sku')) {
    patch.sku = readSku(body);
  }

  if (has(body, 'priceMinor')) {
    patch.priceMinor = readPriceMinor(body);
  }

  if (has(body, 'currency')) {
    patch.currency = readCurrency(body);
  }

  if (has(body, 'billingPeriod')) {
    patch.billingPeriod = readEnum(body, 'billingPeriod', Object.values(BillingPeriod));
  }

  if (has(body, 'resourceProfileId')) {
    patch.resourceProfileId = readNullableUuid(body, 'resourceProfileId');
  }

  if (has(body, 'storageQuotaBytes')) {
    patch.storageQuotaBytes = readStorageQuotaBytes(body);
  }

  if (has(body, 'configurationSchema')) {
    patch.configurationSchema = readConfigurationSchema(body, 'configurationSchema');
  }

  if (Object.keys(patch).length === 0) {
    throw invalidCommerceInputError('body', 'must contain at least one field to update');
  }

  return patch;
}
export interface CreateVariantInput {
  name: string;
  sku: string;
  priceMinor: bigint;
  currency: string;
  billingPeriod: BillingPeriodType;
  resourceProfileId: string | null;
  storageQuotaBytes: bigint | null;
  configurationSchema: unknown | null;
}

/** A patch: absent keys leave the stored value untouched. */
export interface UpdateVariantInput {
  name?: string;
  sku?: string;
  priceMinor?: bigint;
  currency?: string;
  billingPeriod?: BillingPeriodType;
  resourceProfileId?: string | null;
  storageQuotaBytes?: bigint | null;
  configurationSchema?: unknown | null;
}
