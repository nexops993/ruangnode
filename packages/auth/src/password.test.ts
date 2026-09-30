import { describe, expect, it } from 'vitest';

import {
  ARGON2ID_HASH_PREFIX,
  createArgon2idPasswordHasher,
  DEFAULT_ARGON2ID_PARAMS,
  DEFAULT_PASSWORD_POLICY,
  findPasswordPolicyViolation,
} from './password.js';

const PASSWORD = 'correct horse battery staple';

describe('Argon2id password hashing', () => {
  const hasher = createArgon2idPasswordHasher();

  it('produces an Argon2id hash with the OWASP parameters', async () => {
    const hash = await hasher.hash(PASSWORD);

    // The PHC string is the proof of the algorithm and its parameters.
    expect(hash.startsWith(ARGON2ID_HASH_PREFIX)).toBe(true);
    expect(ARGON2ID_HASH_PREFIX).toBe('$argon2id$v=19$m=19456,t=2,p=1$');
  });

  it('verifies the correct password and rejects wrong ones', async () => {
    const hash = await hasher.hash(PASSWORD);

    await expect(hasher.verify(hash, PASSWORD)).resolves.toBe(true);
    await expect(hasher.verify(hash, 'Correct horse battery staple')).resolves.toBe(false);
    await expect(hasher.verify(hash, '')).resolves.toBe(false);
  });

  it('never stores the plaintext password', async () => {
    const hash = await hasher.hash(PASSWORD);

    expect(hash).not.toContain('correct');
    expect(hash).not.toContain('horse');
    expect(hash).not.toContain(PASSWORD);
  });

  it('salts every hash, so equal passwords produce different digests', async () => {
    const first = await hasher.hash('same-password-value');
    const second = await hasher.hash('same-password-value');

    expect(first).not.toBe(second);
  });

  it('fails closed for a malformed hash instead of throwing', async () => {
    await expect(hasher.verify('not-a-phc-string', PASSWORD)).resolves.toBe(false);
  });

  it('flags hashes produced with outdated parameters for rehashing', async () => {
    const legacy = createArgon2idPasswordHasher({ ...DEFAULT_ARGON2ID_PARAMS, timeCost: 1 });
    const legacyHash = await legacy.hash(PASSWORD);
    const currentHash = await hasher.hash(PASSWORD);

    expect(hasher.needsRehash(legacyHash)).toBe(true);
    expect(legacy.needsRehash(legacyHash)).toBe(false);
    expect(hasher.needsRehash(currentHash)).toBe(false);
    expect(hasher.needsRehash('garbage')).toBe(true);
  });
});

describe('password policy', () => {
  it('enforces the documented length bounds', () => {
    expect(findPasswordPolicyViolation('too-short')).toMatchObject({ code: 'TOO_SHORT' });
    expect(
      findPasswordPolicyViolation('a'.repeat(DEFAULT_PASSWORD_POLICY.maxLength + 1)),
    ).toMatchObject({ code: 'TOO_LONG' });
    expect(findPasswordPolicyViolation('a'.repeat(DEFAULT_PASSWORD_POLICY.minLength))).toBeNull();
  });

  it('rejects a password containing the email local part', () => {
    expect(
      findPasswordPolicyViolation('ada-lovelace-2026', { email: 'ada@example.com' }),
    ).toMatchObject({ code: 'CONTAINS_EMAIL' });
  });

  it('does not echo the submitted password in the violation message', () => {
    const violation = findPasswordPolicyViolation('tiny-secret', { email: 'x@y.example' });

    expect(violation).toMatchObject({ code: 'TOO_SHORT' });
    expect(violation?.message).not.toContain('tiny-secret');
  });
});
