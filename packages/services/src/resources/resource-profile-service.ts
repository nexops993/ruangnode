/**
 * Resource profile service.
 *
 * Phase scope: a profile is *configuration*. This service validates what a
 * profile may describe and guards its lifecycle — it does not, and must not,
 * claim that any container is limited by these values. Applying and verifying
 * limits is the Node Agent's job (docs/RESOURCE_ISOLATION.md, `.clinerules` →
 * Resource isolation / Completion criteria).
 *
 * Lifecycle rules:
 *
 *   - profiles are deactivated, never deleted: instances reference the class
 *     they were bought with
 *   - a profile that is referenced by an *active* variant cannot be deactivated,
 *     and its resource values cannot be changed; retire the plans first
 */
import { systemClock, type Clock } from '../clock.js';
import {
  duplicateResourceProfileNameError,
  resourceProfileInUseError,
  resourceProfileNotFoundError,
} from '../errors.js';
import type { CommerceStore } from '../ports.js';
import { has } from '../validation.js';
import { toAdminResourceProfile, type AdminResourceProfile } from './serialization.js';
import type { ResourceProfileRecord } from './types.js';
import {
  assertResourceProfileValues,
  parseCreateResourceProfileInput,
  parseUpdateResourceProfileInput,
  type ResourceProfileValues,
  type UpdateResourceProfileInput,
} from './validation.js';

/**
 * Values the runtime applies. Changing one of them changes what a customer
 * receives, so they are frozen while an active plan references the profile;
 * `name` and `description` are labels and stay editable.
 */
const RESOURCE_VALUE_KEYS = [
  'cpuLimitMillicores',
  'memoryLimitBytes',
  'memorySwapPolicy',
  'memorySwapBytes',
  'diskLimitBytes',
  'diskPolicy',
  'pidsLimit',
  'networkPolicy',
] as const satisfies readonly (keyof ResourceProfileValues)[];

export interface ResourceProfileServiceOptions {
  store: CommerceStore;
  clock?: Clock;
}

export interface ListResourceProfilesFilter {
  /** Admin listings may include deactivated profiles; the default hides them. */
  includeInactive?: boolean;
}

export class ResourceProfileService {
  private readonly store: CommerceStore;

  readonly clock: Clock;

  constructor(options: ResourceProfileServiceOptions) {
    this.store = options.store;
    this.clock = options.clock ?? systemClock;
  }

  async list(filter: ListResourceProfilesFilter = {}): Promise<AdminResourceProfile[]> {
    const records = await this.store.resourceProfiles.list({
      includeInactive: filter.includeInactive ?? false,
    });

    return records.map(toAdminResourceProfile);
  }

  async getById(id: string): Promise<AdminResourceProfile> {
    return toAdminResourceProfile(await this.requireProfile(id));
  }

  async create(input: unknown): Promise<AdminResourceProfile> {
    const parsed = parseCreateResourceProfileInput(input);
    const existing = await this.store.resourceProfiles.findByName(parsed.name);

    if (existing !== null) {
      throw duplicateResourceProfileNameError();
    }

    const record = await this.store.resourceProfiles.create({
      name: parsed.name,
      cpuLimitMillicores: parsed.cpuLimitMillicores,
      memoryLimitBytes: parsed.memoryLimitBytes,
      memorySwapPolicy: parsed.memorySwapPolicy,
      memorySwapBytes: parsed.memorySwapBytes,
      diskLimitBytes: parsed.diskLimitBytes,
      diskPolicy: parsed.diskPolicy,
      pidsLimit: parsed.pidsLimit,
      networkPolicy: parsed.networkPolicy,
      description: parsed.description,
      active: parsed.active,
    });

    return toAdminResourceProfile(record);
  }

  async update(id: string, input: unknown): Promise<AdminResourceProfile> {
    const current = await this.requireProfile(id);
    const patch = parseUpdateResourceProfileInput(input);

    if (patch.name !== undefined && patch.name !== current.name) {
      const existing = await this.store.resourceProfiles.findByName(patch.name);

      if (existing !== null) {
        throw duplicateResourceProfileNameError();
      }
    }

    // The consistency rules are checked on the merged result, not on the patch:
    // changing only the swap policy can invalidate the stored swap limit.
    assertResourceProfileValues({
      name: patch.name ?? current.name,
      cpuLimitMillicores: patch.cpuLimitMillicores ?? current.cpuLimitMillicores,
      memoryLimitBytes: patch.memoryLimitBytes ?? current.memoryLimitBytes,
      memorySwapPolicy: patch.memorySwapPolicy ?? current.memorySwapPolicy,
      memorySwapBytes:
        patch.memorySwapBytes === undefined ? current.memorySwapBytes : patch.memorySwapBytes,
      diskLimitBytes: patch.diskLimitBytes ?? current.diskLimitBytes,
      diskPolicy: patch.diskPolicy ?? current.diskPolicy,
      pidsLimit: patch.pidsLimit ?? current.pidsLimit,
      networkPolicy: patch.networkPolicy === undefined ? current.networkPolicy : patch.networkPolicy,
      description: patch.description === undefined ? current.description : patch.description,
    });

    if (patch.active === false || resourceValuesChanged(current, patch)) {
      await this.assertNotUsedByActiveVariant(id);
    }

    const updated = await this.store.resourceProfiles.update(id, patch);

    if (updated === null) {
      throw resourceProfileNotFoundError();
    }

    return toAdminResourceProfile(updated);
  }

  /** Activates or deactivates a profile. Deactivation is guarded, activation is not. */
  async setActive(id: string, active: boolean): Promise<AdminResourceProfile> {
    const current = await this.requireProfile(id);

    if (current.active === active) {
      return toAdminResourceProfile(current);
    }

    if (!active) {
      await this.assertNotUsedByActiveVariant(id);
    }

    const updated = await this.store.resourceProfiles.update(id, { active });

    if (updated === null) {
      throw resourceProfileNotFoundError();
    }

    return toAdminResourceProfile(updated);
  }

  private async requireProfile(id: string): Promise<ResourceProfileRecord> {
    const record = await this.store.resourceProfiles.findById(id);

    if (record === null) {
      throw resourceProfileNotFoundError();
    }

    return record;
  }

  /** Refuses when an active product variant still sells this resource class. */
  private async assertNotUsedByActiveVariant(id: string): Promise<void> {
    const inUse = await this.store.variants.list({
      resourceProfileId: id,
      statuses: ['ACTIVE'],
      limit: 1,
    });

    if (inUse.length > 0) {
      throw resourceProfileInUseError();
    }
  }
}

function resourceValuesChanged(
  current: ResourceProfileRecord,
  patch: UpdateResourceProfileInput,
): boolean {
  for (const key of RESOURCE_VALUE_KEYS) {
    if (has(patch, key) && patch[key] !== current[key]) {
      return true;
    }
  }

  return false;
}
