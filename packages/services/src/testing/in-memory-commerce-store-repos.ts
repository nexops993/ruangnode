import {
  duplicateProductSlugError,
  duplicateResourceProfileNameError,
  duplicateVariantSkuError,
} from '../errors.js';
import type { ProductRecord, ProductVariantRecord } from '../catalog/types.js';
import type { ResourceProfileRecord } from '../resources/types.js';
import type {
  ProductListFilter,
  ProductRepository,
  ProductVariantRepository,
  ProductWriteData,
  ResourceProfileListFilter,
  ResourceProfileRepository,
  ResourceProfileWriteData,
  VariantListFilter,
  VariantWriteData,
} from '../ports.js';
import {
  applyProductFilter,
  applyVariantFilter,
  cloneRecord,
  type CommerceState,
} from './in-memory-commerce-store.js';

export function buildProducts(state: CommerceState): ProductRepository {
  return {
    async list(filter?: ProductListFilter): Promise<ProductRecord[]> {
      return applyProductFilter([...state.products.values()], filter);
    },

    async findById(id: string): Promise<ProductRecord | null> {
      const row = state.products.get(id);

      return row === undefined ? null : cloneRecord(row);
    },

    async findBySlug(slug: string): Promise<ProductRecord | null> {
      for (const row of state.products.values()) {
        if (row.slug === slug) {
          return cloneRecord(row);
        }
      }

      return null;
    },

    async create(data: ProductWriteData): Promise<ProductRecord> {
      for (const row of state.products.values()) {
        if (row.slug === data.slug) {
          throw duplicateProductSlugError();
        }
      }

      const timestamp = new Date();
      const record: ProductRecord = {
        id: crypto.randomUUID(),
        slug: data.slug,
        name: data.name,
        description: data.description,
        type: data.type,
        status: data.status,
        serviceType: data.serviceType,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      state.products.set(record.id, record);

      return cloneRecord(record);
    },

    async update(id: string, data: Partial<ProductWriteData>): Promise<ProductRecord | null> {
      const row = state.products.get(id);

      if (row === undefined) {
        return null;
      }

      if (data.slug !== undefined && data.slug !== row.slug) {
        for (const other of state.products.values()) {
          if (other.id !== id && other.slug === data.slug) {
            throw duplicateProductSlugError();
          }
        }
      }

      const updated: ProductRecord = { ...row, ...data, updatedAt: new Date() };
      state.products.set(id, updated);

      return cloneRecord(updated);
    },
  };
}

export function buildVariants(state: CommerceState): ProductVariantRepository {
  return {
    async list(filter?: VariantListFilter): Promise<ProductVariantRecord[]> {
      return applyVariantFilter([...state.variants.values()], filter);
    },

    async findById(id: string): Promise<ProductVariantRecord | null> {
      const row = state.variants.get(id);

      return row === undefined ? null : cloneRecord(row);
    },

    async findBySku(sku: string): Promise<ProductVariantRecord | null> {
      for (const row of state.variants.values()) {
        if (row.sku === sku) {
          return cloneRecord(row);
        }
      }

      return null;
    },

    async create(data: VariantWriteData): Promise<ProductVariantRecord> {
      for (const row of state.variants.values()) {
        if (row.sku === data.sku) {
          throw duplicateVariantSkuError();
        }
      }

      const timestamp = new Date();
      const record: ProductVariantRecord = {
        id: crypto.randomUUID(),
        ...data,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      state.variants.set(record.id, record);

      return cloneRecord(record);
    },

    async update(
      id: string,
      data: Partial<VariantWriteData>,
    ): Promise<ProductVariantRecord | null> {
      const row = state.variants.get(id);

      if (row === undefined) {
        return null;
      }

      if (data.sku !== undefined && data.sku !== row.sku) {
        for (const other of state.variants.values()) {
          if (other.id !== id && other.sku === data.sku) {
            throw duplicateVariantSkuError();
          }
        }
      }

      const updated: ProductVariantRecord = { ...row, ...data, updatedAt: new Date() };
      state.variants.set(id, updated);

      return cloneRecord(updated);
    },
  };
}

export function buildProfiles(state: CommerceState): ResourceProfileRepository {
  return {
    async list(filter?: ResourceProfileListFilter): Promise<ResourceProfileRecord[]> {
      let rows = [...state.profiles.values()];

      if (filter?.includeInactive !== true) {
        rows = rows.filter((row) => row.active);
      }

      if (filter?.ids !== undefined) {
        const ids = new Set(filter.ids);
        rows = rows.filter((row) => ids.has(row.id));
      }

      return rows.sort((a, b) => a.name.localeCompare(b.name)).map(cloneRecord);
    },

    async findById(id: string): Promise<ResourceProfileRecord | null> {
      const row = state.profiles.get(id);

      return row === undefined ? null : cloneRecord(row);
    },

    async findByName(name: string): Promise<ResourceProfileRecord | null> {
      for (const row of state.profiles.values()) {
        if (row.name === name) {
          return cloneRecord(row);
        }
      }

      return null;
    },

    async create(data: ResourceProfileWriteData): Promise<ResourceProfileRecord> {
      for (const row of state.profiles.values()) {
        if (row.name === data.name) {
          throw duplicateResourceProfileNameError();
        }
      }

      const timestamp = new Date();
      const record: ResourceProfileRecord = {
        id: crypto.randomUUID(),
        ...data,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      state.profiles.set(record.id, record);

      return cloneRecord(record);
    },

    async update(
      id: string,
      data: Partial<ResourceProfileWriteData>,
    ): Promise<ResourceProfileRecord | null> {
      const row = state.profiles.get(id);

      if (row === undefined) {
        return null;
      }

      if (data.name !== undefined && data.name !== row.name) {
        for (const other of state.profiles.values()) {
          if (other.id !== id && other.name === data.name) {
            throw duplicateResourceProfileNameError();
          }
        }
      }

      const updated: ResourceProfileRecord = { ...row, ...data, updatedAt: new Date() };
      state.profiles.set(id, updated);

      return cloneRecord(updated);
    },
  };
}
