/**
 * Numeric parsing for boundary input.
 *
 * Every value that reaches a service may come from JSON, from a form or from a
 * script, so the parsers below accept the JSON-safe representations of the
 * numeric quantities the schema uses — and nothing else:
 *
 *   - counts (CPU millicores, PIDs, quantity) are JSON numbers
 *   - byte quantities and money are `BigInt` in the database, so they are
 *     accepted as a decimal string (JSON has no arbitrary-precision integer)
 *     or, when they fit, as a JSON integer
 *
 * Floating point is rejected on purpose: `1.5` CPUs and `0.1` of a rupiah are
 * exactly the bugs the schema forbids (docs/DATABASE.md → money).
 */

export interface IntegerBounds {
  min: number;
  max: number;
}

export interface BigIntBounds {
  min: bigint;
  max: bigint;
}

/** Non-negative decimal integer without separators, sign or exponent. */
const DECIMAL_INTEGER = /^(?:0|[1-9][0-9]{0,19})$/;

/** Parses a JSON integer inside `bounds`; returns `null` when it is not one. */
export function parseInteger(value: unknown, bounds: IntegerBounds): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return null;
  }

  return value >= bounds.min && value <= bounds.max ? value : null;
}

/**
 * Parses an arbitrary-precision quantity inside `bounds`.
 *
 * Accepts a decimal string or a safe JSON integer. `0` is allowed here and
 * ranges are enforced by the caller (a memory limit has a different lower bound
 * than an advertised storage quota).
 */
export function parseBigIntQuantity(value: unknown, bounds: BigIntBounds): bigint | null {
  const parsed = toBigInt(value);

  if (parsed === null) {
    return null;
  }

  return parsed >= bounds.min && parsed <= bounds.max ? parsed : null;
}

/** Converts a JSON-safe representation to `BigInt`, or `null`. */
export function toBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? BigInt(value) : null;
  }

  if (typeof value === 'string' && DECIMAL_INTEGER.test(value)) {
    return BigInt(value);
  }

  return null;
}

/** True for a positive integer count (used for quantities and limits). */
export function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export const KIBIBYTE = 1024n;
export const MEBIBYTE = 1024n * KIBIBYTE;
export const GIBIBYTE = 1024n * MEBIBYTE;
export const TEBIBYTE = 1024n * GIBIBYTE;

/** True when `value` is a whole number of mebibytes (see resource profiles). */
export function isWholeMebibyte(value: bigint): boolean {
  return value % MEBIBYTE === 0n;
}
