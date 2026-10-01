/**
 * Shared lookup of the resource classes a set of variants references.
 *
 * Administrators need the deactivated ones too (a plan may point at a class that
 * was retired later), so the lookup always includes inactive rows and the
 * caller decides what is sellable.
 */
import type { CommerceStore } from '../ports.js';
import type { ResourceProfileRecord } from '../resources/types.js';

export async function loadResourceProfiles(
  store: CommerceStore,
  resourceProfileIds: readonly (string | null)[],
): Promise<Map<string, ResourceProfileRecord>> {
  const ids = [...new Set(resourceProfileIds.filter((id): id is string => id !== null))];

  if (ids.length === 0) {
    return new Map();
  }

  const records = await store.resourceProfiles.list({ ids, includeInactive: true });

  return new Map(records.map((record) => [record.id, record]));
}
