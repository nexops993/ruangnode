import { AppError } from '@ruangnode/shared';
import { describe, expect, it } from 'vitest';

import { parseCreateResourceProfileInput, parseUpdateResourceProfileInput } from './validation.js';

const MEBIBYTE = 1024n * 1024n;
const GIBIBYTE = 1024n * MEBIBYTE;

const validProfile = {
  name: 'STARTER',
  cpuLimitMillicores: 1000,
  memoryLimitBytes: GIBIBYTE.toString(),
  diskLimitBytes: (5n * GIBIBYTE).toString(),
  pidsLimit: 256,
};

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
 * A resource profile must describe something the platform could actually apply:
 * positive CPU, memory and PID bounds, an explicit swap policy and a disk policy
 * that does not claim a quota it cannot enforce
 * (docs/RESOURCE_ISOLATION.md, docs/DATABASE.md).
 *
 * These are configuration rules only — nothing here enforces a limit.
 */
describe('resource profile input', () => {
  it('parses byte quantities as BigInt and applies the documented defaults', () => {
    const parsed = parseCreateResourceProfileInput(validProfile);

    expect(parsed.memoryLimitBytes).toBe(GIBIBYTE);
    expect(typeof parsed.memoryLimitBytes).toBe('bigint');
    expect(parsed.diskLimitBytes).toBe(5n * GIBIBYTE);
    expect(parsed.memorySwapPolicy).toBe('EQUAL_TO_MEMORY');
    expect(parsed.memorySwapBytes).toBeNull();
    expect(parsed.diskPolicy).toBe('ALLOCATED');
    expect(parsed.active).toBe(true);
    expect(parsed.networkPolicy).toBeNull();
    expect(parsed.description).toBeNull();
  });

  it('rejects CPU, memory and PID values that are not positive or out of range', () => {
    const cases: readonly [string, number | string][] = [
      ['cpuLimitMillicores', 0],
      ['cpuLimitMillicores', 50],
      ['cpuLimitMillicores', 128_000],
      ['memoryLimitBytes', '0'],
      ['memoryLimitBytes', '1.5'],
      ['pidsLimit', 0],
      ['pidsLimit', 1_000_000],
    ];

    for (const [field, value] of cases) {
      expectValidationFailure(
        () => parseCreateResourceProfileInput({ ...validProfile, [field]: value }),
        field,
      );
    }
  });

  it('rejects unknown fields, invalid names and a patch without fields', () => {
    expectValidationFailure(
      () => parseCreateResourceProfileInput({ ...validProfile, dockerFlags: '--privileged' }),
      'dockerFlags',
    );
    expectValidationFailure(
      () => parseCreateResourceProfileInput({ ...validProfile, name: 'not a name!' }),
      'name',
    );
    expectValidationFailure(
      () => parseCreateResourceProfileInput({ ...validProfile, networkPolicy: 'unmetered' }),
      'networkPolicy',
    );
    expectValidationFailure(() => parseUpdateResourceProfileInput({}), 'body');
  });

  it('parses a partial patch with byte quantities', () => {
    expect(parseUpdateResourceProfileInput({ pidsLimit: 512 })).toEqual({ pidsLimit: 512 });
    expect(parseUpdateResourceProfileInput({ memoryLimitBytes: (2n * GIBIBYTE).toString() })).toEqual(
      { memoryLimitBytes: 2n * GIBIBYTE },
    );
    expect(parseUpdateResourceProfileInput({ memorySwapBytes: null })).toEqual({
      memorySwapBytes: null,
    });
    expect(parseUpdateResourceProfileInput({ active: false })).toEqual({ active: false });
  });

  it('keeps the swap policy consistent with the explicit swap limit', () => {
    // A derived policy must not carry a stale byte value.
    for (const policy of ['DISABLED', 'EQUAL_TO_MEMORY']) {
      expectValidationFailure(
        () =>
          parseCreateResourceProfileInput({
            ...validProfile,
            memorySwapPolicy: policy,
            memorySwapBytes: GIBIBYTE.toString(),
          }),
        'memorySwapBytes',
      );
    }

    // BOUNDED requires a limit, and the limit is memory plus swap.
    expectValidationFailure(
      () => parseCreateResourceProfileInput({ ...validProfile, memorySwapPolicy: 'BOUNDED' }),
      'memorySwapBytes',
    );
    expectValidationFailure(
      () =>
        parseCreateResourceProfileInput({
          ...validProfile,
          memorySwapPolicy: 'BOUNDED',
          memorySwapBytes: (GIBIBYTE / 2n).toString(),
        }),
      'memorySwapBytes',
    );
    expectValidationFailure(
      () =>
        parseCreateResourceProfileInput({
          ...validProfile,
          memorySwapPolicy: 'BOUNDED',
          memorySwapBytes: (4n * GIBIBYTE).toString(),
        }),
      'memorySwapBytes',
    );
    expect(() =>
      parseCreateResourceProfileInput({
        ...validProfile,
        memorySwapPolicy: 'BOUNDED',
        memorySwapBytes: (2n * GIBIBYTE).toString(),
      }),
    ).not.toThrow();
  });

  it('requires whole mebibytes only when disk is reserved or quota-enforced', () => {
    const oddDisk = {
      ...validProfile,
      diskLimitBytes: (GIBIBYTE + MEBIBYTE / 2n).toString(),
    };

    expectValidationFailure(
      () => parseCreateResourceProfileInput({ ...oddDisk, diskPolicy: 'ENFORCED_QUOTA' }),
      'diskLimitBytes',
    );
    expectValidationFailure(
      () => parseCreateResourceProfileInput({ ...oddDisk, diskPolicy: 'ALLOCATED' }),
      'diskLimitBytes',
    );
    // Monitoring-only disk reserves nothing, so any positive value is honest.
    expect(() =>
      parseCreateResourceProfileInput({ ...oddDisk, diskPolicy: 'MONITORED' }),
    ).not.toThrow();
  });
});
