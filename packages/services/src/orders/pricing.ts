/**
 * Order pricing.
 *
 * Pure arithmetic over integer minor units, so the same function is used by the
 * order service, by tests and (later) by a payment adapter that has to check the
 * amount it was asked to charge.
 *
 * Rules:
 *
 *   - a line price is `unitPrice × quantity`, computed in `BigInt`
 *   - every line of an order shares one currency
 *   - `total = subtotal − discount`, and `discount` never turns a total negative
 *   - there is no promotion engine in this phase: the discount is `0` and is
 *     stored explicitly rather than left implicit (docs/DATABASE.md → Order)
 *
 * The unit price is always read from the database by the caller. Nothing here
 * accepts a price from a request body (`.clinerules` → Payments).
 */
import { invalidCommerceInputError, COMMERCE_MESSAGES } from '../errors.js';
import { lineTotalMinor } from '../money.js';

export const MAX_ORDER_ITEM_QUANTITY = 10;
export const DEFAULT_ORDER_ITEM_QUANTITY = 1;

export interface PricedLineInput {
  /** Integer minor units from the stored variant, never from a request. */
  unitPriceMinor: bigint;
  quantity: number;
  currency: string;
}

export interface OrderTotals {
  currency: string;
  subtotalMinor: bigint;
  discountMinor: bigint;
  totalMinor: bigint;
}

/** True when a quantity is inside the documented bounds (1 … 10). */
export function isValidQuantity(quantity: unknown): quantity is number {
  return (
    typeof quantity === 'number' &&
    Number.isSafeInteger(quantity) &&
    quantity >= 1 &&
    quantity <= MAX_ORDER_ITEM_QUANTITY
  );
}

/**
 * Server-side totals of an order.
 *
 * Throws `VALIDATION_FAILED` for anything that would make the stored aggregates
 * inconsistent with the lines.
 */
export function calculateOrderTotals(
  lines: readonly PricedLineInput[],
  discount: bigint = 0n,
): OrderTotals {
  const [first] = lines;

  if (first === undefined) {
    throw invalidCommerceInputError('items', 'must contain at least one line');
  }

  const currency = first.currency;
  let subtotal = 0n;

  for (const line of lines) {
    if (line.currency !== currency) {
      throw invalidCommerceInputError('items', COMMERCE_MESSAGES.mixedCurrency);
    }

    if (!isValidQuantity(line.quantity)) {
      throw invalidCommerceInputError(
        'quantity',
        `must be an integer between 1 and ${MAX_ORDER_ITEM_QUANTITY}`,
      );
    }

    if (line.unitPriceMinor <= 0n) {
      throw invalidCommerceInputError('priceMinor', 'must be a positive integer');
    }

    subtotal += lineTotalMinor(line.unitPriceMinor, line.quantity);
  }

  if (discount < 0n || discount > subtotal) {
    throw invalidCommerceInputError('discount', 'must be between zero and the subtotal');
  }

  return {
    currency,
    subtotalMinor: subtotal,
    discountMinor: discount,
    totalMinor: subtotal - discount,
  };
}
