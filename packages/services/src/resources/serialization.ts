/**
 * Resource profile serialisation.
 *
 * Two projections, one source:
 *
 *   - the public profile is part of the catalog (a customer must be able to see
 *     what they buy, and docs/RESOURCE_ISOLATION.md requires the difference
 *     between enforced, allocated and monitored disk to stay visible)
 *   - the admin profile adds the lifecycle fields (`active`, timestamps)
 *
 * Byte quantities and money are stringified; no `BigInt` reaches JSON.
 */
import type { DiskPolicy, MemorySwapPolicy, ResourceProfileRecord } from './types.js';

/** The resource class as advertised to a customer. */
export interface PublicResourceProfile {
  id: string;
  name: string;
  cpuLimitMillicores: number;
  memoryLimitBytes: string;
  memorySwapBytes: string | null;
  memorySwapPolicy: MemorySwapPolicy;
  diskLimitBytes: string;
  diskPolicy: DiskPolicy;
  pidsLimit: number;
  networkPolicy: string | null;
  description: string | null;
}

/** The resource class as an administrator sees it. */
export interface AdminResourceProfile extends PublicResourceProfile {
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toPublicResourceProfile(record: ResourceProfileRecord): PublicResourceProfile {
  return {
    id: record.id,
    name: record.name,
    cpuLimitMillicores: record.cpuLimitMillicores,
    memoryLimitBytes: record.memoryLimitBytes.toString(),
    memorySwapBytes: record.memorySwapBytes === null ? null : record.memorySwapBytes.toString(),
    memorySwapPolicy: record.memorySwapPolicy,
    diskLimitBytes: record.diskLimitBytes.toString(),
    diskPolicy: record.diskPolicy,
    pidsLimit: record.pidsLimit,
    networkPolicy: record.networkPolicy,
    description: record.description,
  };
}

export function toAdminResourceProfile(record: ResourceProfileRecord): AdminResourceProfile {
  return {
    ...toPublicResourceProfile(record),
    active: record.active,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
