/**
 * Money.
 *
 * Money is always an integer number of minor units in a named currency
 * (`docs/PAYMENTS.md`, `docs/DATABASE.md`, `.clinerules`): `IDR 40,000` is
 * `40000n`. Floating point never touches a price, a tax, a discount or a total.
 *
 * JSON has no arbitrary-precision integer, so `BigInt` must never be handed to
 * a response serializer: `JSON.stringify(1n)` throws. Everything leaving the
 * control plane therefore goes through `toMoneyJson`, which renders the amount
 * as a decimal string. The wire format is documented in docs/API.md:
 *
 *     { "amount": "40000", "currency": "IDR" }
 */
import { parseBigIntQuantity, type BigIntBounds } from './numbers.js';

/** Integer minor units of a currency. Never a floating-point value. */
export type MinorUnits = bigint;

/** JSON-safe monetary value. */
export interface MoneyJson {
  /** Decimal string of integer minor units. Never a float, never a number. */
  amount: string;
  /** ISO 4217 alpha-3 code. */
  currency: string;
}

/** ISO 4217 alpha-3, upper-case. Lower-case codes are rejected, not repaired. */
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * Upper bound for a single monetary value.
 *
 * 10^15 minor units is far beyond any realistic order and keeps every stored
 * value inside `BigInt` arithmetic without surprises.
 */
export const MAX_MINOR_UNITS = 1_000_000_000_000_000n;

export const MINOR_UNITS_BOUNDS: BigIntBounds = { min: 0n, max: MAX_MINOR_UNITS };

/** Bounds for a price that must be strictly positive (a variant's price). */
export const POSITIVE_PRICE_BOUNDS: BigIntBounds = { min: 1n, max: MAX_MINOR_UNITS };

export function isCurrency(value: unknown): value is string {
  return typeof value === 'string' && CURRENCY_PATTERN.test(value);
}

/** Parses a JSON-safe monetary amount into integer minor units. */
export function parseMinorUnits(value: unknown, bounds: BigIntBounds = MINOR_UNITS_BOUNDS): bigint | null {
  return parseBigIntQuantity(value, bounds);
}

/** Serialises integer minor units for a response. */
export function toMoneyJson(amount: bigint, currency: string): MoneyJson {
  return { amount: amount.toString(), currency };
}

/** Line price: an integer unit price times an integer quantity. */
export function lineTotalMinor(unitPriceMinor: bigint, quantity: number): bigint {
  return unitPriceMinor * BigInt(quantity);
}
