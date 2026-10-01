import { describe, expect, it } from 'vitest';

import { AppError } from '@ruangnode/shared';

import { calculateOrderTotals, isValidQuantity } from './pricing.js';

function expectValidationFailure(fn: () => unknown, field?: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('VALIDATION_FAILED');
    expect((error as AppError).httpStatus).toBe(422);

    if (field !== undefined) {
      expect((error as AppError).message).toContain(field);
    }

    return;
  }

  throw new Error('Expected the call to fail validation.');
}

/**
 * Order totals are computed server-side in integer minor units.
 * Nothing here accepts a price from a request: the caller reads it from the
 * stored variant (`.clinerules` → Payments).
 */
describe('calculateOrderTotals', () => {
  it('computes subtotal and total in integer minor units', () => {
    const totals = calculateOrderTotals([
      { unitPriceMinor: 149_000n, quantity: 1, currency: 'IDR' },
    ]);

    expect(totals).toEqual({
      currency: 'IDR',
      subtotalMinor: 149_000n,
      discountMinor: 0n,
      totalMinor: 149_000n,
    });
    expect(typeof totals.totalMinor).toBe('bigint');
  });

  it('multiplies a line by its quantity without float drift', () => {
    const totals = calculateOrderTotals([
      { unitPriceMinor: 149_001n, quantity: 3, currency: 'IDR' },
    ]);

    expect(totals.subtotalMinor).toBe(447_003n);
    expect(totals.totalMinor).toBe(447_003n);
  });

  it('applies a server-side discount that never makes the total negative', () => {
    const totals = calculateOrderTotals(
      [{ unitPriceMinor: 100_000n, quantity: 2, currency: 'IDR' }],
      25_000n,
    );

    expect(totals.subtotalMinor).toBe(200_000n);
    expect(totals.discountMinor).toBe(25_000n);
    expect(totals.totalMinor).toBe(175_000n);
  });

  it('rejects an order without lines', () => {
    expectValidationFailure(() => calculateOrderTotals([]), 'items');
  });

  it('rejects lines in different currencies', () => {
    expectValidationFailure(
      () =>
        calculateOrderTotals([
          { unitPriceMinor: 1n, quantity: 1, currency: 'IDR' },
          { unitPriceMinor: 1n, quantity: 1, currency: 'USD' },
        ]),
      'items',
    );
  });

  it('rejects a non-positive price and a nonsensical quantity', () => {
    expectValidationFailure(
      () => calculateOrderTotals([{ unitPriceMinor: 0n, quantity: 1, currency: 'IDR' }]),
      'priceMinor',
    );

    expectValidationFailure(
      () => calculateOrderTotals([{ unitPriceMinor: 1n, quantity: 0, currency: 'IDR' }]),
      'quantity',
    );
  });

  it('rejects a discount larger than the subtotal', () => {
    expectValidationFailure(
      () =>
        calculateOrderTotals([{ unitPriceMinor: 100n, quantity: 1, currency: 'IDR' }], 500n),
      'discount',
    );
  });

  it('bounds the quantity a customer may order', () => {
    expect(isValidQuantity(1)).toBe(true);
    expect(isValidQuantity(10)).toBe(true);
    expect(isValidQuantity(0)).toBe(false);
    expect(isValidQuantity(11)).toBe(false);
    expect(isValidQuantity(1.5)).toBe(false);
    expect(isValidQuantity('2')).toBe(false);
  });
});
