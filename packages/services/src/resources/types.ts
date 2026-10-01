/**
 * Resource profiles.
 *
 * A profile is the *enforceable resource class* of a managed service: CPU,
 * memory, swap, disk and PID limits in unambiguous units
 * (docs/RESOURCE_ISOLATION.md, docs/DATABASE.md).
 *
 * Phase boundary this module respects: a profile is configuration data. It is
 * not enforcement. Nothing here claims that a container runs with these limits —
 * that is the Node Agent's job in the runtime phase (`.clinerules` →
 * Completion criteria).
 */
import type { DiskPolicy, MemorySwapPolicy } from '@ruangnode/database';

import type { MinorUnits } from '../money.js';

export type { DiskPolicy, MemorySwapPolicy };

/** Domain view of a resource profile (never a Prisma model). */
export interface ResourceProfileRecord {
  id: string;
  name: string;
  cpuLimitMillicores: number;
  memoryLimitBytes: MinorUnits;
  memorySwapBytes: MinorUnits | null;
  memorySwapPolicy: MemorySwapPolicy;
  diskLimitBytes: MinorUnits;
  diskPolicy: DiskPolicy;
  pidsLimit: number;
  networkPolicy: string | null;
  description: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The documented resource model.
 *
 * These bounds exist so a profile cannot describe something the platform has no
 * way of expressing: 100 millicores … 64 CPU, 16 MiB … 1 TiB of memory,
 * 256 MiB … 8 TiB of disk and 32 … 32768 processes.
 */
export const RESOURCE_MODEL = {
  minCpuMillicores: 100,
  maxCpuMillicores: 64_000,
  minMemoryBytes: 16n * 1024n * 1024n,
  maxMemoryBytes: 1024n * 1024n * 1024n * 1024n,
  minDiskBytes: 256n * 1024n * 1024n,
  maxDiskBytes: 8n * 1024n * 1024n * 1024n * 1024n,
  minPidsLimit: 32,
  maxPidsLimit: 32_768,
  /**
   * A bounded swap limit may add at most this multiple of memory as headroom.
   * `memorySwapBytes` always describes the *total* limit (memory + swap), which
   * is the value Docker's `--memory-swap` expects.
   */
  maxSwapMultiplier: 2n,
  maxNameLength: 80,
  maxNetworkPolicyLength: 64,
  maxDescriptionLength: 1_000,
} as const;

/** Swappable policies: swap is derived, so no explicit byte value is allowed. */
export const DERIVED_SWAP_POLICIES: readonly MemorySwapPolicy[] = [
  'DISABLED',
  'EQUAL_TO_MEMORY',
];

export const MEMORY_SWAP_POLICIES: readonly MemorySwapPolicy[] = [
  'DISABLED',
  'EQUAL_TO_MEMORY',
  'BOUNDED',
];

export const DISK_POLICIES: readonly DiskPolicy[] = [
  'ENFORCED_QUOTA',
  'ALLOCATED',
  'MONITORED',
];

/** Policies under which the disk allowance is reserved or quota-enforced. */
export const RESERVED_DISK_POLICIES: readonly DiskPolicy[] = ['ENFORCED_QUOTA', 'ALLOCATED'];
