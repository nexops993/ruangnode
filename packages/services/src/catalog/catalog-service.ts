/**
 * Catalog service — the customer-safe read model.
 *
 * This is the only place that builds a public catalog entry. It combines a
 * product, its variants and their resource classes into a representation that
 *
 *   - hides anything that is not publicly available: products that are not
 *     `ACTIVE`, variants that are not `ACTIVE`, and variants whose resource
 *     class has been deactivated (a retired class must not be sold,
 *     docs/RESOURCE_ISOLATION.md)
 *   - never exposes a secret, a credential, a password hash or an admin-only
 *     field (there is no such field in the projections it returns)
 *   - renders money and byte quantities as decimal strings, so no `BigInt`
 *     reaches `JSON.stringify`
 *
 * It has no HTTP framework, no Next.js and no Prisma dependency: a store front,
 * an admin panel or a CLI can all use it (`.clinerules` → business logic belongs
 * in reusable services).
 */
import { productNotFoundError } from '../errors.js';
import type { CommerceStore } from '../ports.js';
import { toPublicResourceProfile } from '../resources/serialization.js';
import { loadResourceProfiles } from './profile-lookup.js';
import { toPublicProduct, toPublicVariant } from './serialization.js';
import type { ProductRecord, ProductType, PublicProduct, PublicVariant } from './types.js';

export const DEFAULT_CATALOG_LIMIT = 50;
export const MAX_CATALOG_LIMIT = 100;

export interface ListCatalogFilter {
  type?: ProductType;
  serviceType?: string;
  limit?: number;
  offset?: number;
}

export interface CatalogServiceOptions {
  store: CommerceStore;
}

export class CatalogService {
  private readonly store: CommerceStore;

  constructor(options: CatalogServiceOptions) {
    this.store = options.store;
  }

  /** Public catalog: only publicly available products, with purchasable variants. */
  async listProducts(filter: ListCatalogFilter = {}): Promise<PublicProduct[]> {
    const products = await this.store.products.list({
      statuses: ['ACTIVE'],
      ...(filter.type === undefined ? {} : { type: filter.type }),
      ...(filter.serviceType === undefined ? {} : { serviceType: filter.serviceType }),
      limit: clampLimit(filter.limit),
      offset: Math.max(filter.offset ?? 0, 0),
    });

    return this.buildPublicProducts(products);
  }

  /**
   * Public product detail.
   *
   * A draft, an archived or an unknown slug is reported identically, so the
   * endpoint cannot be used to discover unpublished products.
   */
  async getProductBySlug(slug: string): Promise<PublicProduct> {
    const product = await this.store.products.findBySlug(slug);

    if (product === null || product.status !== 'ACTIVE') {
      throw productNotFoundError();
    }

    const [view] = await this.buildPublicProducts([product]);

    if (view === undefined) {
      throw productNotFoundError();
    }

    return view;
  }

  /** Public variant list of one publicly available product. */
  async listVariantsForProduct(productId: string): Promise<PublicVariant[]> {
    const product = await this.store.products.findById(productId);

    if (product === null || product.status !== 'ACTIVE') {
      throw productNotFoundError();
    }

    const [view] = await this.buildPublicProducts([product]);

    return view === undefined ? [] : view.variants;
  }

  /**
   * Loads variants and resource classes for the given products in two queries and
   * projects each product into its public shape.
   */
  private async buildPublicProducts(products: readonly ProductRecord[]): Promise<PublicProduct[]> {
    if (products.length === 0) {
      return [];
    }

    const productIds = products.map((product) => product.id);
    const variants = await this.store.variants.list({ productIds, statuses: ['ACTIVE'] });
    const profiles = await loadResourceProfiles(
      this.store,
      variants.map((variant) => variant.resourceProfileId),
    );
    const variantsByProduct = new Map<string, PublicVariant[]>();

    for (const variant of variants) {
      // A variant whose resource class is missing or deactivated is not sellable.
      if (variant.resourceProfileId !== null) {
        const profile = profiles.get(variant.resourceProfileId);

        if (profile === undefined || !profile.active) {
          continue;
        }
      }

      const list = variantsByProduct.get(variant.productId) ?? [];
      const profile =
        variant.resourceProfileId === null ? null : profiles.get(variant.resourceProfileId);

      list.push(
        toPublicVariant(
          variant,
          profile === undefined || profile === null ? null : toPublicResourceProfile(profile),
        ),
      );
      variantsByProduct.set(variant.productId, list);
    }

    return products.map((product) =>
      toPublicProduct(product, variantsByProduct.get(product.id) ?? []),
    );
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_CATALOG_LIMIT;
  }

  return Math.min(Math.max(limit, 1), MAX_CATALOG_LIMIT);
}
