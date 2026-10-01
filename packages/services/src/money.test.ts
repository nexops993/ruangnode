import { describe, expect, it } from 'vitest';

import { isCurrency, lineTotalMinor, parseMinorUnits, toMoneyJson } from './money.js';

/**
 * Money is an integer number of minor units in `BigInt` (docs/DATABASE.md).
 * These tests pin the two properties the rest of the platform depends on:
 * no floating point ever touches an amount, and no `BigInt` ever reaches JSON.
 */
describe('money', () => {
  it('parses integer minor units from every JSON-safe form', () => {
    expect(parseMinorUnits('40000')).toBe(40000n);
    expect(parseMinorUnits(40000)).toBe(40000n);
    expect(parseMinorUnits(0)).toBe(0n);
    expect(parseMinorUnits(1n)).toBe(1n);
  });

  it('rejects floats, negatives, exponents and separators', () => {
    expect(parseMinorUnits('1.5')).toBeNull();
    expect(parseMinorUnits(1.5)).toBeNull();
    expect(parseMinorUnits('-1')).toBeNull();
    expect(parseMinorUnits('1e3')).toBeNull();
    expect(parseMinorUnits('40,000')).toBeNull();
    expect(parseMinorUnits('0.1')).toBeNull();
    expect(parseMinorUnits(true)).toBeNull();
    expect(parseMinorUnits(null)).toBeNull();
    expect(parseMinorUnits(undefined)).toBeNull();
    expect(parseMinorUnits(Number.NaN)).toBeNull();
    expect(parseMinorUnits(Number.MAX_SAFE_INTEGER + 2)).toBeNull();
  });

  it('respects the bounds it is given', () => {
    expect(parseMinorUnits(0, { min: 1n, max: 1000n })).toBeNull();
    expect(parseMinorUnits(1, { min: 1n, max: 1000n })).toBe(1n);
    expect(parseMinorUnits(1001, { min: 1n, max: 1000n })).toBeNull();
  });

  it('serialises BigInt as a decimal string so JSON never sees a BigInt', () => {
    const money = toMoneyJson(40000n, 'IDR');

    expect(money).toEqual({ amount: '40000', currency: 'IDR' });
    // JSON.stringify throws on a BigInt; the wire format must never contain one.
    expect(() => JSON.stringify(money)).not.toThrow();
    expect(JSON.stringify(money)).toBe('{"amount":"40000","currency":"IDR"}');
  });

  it('multiplies a line in BigInt, never in floating point', () => {
    expect(lineTotalMinor(149_000n, 3)).toBe(447_000n);
    expect(typeof lineTotalMinor(149_000n, 3)).toBe('bigint');
    // The value that a float would get wrong by a minor unit.
    expect(lineTotalMinor(100_001n, 7)).toBe(700_007n);
  });

  it('accepts only upper-case ISO 4217 alpha-3 currencies', () => {
    expect(isCurrency('IDR')).toBe(true);
    expect(isCurrency('USD')).toBe(true);
    expect(isCurrency('idr')).toBe(false);
    expect(isCurrency('ID')).toBe(false);
    expect(isCurrency('IDRR')).toBe(false);
    expect(isCurrency(42)).toBe(false);
  });
});
