/**
 * Password hashing (Argon2id) and the password policy.
 *
 * Argon2id is required by docs/SECURITY.md. The parameters below follow the
 * OWASP recommendation (19 MiB memory, 2 iterations, 1 degree of parallelism)
 * and are recorded in the PHC string of every hash, so a future parameter
 * increase can be rolled out without invalidating existing hashes: on a
 * successful verification `needsRehash()` reports that the stored hash uses
 * outdated parameters.
 */
import { hash as argon2Hash, parseOptions, verify as argon2Verify } from '@node-rs/argon2';

export interface Argon2idParams {
  /** Memory cost in kibibytes (KiB). */
  memoryCostKib: number;
  /** Number of passes over the memory. */
  timeCost: number;
  /** Degree of parallelism (threads). */
  parallelism: number;
  /** Length of the raw hash output in bytes. */
  outputLen: number;
}

export const DEFAULT_ARGON2ID_PARAMS: Argon2idParams = {
  memoryCostKib: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

/**
 * The PHC prefix produced by the Argon2id parameters above. Asserted by the
 * test suite so a silent algorithm change (for example falling back to a plain
 * SHA) can never pass unnoticed.
 */
export const ARGON2ID_HASH_PREFIX = '$argon2id$v=19$m=19456,t=2,p=1$';

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  /** True when a stored hash was produced with different parameters. */
  needsRehash(hash: string): boolean;
}

/**
 * Creates the Argon2id password hasher.
 *
 * The algorithm is deliberately not passed as an option: `@node-rs/argon2`
 * exposes it as an ambient `const enum`, which cannot be imported under
 * `isolatedModules`. Argon2id is that library's default, and `ARGON2ID_HASH_PREFIX`
 * is asserted by the tests to prove the algorithm actually in use.
 */
export function createArgon2idPasswordHasher(
  params: Argon2idParams = DEFAULT_ARGON2ID_PARAMS,
): PasswordHasher {
  const options = {
    memoryCost: params.memoryCostKib,
    timeCost: params.timeCost,
    parallelism: params.parallelism,
    outputLen: params.outputLen,
  };

  return {
    hash: (password: string) => argon2Hash(password, options),

    verify: async (hash: string, password: string) => {
      try {
        return await argon2Verify(hash, password);
      } catch {
        // A malformed or truncated hash must fail closed, never throw a
        // distinguishable error to the caller.
        return false;
      }
    },

    needsRehash: (hash: string) => {
      try {
        const parsed = parseOptions(hash);

        return (
          parsed.memoryCost !== params.memoryCostKib ||
          parsed.timeCost !== params.timeCost ||
          parsed.parallelism !== params.parallelism ||
          parsed.outputLen !== params.outputLen
        );
      } catch {
        return true;
      }
    },
  };
}

export interface PasswordPolicy {
  minLength: number;
  maxLength: number;
}

/**
 * NIST-style length policy. `maxLength` is not cosmetic: hashing is
 * intentionally expensive, so an unbounded input is a cheap denial-of-service
 * vector.
 */
export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 12,
  maxLength: 200,
};

export type PasswordPolicyViolationCode = 'TOO_SHORT' | 'TOO_LONG' | 'CONTAINS_EMAIL';

export interface PasswordPolicyViolation {
  code: PasswordPolicyViolationCode;
  /** User-safe explanation. Never echoes the submitted password. */
  message: string;
}

/** Shortest email local part that is worth checking against the password. */
const MIN_LOCAL_PART_LENGTH = 3;

/**
 * Validates a password against the policy.
 *
 * Returns `null` when the password is acceptable. The password itself is never
 * included in the returned message.
 */
export function findPasswordPolicyViolation(
  password: string,
  options: { email?: string | null; policy?: PasswordPolicy } = {},
): PasswordPolicyViolation | null {
  const policy = options.policy ?? DEFAULT_PASSWORD_POLICY;

  if (password.length < policy.minLength) {
    return {
      code: 'TOO_SHORT',
      message: `Password must be at least ${policy.minLength} characters long.`,
    };
  }

  if (password.length > policy.maxLength) {
    return {
      code: 'TOO_LONG',
      message: `Password must be at most ${policy.maxLength} characters long.`,
    };
  }

  const localPart = options.email?.split('@')[0]?.trim().toLowerCase() ?? '';

  if (localPart.length >= MIN_LOCAL_PART_LENGTH && password.toLowerCase().includes(localPart)) {
    return {
      code: 'CONTAINS_EMAIL',
      message: 'Password must not contain your email address.',
    };
  }

  return null;
}
