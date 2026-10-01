/**
 * Product service — administrator operations.
 *
 * Authorization is not decided here: the API guards require `ADMIN` before a
 * handler calls these methods (`apps/api/src/auth/guards.ts`), and the same
 * methods stay reusable from admin tooling. What this service owns are the
 * *rules*: slug uniqueness, the immutability of a type that already has plans,
 * and the guarded lifecycle that publishes and retires a product.
 *
 * A product is never deleted: retiring it sets `ARCHIVED`, because order items
 * reference the variant that was bought.
 */
import { systemClock, type Clock } from '../clock.js';
import {
  duplicateProductSlugError,
  productHasNoPurchasableVariantError,
  productNotFoundError,
  productTypeLockedError,
} from '../errors.js';
import type { CommerceStore } from '../ports.js';
import { toAdminResourceProfile } from '../resources/serialization.js';
import { toAdminProduct, toAdminVariant } from './serialization.js';
import { assertProductStatusTransition } from './status.js';
import { loadResourceProfiles } from './profile-lookup.js';
import type { AdminProduct, ProductRecord, ProductType } from './types.js';
import {
  parseCreateProductInput,
  parseProductStatusInput,
  parseUpdateProductInput,
} from './validation.js';

export interface ProductServiceOptions {
  store: CommerceStore;
  clock?: Clock;
}

export interface ListProductsFilter {
  /** Administrators may include `ARCHIVED` products; the default hides them. */
  includeArchived?: boolean;
  type?: ProductType;
  serviceType?: string;
  limit?: number;
  offset?: number;
}

export class ProductService {
  private readonly store: CommerceStore;

  readonly clock: Clock;

  constructor(options: ProductServiceOptions) {
    this.store = options.store;
    this.clock = options.clock ?? systemClock;
  }

  /** Admin listing: drafts and active products, optionally including archived. */
  async list(filter: ListProductsFilter = {}): Promise<AdminProduct[]> {
    const products = await this.store.products.list({
      ...(filter.includeArchived === true ? {} : { statuses: ['DRAFT', 'ACTIVE'] as const }),
      ...(filter.type === undefined ? {} : { type: filter.type }),
      ...(filter.serviceType === undefined ? {} : { serviceType: filter.serviceType }),
      ...(filter.limit === undefined ? {} : { limit: filter.limit }),
      ...(filter.offset === undefined ? {} : { offset: filter.offset }),
    });

    return Promise.all(products.map((product) => this.view(product)));
  }

  async getById(id: string): Promise<AdminProduct> {
    return this.view(await this.requireProduct(id));
  }

  /**
   * Creates a product.
   *
   * The status is never taken from the request: a new product is always `DRAFT`
   * and is published through the guarded status transition.
   */
  async create(input: unknown): Promise<AdminProduct> {
    const parsed = parseCreateProductInput(input);
    const existing = await this.store.products.findBySlug(parsed.slug);

    if (existing !== null) {
      throw duplicateProductSlugError();
    }

    const record = await this.store.products.create({
      slug: parsed.slug,
      name: parsed.name,
      description: parsed.description,
      type: parsed.type,
      serviceType: parsed.serviceType,
      status: 'DRAFT',
    });

    return this.view(record);
  }

  async update(id: string, input: unknown): Promise<AdminProduct> {
    const current = await this.requireProduct(id);
    const patch = parseUpdateProductInput(input);

    if (patch.slug !== undefined && patch.slug !== current.slug) {
      const existing = await this.store.products.findBySlug(patch.slug);

      if (existing !== null) {
        throw duplicateProductSlugError();
      }
    }

    // A product that already has plans cannot change type: the plans' billing
    // periods and resource classes were derived from the current type.
    if (patch.type !== undefined && patch.type !== current.type) {
      const variants = await this.store.variants.list({ productId: id, limit: 1 });

      if (variants.length > 0) {
        throw productTypeLockedError();
      }
    }

    const updated = await this.store.products.update(id, patch);

    if (updated === null) {
      throw productNotFoundError();
    }

    return this.view(updated);
  }

  /** Guarded lifecycle transition (`DRAFT ⇄ ACTIVE`, `* → ARCHIVED`, `ARCHIVED → DRAFT`). */
  async changeStatus(id: string, input: unknown): Promise<AdminProduct> {
    const current = await this.requireProduct(id);
    const target = parseProductStatusInput(input);

    assertProductStatusTransition(current.status, target);

    if (target === 'ACTIVE') {
      await this.assertHasPurchasableVariant(current.id);
    }

    const updated = await this.store.products.update(id, { status: target });

    if (updated === null) {
      throw productNotFoundError();
    }

    return this.view(updated);
  }

  /** Retires a product. `DELETE` on the admin API maps onto this. */
  async archive(id: string): Promise<AdminProduct> {
    return this.changeStatus(id, { status: 'ARCHIVED' });
  }

  private async requireProduct(id: string): Promise<ProductRecord> {
    const record = await this.store.products.findById(id);

    if (record === null) {
      throw productNotFoundError();
    }

    return record;
  }

  /** Full admin projection of a product: every variant, every status. */
  private async view(product: ProductRecord): Promise<AdminProduct> {
    const variants = await this.store.variants.list({ productId: product.id });
    const profiles = await loadResourceProfiles(
      this.store,
      variants.map((variant) => variant.resourceProfileId),
    );

    return toAdminProduct(
      product,
      variants.map((variant) => {
        const profile =
          variant.resourceProfileId === null ? null : profiles.get(variant.resourceProfileId);

        return toAdminVariant(
          variant,
          profile === undefined || profile === null ? null : toAdminResourceProfile(profile),
        );
      }),
    );
  }

  /** A published product must offer at least one active plan in a live class. */
  private async assertHasPurchasableVariant(productId: string): Promise<void> {
    const active = await this.store.variants.list({ productId, statuses: ['ACTIVE'] });

    if (active.length === 0) {
      throw productHasNoPurchasableVariantError();
    }

    const profiles = await loadResourceProfiles(
      this.store,
      active.map((variant) => variant.resourceProfileId),
    );
    const purchasable = active.some((variant) => {
      if (variant.resourceProfileId === null) {
        return true;
      }

      return profiles.get(variant.resourceProfileId)?.active === true;
    });

    if (!purchasable) {
      throw productHasNoPurchasableVariantError();
    }
  }
}
