/**
 * Product variant service.
 *
 * A variant is the purchasable plan of a product. Beyond field rules, this
 * service owns the relationships that make a plan valid:
 *
 *   - the SKU is unique across the catalog (the unique index is the real guard;
 *     the pre-check is the fast path and the friendly error)
 *   - the price is a positive integer number of minor units, never a float
 *   - the billing period agrees with the product type
 *   - a managed service names a *live* resource class, a digital product does not
 *   - a variant may only be published while its resource class is active
 */
import { systemClock, type Clock } from '../clock.js';
import {
  duplicateVariantSkuError,
  productNotFoundError,
  resourceProfileInactiveError,
  resourceProfileNotFoundError,
  variantNotFoundError,
} from '../errors.js';
import type { CommerceStore } from '../ports.js';
import { toAdminResourceProfile } from '../resources/serialization.js';
import { loadResourceProfiles } from './profile-lookup.js';
import { toAdminVariant } from './serialization.js';
import { assertProductStatusTransition } from './status.js';
import type { AdminVariant, ProductRecord, ProductVariantRecord } from './types.js';
import {
  assertBillingPeriodMatchesProductType,
  assertResourceProfileMatchesProductType,
  parseCreateVariantInput,
  parseProductStatusInput,
  parseUpdateVariantInput,
} from './validation.js';

export interface VariantServiceOptions {
  store: CommerceStore;
  clock?: Clock;
}

export class VariantService {
  private readonly store: CommerceStore;

  readonly clock: Clock;

  constructor(options: VariantServiceOptions) {
    this.store = options.store;
    this.clock = options.clock ?? systemClock;
  }

  /** Admin listing of every plan of a product, including drafts and archived. */
  async listForAdmin(productId: string): Promise<AdminVariant[]> {
    await this.requireProduct(productId);

    const variants = await this.store.variants.list({ productId });

    return this.view(variants);
  }

  async getById(variantId: string): Promise<AdminVariant> {
    return this.viewOne(await this.requireVariant(variantId));
  }

  async create(productId: string, input: unknown): Promise<AdminVariant> {
    const product = await this.requireProduct(productId);
    const parsed = parseCreateVariantInput(input);

    assertBillingPeriodMatchesProductType(product.type, parsed.billingPeriod);
    assertResourceProfileMatchesProductType(product.type, parsed.resourceProfileId);

    if (parsed.resourceProfileId !== null) {
      await this.requireActiveResourceProfile(parsed.resourceProfileId);
    }

    const existingSku = await this.store.variants.findBySku(parsed.sku);

    if (existingSku !== null) {
      throw duplicateVariantSkuError();
    }

    // New plans always start as DRAFT and are published explicitly.
    const record = await this.store.variants.create({
      productId,
      name: parsed.name,
      sku: parsed.sku,
      priceMinor: parsed.priceMinor,
      currency: parsed.currency,
      billingPeriod: parsed.billingPeriod,
      resourceProfileId: parsed.resourceProfileId,
      storageQuotaBytes: parsed.storageQuotaBytes,
      configurationSchema: parsed.configurationSchema,
      status: 'DRAFT',
    });

    return this.viewOne(record);
  }

  async update(variantId: string, input: unknown): Promise<AdminVariant> {
    const current = await this.requireVariant(variantId);
    const product = await this.requireProduct(current.productId);
    const patch = parseUpdateVariantInput(input);

    const nextBillingPeriod = patch.billingPeriod ?? current.billingPeriod;
    const nextResourceProfileId =
      patch.resourceProfileId === undefined ? current.resourceProfileId : patch.resourceProfileId;

    assertBillingPeriodMatchesProductType(product.type, nextBillingPeriod);
    assertResourceProfileMatchesProductType(product.type, nextResourceProfileId);

    if (nextResourceProfileId !== null) {
      await this.requireActiveResourceProfile(nextResourceProfileId);
    }

    if (patch.sku !== undefined && patch.sku !== current.sku) {
      const existingSku = await this.store.variants.findBySku(patch.sku);

      if (existingSku !== null) {
        throw duplicateVariantSkuError();
      }
    }

    const updated = await this.store.variants.update(variantId, patch);

    if (updated === null) {
      throw variantNotFoundError();
    }

    return this.viewOne(updated);
  }

  /** Guarded lifecycle transition (`DRAFT ⇄ ACTIVE`, `* → ARCHIVED`, `ARCHIVED → DRAFT`). */
  async changeStatus(variantId: string, input: unknown): Promise<AdminVariant> {
    const current = await this.requireVariant(variantId);
    const target = parseProductStatusInput(input);

    assertProductStatusTransition(current.status, target);

    // Publishing a plan means selling its resource class, so the class must be
    // live at that moment (docs/RESOURCE_ISOLATION.md).
    if (target === 'ACTIVE' && current.resourceProfileId !== null) {
      await this.requireActiveResourceProfile(current.resourceProfileId);
    }

    const updated = await this.store.variants.update(variantId, { status: target });

    if (updated === null) {
      throw variantNotFoundError();
    }

    return this.viewOne(updated);
  }

  /** Takes a plan off sale. `DELETE` on the admin API maps onto this. */
  async deactivate(variantId: string): Promise<AdminVariant> {
    return this.changeStatus(variantId, { status: 'DRAFT' });
  }

  private async requireProduct(productId: string): Promise<ProductRecord> {
    const product = await this.store.products.findById(productId);

    if (product === null) {
      throw productNotFoundError();
    }

    return product;
  }

  private async requireVariant(variantId: string): Promise<ProductVariantRecord> {
    const variant = await this.store.variants.findById(variantId);

    if (variant === null) {
      throw variantNotFoundError();
    }

    return variant;
  }

  private async requireActiveResourceProfile(resourceProfileId: string): Promise<void> {
    const profile = await this.store.resourceProfiles.findById(resourceProfileId);

    if (profile === null) {
      throw resourceProfileNotFoundError();
    }

    if (!profile.active) {
      throw resourceProfileInactiveError();
    }
  }

  private async viewOne(record: ProductVariantRecord): Promise<AdminVariant> {
    const [view] = await this.view([record]);

    if (view === undefined) {
      throw variantNotFoundError();
    }

    return view;
  }

  private async view(records: readonly ProductVariantRecord[]): Promise<AdminVariant[]> {
    const profiles = await loadResourceProfiles(
      this.store,
      records.map((record) => record.resourceProfileId),
    );

    return records.map((record) => {
      const profile =
        record.resourceProfileId === null ? null : profiles.get(record.resourceProfileId);

      return toAdminVariant(
        record,
        profile === undefined || profile === null ? null : toAdminResourceProfile(profile),
      );
    });
  }
}
