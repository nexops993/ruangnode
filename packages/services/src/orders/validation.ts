/**
 * Order input parsing.
 *
 * The command that creates an order is deliberately tiny: *what* to buy and how
 * many. Price, currency, discount, total, status, payment/provisioning state and
 * the owning user are all server-owned and simply have no field here, so a
 * client cannot express them — and unknown keys are rejected outright.
 */
import { assertKnownKeys, asRecord, has, readInteger, readUuid } from '../validation.js';
import { DEFAULT_ORDER_ITEM_QUANTITY, MAX_ORDER_ITEM_QUANTITY } from './pricing.js';

export const PLACE_ORDER_INPUT_KEYS = ['productId', 'variantId', 'quantity'] as const;

/** A validated, server-side command; the owner comes from the session. */
export interface PlaceOrderCommand {
  productId: string;
  variantId: string;
  quantity: number;
}

export function parsePlaceOrderCommand(input: unknown): PlaceOrderCommand {
  const body = asRecord(input);
  assertKnownKeys(body, PLACE_ORDER_INPUT_KEYS);

  return {
    productId: readUuid(body, 'productId'),
    variantId: readUuid(body, 'variantId'),
    quantity: has(body, 'quantity')
      ? readInteger(body, 'quantity', { min: 1, max: MAX_ORDER_ITEM_QUANTITY })
      : DEFAULT_ORDER_ITEM_QUANTITY,
  };
}

/** Parses an optional `limit`/`offset` pair from a query string. */
export function parsePagination(
  input: unknown,
  options: { defaultLimit: number; maxLimit: number },
): { limit: number; offset: number } {
  const body = asRecord(input);
  assertKnownKeys(body, ['limit', 'offset']);

  const limit = has(body, 'limit')
    ? readInteger(body, 'limit', { min: 1, max: options.maxLimit })
    : options.defaultLimit;
  const offset = has(body, 'offset') ? readInteger(body, 'offset', { min: 0, max: 10_000 }) : 0;

  return { limit, offset };
}
