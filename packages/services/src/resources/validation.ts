/**
 * Input parsing and consistency rules for resource profiles.
 *
 * Two layers, deliberately:
 *
 *   - field rules (lengths, formats, ranges) are checked while parsing
 *   - *cross-field* rules (swap policy versus swap limit, disk policy versus
 *     disk granularity) are checked on the complete value set, so an update is
 *     validated against the merged result rather than against the patch
 */
import { invalidCommerceInputError } from '../errors.js';
import { isWholeMebibyte } from '../numbers.js';
import {
  assertKnownKeys,
  asRecord,
  has,
  readBigInt,
  readBoolean,
  readEnum,
  readInteger,
  readNullableText,
  readString,
} from '../validation.js';
import {
  DERIVED_SWAP_POLICIES,
  DISK_POLICIES,
  MEMORY_SWAP_POLICIES,
  RESERVED_DISK_POLICIES,
  RESOURCE_MODEL,
  type DiskPolicy,
  type MemorySwapPolicy,
} from './types.js';

/** Profile names are stable identifiers used by operators and dashboards. */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/** Provider-dependent network policy identifier, e.g. `UNMETERED`. */
const NETWORK_POLICY_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

/** The complete, unit-explicit resource description of a profile. */
export interface ResourceProfileValues {
  name: string;
  cpuLimitMillicores: number;
  memoryLimitBytes: bigint;
  memorySwapPolicy: MemorySwapPolicy;
  memorySwapBytes: bigint | null;
  diskLimitBytes: bigint;
  diskPolicy: DiskPolicy;
  pidsLimit: number;
  networkPolicy: string | null;
  description: string | null;
}

export interface CreateResourceProfileInput extends ResourceProfileValues {
  active: boolean;
}

/** A patch: absent keys leave the stored value untouched. */
export type UpdateResourceProfileInput = Partial<ResourceProfileValues> & { active?: boolean };

export const RESOURCE_PROFILE_INPUT_KEYS = [
  'name',
  'cpuLimitMillicores',
  'memoryLimitBytes',
  'memorySwapPolicy',
  'memorySwapBytes',
  'diskLimitBytes',
  'diskPolicy',
  'pidsLimit',
  'networkPolicy',
  'description',
  'active',
] as const;

type ProfileBody = Record<string, unknown>;

function readMemorySwapPolicy(body: ProfileBody): MemorySwapPolicy {
  return has(body, 'memorySwapPolicy')
    ? readEnum(body, 'memorySwapPolicy', MEMORY_SWAP_POLICIES)
    : 'EQUAL_TO_MEMORY';
}

function readDiskPolicy(body: ProfileBody): DiskPolicy {
  return has(body, 'diskPolicy') ? readEnum(body, 'diskPolicy', DISK_POLICIES) : 'ALLOCATED';
}

/** `null`, absent and an explicitly provided value are all distinguishable. */
function readMemorySwapBytes(body: ProfileBody): bigint | null {
  if (!has(body, 'memorySwapBytes') || body['memorySwapBytes'] === null) {
    return null;
  }

  return readBigInt(body, 'memorySwapBytes', {
    min: 1n,
    max: RESOURCE_MODEL.maxMemoryBytes * RESOURCE_MODEL.maxSwapMultiplier,
  });
}

function readNetworkPolicy(body: ProfileBody): string | null {
  const value = readNullableText(body, 'networkPolicy', {
    maxLength: RESOURCE_MODEL.maxNetworkPolicyLength,
  });

  if (value === null || value.trim() === '') {
    return null;
  }

  if (!NETWORK_POLICY_PATTERN.test(value.trim())) {
    throw invalidCommerceInputError('networkPolicy', 'must be an upper-case identifier');
  }

  return value.trim();
}

export function parseCreateResourceProfileInput(input: unknown): CreateResourceProfileInput {
  const body = asRecord(input);
  assertKnownKeys(body, RESOURCE_PROFILE_INPUT_KEYS);

  return {
    ...parseResourceProfileValues(body),
    active: has(body, 'active') ? readBoolean(body, 'active') : true,
  };
}

/** Reads the complete resource description of a profile from a request body. */
function parseResourceProfileValues(body: ProfileBody): ResourceProfileValues {
  const values: ResourceProfileValues = {
    name: readString(body, 'name', {
      maxLength: RESOURCE_MODEL.maxNameLength,
      pattern: NAME_PATTERN,
    }),
    cpuLimitMillicores: readInteger(body, 'cpuLimitMillicores', {
      min: RESOURCE_MODEL.minCpuMillicores,
      max: RESOURCE_MODEL.maxCpuMillicores,
    }),
    memoryLimitBytes: readBigInt(body, 'memoryLimitBytes', {
      min: RESOURCE_MODEL.minMemoryBytes,
      max: RESOURCE_MODEL.maxMemoryBytes,
    }),
    memorySwapPolicy: readMemorySwapPolicy(body),
    memorySwapBytes: readMemorySwapBytes(body),
    diskLimitBytes: readBigInt(body, 'diskLimitBytes', {
      min: RESOURCE_MODEL.minDiskBytes,
      max: RESOURCE_MODEL.maxDiskBytes,
    }),
    diskPolicy: readDiskPolicy(body),
    pidsLimit: readInteger(body, 'pidsLimit', {
      min: RESOURCE_MODEL.minPidsLimit,
      max: RESOURCE_MODEL.maxPidsLimit,
    }),
    networkPolicy: readNetworkPolicy(body),
    description: readNullableText(body, 'description', {
      maxLength: RESOURCE_MODEL.maxDescriptionLength,
    }),
  };

  assertResourceProfileValues(values);

  return values;
}

/**
 * Cross-field consistency of a complete profile.
 *
 *   - a derived swap policy (`DISABLED`, `EQUAL_TO_MEMORY`) must not carry an
 *     explicit limit: the effective value is computed from the policy, and a
 *     stale byte value would contradict it
 *   - `BOUNDED` must carry a limit between memory and twice memory, because
 *     `memorySwapBytes` is the *total* limit (memory + swap)
 *   - when disk is reserved or quota-enforced it must be a whole number of
 *     mebibytes; a monitoring-only allowance may be any positive value, since
 *     nothing is reserved for it
 */
export function assertResourceProfileValues(values: ResourceProfileValues): void {
  const { memoryLimitBytes, memorySwapPolicy, memorySwapBytes, diskLimitBytes, diskPolicy } =
    values;

  if (DERIVED_SWAP_POLICIES.includes(memorySwapPolicy)) {
    if (memorySwapBytes !== null) {
      throw invalidCommerceInputError(
        'memorySwapBytes',
        `must be absent when memorySwapPolicy is ${memorySwapPolicy}`,
      );
    }
  } else if (memorySwapBytes === null) {
    throw invalidCommerceInputError(
      'memorySwapBytes',
      'is required when memorySwapPolicy is BOUNDED',
    );
  } else if (memorySwapBytes < memoryLimitBytes) {
    throw invalidCommerceInputError(
      'memorySwapBytes',
      'must be greater than or equal to memoryLimitBytes (the limit is memory plus swap)',
    );
  } else if (memorySwapBytes > memoryLimitBytes * RESOURCE_MODEL.maxSwapMultiplier) {
    throw invalidCommerceInputError(
      'memorySwapBytes',
      `must be at most ${RESOURCE_MODEL.maxSwapMultiplier.toString()}x memoryLimitBytes`,
    );
  }

  if (RESERVED_DISK_POLICIES.includes(diskPolicy) && !isWholeMebibyte(diskLimitBytes)) {
    throw invalidCommerceInputError(
      'diskLimitBytes',
      `must be a whole number of mebibytes when diskPolicy is ${diskPolicy}`,
    );
  }
}

export function parseUpdateResourceProfileInput(input: unknown): UpdateResourceProfileInput {
  const body = asRecord(input);
  assertKnownKeys(body, RESOURCE_PROFILE_INPUT_KEYS);

  const patch: UpdateResourceProfileInput = {};

  if (has(body, 'name')) {
    patch.name = readString(body, 'name', {
      maxLength: RESOURCE_MODEL.maxNameLength,
      pattern: NAME_PATTERN,
    });
  }

  if (has(body, 'cpuLimitMillicores')) {
    patch.cpuLimitMillicores = readInteger(body, 'cpuLimitMillicores', {
      min: RESOURCE_MODEL.minCpuMillicores,
      max: RESOURCE_MODEL.maxCpuMillicores,
    });
  }

  if (has(body, 'memoryLimitBytes')) {
    patch.memoryLimitBytes = readBigInt(body, 'memoryLimitBytes', {
      min: RESOURCE_MODEL.minMemoryBytes,
      max: RESOURCE_MODEL.maxMemoryBytes,
    });
  }

  if (has(body, 'memorySwapPolicy')) {
    patch.memorySwapPolicy = readEnum(body, 'memorySwapPolicy', MEMORY_SWAP_POLICIES);
  }

  // `memorySwapBytes` may be patched to `null`; the policy then derives it.
  if (has(body, 'memorySwapBytes')) {
    patch.memorySwapBytes = readMemorySwapBytes(body);
  }

  if (has(body, 'diskLimitBytes')) {
    patch.diskLimitBytes = readBigInt(body, 'diskLimitBytes', {
      min: RESOURCE_MODEL.minDiskBytes,
      max: RESOURCE_MODEL.maxDiskBytes,
    });
  }

  if (has(body, 'diskPolicy')) {
    patch.diskPolicy = readEnum(body, 'diskPolicy', DISK_POLICIES);
  }

  if (has(body, 'pidsLimit')) {
    patch.pidsLimit = readInteger(body, 'pidsLimit', {
      min: RESOURCE_MODEL.minPidsLimit,
      max: RESOURCE_MODEL.maxPidsLimit,
    });
  }

  if (has(body, 'networkPolicy')) {
    patch.networkPolicy = readNetworkPolicy(body);
  }

  if (has(body, 'description')) {
    patch.description = readNullableText(body, 'description', {
      maxLength: RESOURCE_MODEL.maxDescriptionLength,
    });
  }

  if (has(body, 'active')) {
    patch.active = readBoolean(body, 'active');
  }

  if (Object.keys(patch).length === 0) {
    throw invalidCommerceInputError('body', 'must contain at least one field to update');
  }

  return patch;
}
