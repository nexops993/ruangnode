/**
 * Boundary parsing helpers for service input.
 *
 * Services are callable from HTTP handlers, from admin tooling and from tests,
 * so they validate their own input instead of trusting that a route schema ran
 * (`.clinerules` → API: validate input; `@ruangnode/auth` does the same). The
 * helpers below throw `AppError`s that name the field and the rule, and reject
 * unknown keys, so a smuggled field (a price, a status, another tenant's id)
 * cannot silently reach the domain.
 */
import { invalidCommerceInputError } from './errors.js';
import { parseBigIntQuantity, parseInteger, type BigIntBounds, type IntegerBounds } from './numbers.js';

const MAX_TEXT_LENGTH = 4_000;

/** Narrow a JSON value to a plain object (no arrays, no `null`). */
export function asRecord(value: unknown, context = 'body'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidCommerceInputError(context, 'must be an object');
  }

  return value as Record<string, unknown>;
}

export function has(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function assertKnownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  context = 'body',
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw invalidCommerceInputError(`${context}.${key}`, 'unknown field');
    }
  }
}

export function readString(
  record: Record<string, unknown>,
  key: string,
  options: { minLength?: number; maxLength?: number; pattern?: RegExp } = {},
): string {
  const value = record[key];
  const minLength = options.minLength ?? 1;
  const maxLength = options.maxLength ?? MAX_TEXT_LENGTH;

  if (typeof value !== 'string') {
    throw invalidCommerceInputError(key, 'must be a string');
  }

  const trimmed = value.trim();

  if (trimmed.length < minLength || trimmed.length > maxLength) {
    throw invalidCommerceInputError(key, `must be between ${minLength} and ${maxLength} characters`);
  }

  if (options.pattern !== undefined && !options.pattern.test(trimmed)) {
    throw invalidCommerceInputError(key, 'has an invalid format');
  }

  return trimmed;
}

/** A required string that keeps its inner text but must not be empty. */
export function readText(
  record: Record<string, unknown>,
  key: string,
  options: { maxLength?: number } = {},
): string {
  const value = record[key];

  if (typeof value !== 'string' || value.trim() === '') {
    throw invalidCommerceInputError(key, 'must be a non-empty string');
  }

  if (value.length > (options.maxLength ?? MAX_TEXT_LENGTH)) {
    throw invalidCommerceInputError(key, `must be at most ${options.maxLength ?? MAX_TEXT_LENGTH} characters`);
  }

  return value;
}

/** `undefined` and `null` both mean "not provided"; anything else must be text. */
export function readNullableText(
  record: Record<string, unknown>,
  key: string,
  options: { maxLength?: number } = {},
): string | null {
  const value = record[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw invalidCommerceInputError(key, 'must be a string or null');
  }

  if (value.length > (options.maxLength ?? MAX_TEXT_LENGTH)) {
    throw invalidCommerceInputError(key, `must be at most ${options.maxLength ?? MAX_TEXT_LENGTH} characters`);
  }

  return value;
}

export function readBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];

  if (typeof value !== 'boolean') {
    throw invalidCommerceInputError(key, 'must be a boolean');
  }

  return value;
}

/**
 * Identifiers are server-generated UUIDv7 values. A UUID supplied by a client is
 * only ever used for a lookup — never for authorization
 * (`.clinerules` → Multi-tenant security).
 */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readUuid(record: Record<string, unknown>, key: string): string {
  const value = record[key];

  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw invalidCommerceInputError(key, 'must be a UUID');
  }

  return value;
}

/** A UUID that may be omitted or cleared with `null`. */
export function readNullableUuid(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw invalidCommerceInputError(key, 'must be a UUID or null');
  }

  return value;
}

export function readEnum<const T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const value = record[key];

  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw invalidCommerceInputError(key, `must be one of ${allowed.join(', ')}`);
  }

  return value as T;
}

export function readInteger(
  record: Record<string, unknown>,
  key: string,
  bounds: IntegerBounds,
): number {
  const parsed = parseInteger(record[key], bounds);

  if (parsed === null) {
    throw invalidCommerceInputError(
      key,
      `must be an integer between ${bounds.min} and ${bounds.max}`,
    );
  }

  return parsed;
}

export function readBigInt(
  record: Record<string, unknown>,
  key: string,
  bounds: BigIntBounds,
): bigint {
  const parsed = parseBigIntQuantity(record[key], bounds);

  if (parsed === null) {
    throw invalidCommerceInputError(
      key,
      `must be an integer between ${bounds.min.toString()} and ${bounds.max.toString()}`,
    );
  }

  return parsed;
}

/** JSON Schema accepted for a variant's `configurationSchema` column. */
export const MAX_CONFIGURATION_SCHEMA_BYTES = 64 * 1024;

/**
 * Reads a non-secret configuration schema.
 *
 * Only a JSON object is accepted: the column describes which configuration a
 * customer may submit, and secrets never belong in it (see `.clinerules` →
 * Secrets, docs/DATABASE.md).
 */
export function readConfigurationSchema(
  record: Record<string, unknown>,
  key: string,
): unknown | null {
  const value = record[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw invalidCommerceInputError(key, 'must be a JSON object or null');
  }

  let serialized: string;

  try {
    serialized = JSON.stringify(value);
  } catch {
    throw invalidCommerceInputError(key, 'must be JSON-serialisable');
  }

  if (serialized.length > MAX_CONFIGURATION_SCHEMA_BYTES) {
    throw invalidCommerceInputError(key, `must be at most ${MAX_CONFIGURATION_SCHEMA_BYTES} bytes of JSON`);
  }

  return value;
}
