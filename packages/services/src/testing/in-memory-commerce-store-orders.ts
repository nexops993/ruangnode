import type { OrderRecord, OrderStatus } from '../orders/types.js';
import type { CommerceStore, CreateOrderData, OrderRepository } from '../ports.js';
import type { ProductRecord, ProductVariantRecord } from '../catalog/types.js';
import type { ResourceProfileRecord } from '../resources/types.js';
import {
  cloneOrderRecord,
  cloneRecord,
  cloneState,
  emptyState,
  restoreState,
  type CommerceState,
} from './in-memory-commerce-store.js';
import {
  buildProducts,
  buildProfiles,
  buildVariants,
} from './in-memory-commerce-store-repos.js';

/** An in-memory commerce store with inspection helpers, for tests. */
export interface InMemoryCommerceStore extends CommerceStore {
  /** Seeded products (copies: mutating them never changes the store). */
  inspectProducts(): ProductRecord[];
  /** Seeded variants (copies). */
  inspectVariants(): ProductVariantRecord[];
  /** Seeded profiles (copies). */
  inspectProfiles(): ResourceProfileRecord[];
  /** Stored orders with their lines (copies). */
  inspectOrders(): OrderRecord[];
  /** Removes everything, so one store can back several isolated tests. */
  clear(): void;
}

export function createInMemoryCommerceStore(): InMemoryCommerceStore {
  const state: CommerceState = emptyState();

  const orders: OrderRepository = {
    async listForUser(
      userId: string,
      options?: { limit?: number; offset?: number },
    ): Promise<OrderRecord[]> {
      const rows = [...state.orders.values()]
        .filter((row) => row.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const offset = options?.offset ?? 0;
      const page =
        options?.limit === undefined ? rows.slice(offset) : rows.slice(offset, offset + options.limit);

      return page.map(cloneOrderRecord);
    },

    async findById(orderId: string): Promise<OrderRecord | null> {
      const row = state.orders.get(orderId);

      return row === undefined ? null : cloneOrderRecord(row);
    },

    async findByIdForUser(userId: string, orderId: string): Promise<OrderRecord | null> {
      const row = state.orders.get(orderId);

      return row !== undefined && row.userId === userId ? cloneOrderRecord(row) : null;
    },

    async findOwnerUserId(orderId: string): Promise<string | null> {
      const row = state.orders.get(orderId);

      return row === undefined ? null : row.userId;
    },

    async create(data: CreateOrderData): Promise<OrderRecord> {
      const timestamp = new Date();
      const orderId = crypto.randomUUID();
      const record: OrderRecord = {
        id: orderId,
        userId: data.userId,
        status: data.status,
        currency: data.currency,
        subtotalMinor: data.subtotalMinor,
        discountMinor: data.discountMinor,
        totalMinor: data.totalMinor,
        expiresAt: data.expiresAt === null ? null : new Date(data.expiresAt),
        createdAt: timestamp,
        updatedAt: timestamp,
        items: data.items.map((item) => ({
          id: crypto.randomUUID(),
          orderId,
          productVariantId: item.productVariantId,
          quantity: item.quantity,
          unitPriceMinor: item.unitPriceMinor,
          totalPriceMinor: item.totalPriceMinor,
          metadataSnapshot: structuredClone(item.metadataSnapshot),
        })),
      };

      state.orders.set(orderId, record);

      return cloneOrderRecord(record);
    },

    async updateStatus(orderId: string, from: OrderStatus, to: OrderStatus): Promise<boolean> {
      const row = state.orders.get(orderId);

      if (row === undefined || row.status !== from) {
        return false;
      }

      state.orders.set(orderId, { ...row, status: to, updatedAt: new Date() });

      return true;
    },
  };

  const store: InMemoryCommerceStore = {
    products: buildProducts(state),
    variants: buildVariants(state),
    resourceProfiles: buildProfiles(state),
    orders,

    async transaction<T>(work: (transactionStore: CommerceStore) => Promise<T>): Promise<T> {
      const snapshot = cloneState(state);

      try {
        return await work(store);
      } catch (error) {
        // `state` is shared by reference with every repository, so rollback
        // restores it in place instead of replacing the object.
        restoreState(state, snapshot);
        throw error;
      }
    },

    inspectProducts: () => [...state.products.values()].map(cloneRecord),
    inspectVariants: () => [...state.variants.values()].map(cloneRecord),
    inspectProfiles: () => [...state.profiles.values()].map(cloneRecord),
    inspectOrders: () => [...state.orders.values()].map(cloneOrderRecord),
    clear: () => {
      restoreState(state, emptyState());
    },
  };

  return store;
}
