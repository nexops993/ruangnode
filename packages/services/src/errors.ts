/**
 * User-safe commerce errors.
 *
 * Every message here is safe to return to a client: it names the field or the
 * state that was rejected, never a submitted value, a price supplied by a
 * browser, an internal identifier or a secret (`.clinerules` → Errors).
 *
 * Codes map onto the shared envelope (`docs/API.md` → Standard response):
 *
 *   - `VALIDATION_FAILED` (422) malformed or inconsistent input
 *   - `NOT_FOUND` (404)         a resource the caller may not see
 *   - `CONFLICT` (409)          the request contradicts current state
 *   - `SERVICE_UNAVAILABLE` (503) a deliberately unimplemented phase
 */
import { AppError } from '@ruangnode/shared';

import type { OrderStatus } from './orders/types.js';

export const COMMERCE_MESSAGES = {
  productNotFound: 'The requested product was not found.',
  variantNotFound: 'The requested product variant was not found.',
  resourceProfileNotFound: 'The requested resource profile was not found.',
  orderNotFound: 'The requested order was not found.',

  duplicateProductSlug: 'A product with this slug already exists.',
  duplicateVariantSku: 'A product variant with this SKU already exists.',
  duplicateResourceProfileName: 'A resource profile with this name already exists.',

  productNotPurchasable: 'This product is not available for purchase.',
  variantNotPurchasable: 'This product variant is not available for purchase.',
  variantProductMismatch: 'This variant does not belong to the selected product.',
  resourceProfileInactive: 'The resource class of this variant is no longer available.',

  productTypeLocked: 'The type of a product that already has variants cannot be changed.',
  productHasNoPurchasableVariant:
    'A product needs at least one active variant with an active resource profile before it can be published.',
  resourceProfileInUse:
    'This resource profile is still referenced by active product variants and cannot be changed or deactivated.',

  orderNotCancellable: 'This order can no longer be cancelled.',
  orderStateChanged: 'The order was changed by another operation. Reload it and try again.',
  paymentsUnavailable: 'Payment processing is not available yet.',

  /** Currency of every monetary column of one order must agree. */
  mixedCurrency: 'All items of an order must use the same currency.',
} as const;

/**
 * Field-level validation failure.
 *
 * Only the field name and the rule are echoed — never the submitted value, which
 * may be anything (and is logged nowhere).
 */
export function invalidCommerceInputError(field: string, rule: string): AppError {
  return new AppError({
    code: 'VALIDATION_FAILED',
    message: `The request is invalid: ${field} (${rule}).`,
  });
}

export function productNotFoundError(): AppError {
  return new AppError({ code: 'NOT_FOUND', message: COMMERCE_MESSAGES.productNotFound });
}

export function variantNotFoundError(): AppError {
  return new AppError({ code: 'NOT_FOUND', message: COMMERCE_MESSAGES.variantNotFound });
}

export function resourceProfileNotFoundError(): AppError {
  return new AppError({ code: 'NOT_FOUND', message: COMMERCE_MESSAGES.resourceProfileNotFound });
}

export function orderNotFoundError(): AppError {
  return new AppError({ code: 'NOT_FOUND', message: COMMERCE_MESSAGES.orderNotFound });
}

export function duplicateProductSlugError(): AppError {
  return new AppError({ code: 'CONFLICT', message: COMMERCE_MESSAGES.duplicateProductSlug });
}

export function duplicateVariantSkuError(): AppError {
  return new AppError({ code: 'CONFLICT', message: COMMERCE_MESSAGES.duplicateVariantSku });
}

export function duplicateResourceProfileNameError(): AppError {
  return new AppError({
    code: 'CONFLICT',
    message: COMMERCE_MESSAGES.duplicateResourceProfileName,
  });
}

export function productNotPurchasableError(): AppError {
  return new AppError({ code: 'CONFLICT', message: COMMERCE_MESSAGES.productNotPurchasable });
}

export function variantNotPurchasableError(): AppError {
  return new AppError({ code: 'CONFLICT', message: COMMERCE_MESSAGES.variantNotPurchasable });
}

export function variantProductMismatchError(): AppError {
  return new AppError({ code: 'CONFLICT', message: COMMERCE_MESSAGES.variantProductMismatch });
}

export function resourceProfileInactiveError(): AppError {
  return new AppError({ code: 'CONFLICT', message: COMMERCE_MESSAGES.resourceProfileInactive });
}

export function resourceProfileInUseError(): AppError {
  return new AppError({ code: 'CONFLICT', message: COMMERCE_MESSAGES.resourceProfileInUse });
}

export function productTypeLockedError(): AppError {
  return new AppError({ code: 'CONFLICT', message: COMMERCE_MESSAGES.productTypeLocked });
}

export function productHasNoPurchasableVariantError(): AppError {
  return new AppError({
    code: 'CONFLICT',
    message: COMMERCE_MESSAGES.productHasNoPurchasableVariant,
  });
}

/** A state transition the domain refuses to perform. */
export function invalidStateTransitionError(message: string): AppError {
  return new AppError({ code: 'CONFLICT', message });
}

/** A concurrent write changed the order between the read and the write. */
export function orderStateChangedError(): AppError {
  return new AppError({ code: 'CONFLICT', message: COMMERCE_MESSAGES.orderStateChanged });
}

export function orderNotCancellableError(status: OrderStatus): AppError {
  return invalidStateTransitionError(`${COMMERCE_MESSAGES.orderNotCancellable} (status: ${status})`);
}

/**
 * Payment-driven behaviour deliberately not implemented in this phase.
 *
 * The state machine knows the transitions a payment provider will eventually
 * drive, but no provider, checkout or webhook exists yet, so the control plane
 * refuses them instead of pretending an order was paid.
 */
export function paymentsUnavailableError(): AppError {
  return new AppError({
    code: 'SERVICE_UNAVAILABLE',
    message: COMMERCE_MESSAGES.paymentsUnavailable,
    retryable: false,
  });
}
