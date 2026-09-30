import { describe, expect, it } from 'vitest';

import { constantTimeEquals, generateSecretToken, hashSecretToken } from './tokens.js';

describe('secret tokens', () => {
  it('generates a high-entropy url-safe token', () => {
    const token = generateSecretToken();

    // 32 random bytes, base64url encoded.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('never repeats a token', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateSecretToken()));

    expect(tokens.size).toBe(200);
  });

  it('hashes deterministically so it can be used as a unique index key', () => {
    const token = generateSecretToken();

    expect(hashSecretToken(token)).toBe(hashSecretToken(token));
    expect(hashSecretToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not leak the token through its hash', () => {
    const token = generateSecretToken();

    expect(hashSecretToken(token)).not.toContain(token);
  });
});

describe('constantTimeEquals', () => {
  it('accepts equal values', () => {
    expect(constantTimeEquals('abc123', 'abc123')).toBe(true);
  });

  it('rejects different values, including different lengths', () => {
    expect(constantTimeEquals('abc123', 'abc124')).toBe(false);
    expect(constantTimeEquals('abc123', 'abc1234')).toBe(false);
    expect(constantTimeEquals('', 'a')).toBe(false);
  });

  it('handles multi-byte characters without throwing', () => {
    expect(constantTimeEquals('näme', 'näme')).toBe(true);
    expect(constantTimeEquals('näme', 'name')).toBe(false);
  });
});
