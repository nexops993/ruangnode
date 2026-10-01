/**
 * Product and variant lifecycle.
 *
 * `ProductStatus` is shared by `Product` and `ProductVariant`
 * (docs/DATABASE.md), so both use the same guarded transitions. Nothing in the
 * system may set a status directly: a caller asks for a target status and the
 * domain either accepts it or refuses with a conflict.
 *
 *     DRAFT ──publish──▶ ACTIVE ──unpublish──▶ DRAFT
 *       │                   │                   ▲
 *       └──────archive──────┴────archive────────┘ (ARCHIVED → DRAFT only)
 *
 * `ARCHIVED` is the terminal resting place of a retired entry: it is never
 * deleted, because orders and their snapshots reference it.
 */
import type { ProductStatus } from '@ruangnode/database';

import { invalidStateTransitionError } from '../errors.js';

export const PRODUCT_STATUS_TRANSITIONS: Readonly<Record<ProductStatus, readonly ProductStatus[]>> =
  {
    DRAFT: ['ACTIVE', 'ARCHIVED'],
    ACTIVE: ['DRAFT', 'ARCHIVED'],
    ARCHIVED: ['DRAFT'],
  };

export function canTransitionProductStatus(from: ProductStatus, to: ProductStatus): boolean {
  return PRODUCT_STATUS_TRANSITIONS[from].includes(to);
}

/** Throws `CONFLICT` for a transition the lifecycle does not allow. */
export function assertProductStatusTransition(from: ProductStatus, to: ProductStatus): void {
  if (!canTransitionProductStatus(from, to)) {
    throw invalidStateTransitionError(`This status change is not allowed (${from} → ${to}).`);
  }
}

/** Statuses that keep a product or variant out of the public catalog. */
export const NOT_FOR_SALE_STATUSES: readonly ProductStatus[] = ['DRAFT', 'ARCHIVED'];

/** True when a product/variant in this status may be sold. */
export function isForSale(status: ProductStatus): boolean {
  return status === 'ACTIVE';
}
