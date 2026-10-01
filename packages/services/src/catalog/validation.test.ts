import { ProductStatus } from '@ruangnode/database';
import { AppError } from '@ruangnode/shared';
import { describe, expect, it } from 'vitest';

import {
  assertBillingPeriodMatchesProductType,
  assertResourceProfileMatchesProductType,
  parseCreateProductInput,
  parseCreateVariantInput,
  parseProductStatusInput,
  parseUpdateProductInput,
  parseUpdateVariantInput,
} from './validation.js';

const RESOURCE_PROFILE_ID = '01990000-0000-7000-8000-000000000001';

function expectValidationFailure(fn: () => unknown, field?: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('VALIDATION_FAILED');

    if (field !== undefined) {
      expect((error as AppError).message).toContain(field);
    }

    return;
  }

  throw new Error('Expected the call to fail validation.');
}

/**
 * The domain re-validates everything, even behind a schema-validated route, so a
 * service caller (admin tool, test, future CLI) cannot bypass a rule — and so a
 * server-owned field can never be smuggled in by a client.
 */
describe('product input', () => {
  it('parses a complete product', () => {
    expect(
      parseCreateProductInput({
        slug: 'hermes-managed',
        name: 'Hermes Agent (Managed)',
        description: 'Managed instance on isolated capacity.',
        type: 'MANAGED_SERVICE',
        serviceType: 'hermes',
      }),
    ).toEqual({
      slug: 'hermes-managed',
      name: 'Hermes Agent (Managed)',
      description: 'Managed instance on isolated capacity.',
      type: 'MANAGED_SERVICE',
      serviceType: 'hermes',
    });
  });

  it('defaults the optional fields to null', () => {
    expect(parseCreateProductInput({ slug: 'starter-kit', name: 'Starter', type: 'DIGITAL' })).toEqual({
      slug: 'starter-kit',
      name: 'Starter',
      description: null,
      type: 'DIGITAL',
      serviceType: null,
    });
  });

  it('refuses a status: publication is a guarded transition, not a field', () => {
    expectValidationFailure(
      () =>
        parseCreateProductInput({
          slug: 'starter-kit',
          name: 'Starter',
          type: 'DIGITAL',
          status: 'ACTIVE',
        }),
      'status',
    );
    expectValidationFailure(
      () => parseUpdateProductInput({ status: 'ACTIVE' }),
      'status',
    );
  });

  it('rejects unknown fields, an invalid slug and an empty patch', () => {
    expectValidationFailure(
      () => parseCreateProductInput({ slug: 'ok-slug', name: 'A', type: 'DIGITAL', ownerId: 'x' }),
      'ownerId',
    );
    expectValidationFailure(
      () => parseCreateProductInput({ slug: 'Not A Slug', name: 'A', type: 'DIGITAL' }),
      'slug',
    );
    expectValidationFailure(() => parseUpdateProductInput({}), 'body');
  });

  it('reads a valid lifecycle target and rejects anything else', () => {
    expect(parseProductStatusInput({ status: 'ACTIVE' })).toBe('ACTIVE');
    expectValidationFailure(() => parseProductStatusInput({ status: 'BOGUS' }), 'status');
    expectValidationFailure(() => parseProductStatusInput({}), 'status');
    expect(Object.values(ProductStatus)).toContain('ARCHIVED');
  });
});

describe('product variant input', () => {
  const validVariant = {
    name: 'Starter',
    sku: 'HERMES-STARTER',
    priceMinor: '149000',
    currency: 'IDR',
    billingPeriod: 'MONTHLY',
    resourceProfileId: RESOURCE_PROFILE_ID,
    storageQuotaBytes: '5368709120',
  };

  it('parses money as an integer number of minor units', () => {
    const parsed = parseCreateVariantInput(validVariant);

    expect(parsed.priceMinor).toBe(149_000n);
    expect(typeof parsed.priceMinor).toBe('bigint');
    expect(parsed.storageQuotaBytes).toBe(5_368_709_120n);
    expect(parsed.resourceProfileId).toBe(RESOURCE_PROFILE_ID);
    expect(parsed.configurationSchema).toBeNull();
  });

  it('accepts a JSON integer price as well', () => {
    expect(parseCreateVariantInput({ ...validVariant, priceMinor: 149_000 }).priceMinor).toBe(
      149_000n,
    );
  });

  it('rejects a non-positive, fractional or formatted price', () => {
    for (const priceMinor of ['0', '-1', '1.5', '1e3', '40,000', 1.5, -1]) {
      expectValidationFailure(
        () => parseCreateVariantInput({ ...validVariant, priceMinor }),
        'priceMinor',
      );
    }
  });

  it('rejects an invalid currency, SKU and billing period', () => {
    expectValidationFailure(
      () => parseCreateVariantInput({ ...validVariant, currency: 'idr' }),
      'currency',
    );
    expectValidationFailure(
      () => parseCreateVariantInput({ ...validVariant, currency: 'ID' }),
      'currency',
    );
    expectValidationFailure(() => parseCreateVariantInput({ ...validVariant, sku: 'a' }), 'sku');
    expectValidationFailure(
      () => parseCreateVariantInput({ ...validVariant, billingPeriod: 'WEEKLY' }),
      'billingPeriod',
    );
  });

  it('refuses server-owned fields on a variant', () => {
    for (const smuggled of [
      { status: 'ACTIVE' },
      { productId: RESOURCE_PROFILE_ID },
      { total: '1' },
      { createdAt: '2020-01-01' },
    ]) {
      expectValidationFailure(() => parseCreateVariantInput({ ...validVariant, ...smuggled }));
    }
  });

  it('accepts an empty-free patch and rejects a patch without fields', () => {
    expect(parseUpdateVariantInput({ priceMinor: '299000' })).toEqual({ priceMinor: 299_000n });
    expect(parseUpdateVariantInput({ resourceProfileId: null })).toEqual({ resourceProfileId: null });
    expectValidationFailure(() => parseUpdateVariantInput({}), 'body');
  });

  it('keeps a billing period consistent with the product type', () => {
    expect(() =>
      assertBillingPeriodMatchesProductType('MANAGED_SERVICE', 'MONTHLY'),
    ).not.toThrow();
    expect(() => assertBillingPeriodMatchesProductType('DIGITAL', 'ONE_TIME')).not.toThrow();
    expect(() => assertBillingPeriodMatchesProductType('SUBSCRIPTION', 'YEARLY')).not.toThrow();

    expectValidationFailure(
      () => assertBillingPeriodMatchesProductType('DIGITAL', 'MONTHLY'),
      'billingPeriod',
    );
    expectValidationFailure(
      () => assertBillingPeriodMatchesProductType('SUBSCRIPTION', 'ONE_TIME'),
      'billingPeriod',
    );
  });

  it('keeps the resource class consistent with the product type', () => {
    expect(() =>
      assertResourceProfileMatchesProductType('MANAGED_SERVICE', RESOURCE_PROFILE_ID),
    ).not.toThrow();
    expect(() => assertResourceProfileMatchesProductType('SUBSCRIPTION', null)).not.toThrow();

    expectValidationFailure(
      () => assertResourceProfileMatchesProductType('MANAGED_SERVICE', null),
      'resourceProfileId',
    );
    expectValidationFailure(
      () => assertResourceProfileMatchesProductType('DIGITAL', RESOURCE_PROFILE_ID),
      'resourceProfileId',
    );
  });
});

