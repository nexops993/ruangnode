import { describe, expect, it } from 'vitest';

import { err, isErr, isOk, ok, type Result } from './result.js';

describe('Result', () => {
  it('builds an Ok value', () => {
    const result = ok(42);

    expect(result).toEqual({ ok: true, value: 42 });
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
  });

  it('builds an Err value', () => {
    const result = err('not-found');

    expect(result).toEqual({ ok: false, error: 'not-found' });
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
  });

  it('narrows the type through the guards', () => {
    const result: Result<number, string> = ok(7);

    if (isOk(result)) {
      expect(result.value).toBe(7);
    } else {
      throw new Error('expected an Ok result');
    }
  });
});
