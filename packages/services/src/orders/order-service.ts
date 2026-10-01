/**
 * Order service — the first real commerce write path.
 *
 * What an order creation does, in one transaction:
 *
 *   1. the owner is the *authenticated* user (passed in, never read from a body)
 *   2. the product exists and is publicly purchasable (`ACTIVE`)
 *   3. the variant exists, is `ACTIVE`, and really belongs to that product
 *   4. the resource class of the variant exists and is live
 *   5. the price is read from the database row and multiplied server-side
 *   6. the product/variant/class data is snapshotted into `metadataSnapshot`
 *   7. totals are computed server-side in integer minor units
 *   8. the order and its line are written together; the status is `PENDING`
 *
 * It does **not** mark anything paid and does **not** provision anything: those
 * are the payment and provisioning phases (`.clinerules` → Payments /
 * Provisioning).
 */
import { DAY_MS, systemClock, type Clock } from '../clock.js';
import type { ProductRecord, ProductVariantRecord } from '../catalog/types.js';
import {
  orderNotFoundError,
  orderStateChangedError,
  productNotFoundError,
  productNotPurchasableError,
  resourceProfileInactiveError,
  resourceProfileNotFoundError,
  variantNotFoundError,
  variantNotPurchasableError,
  variantProductMismatchError,
} from '../errors.js';
import { lineTotalMinor } from '../money.js';
import type { CommerceStore } from '../ports.js';
import { toPublicResourceProfile } from '../resources/serialization.js';
import type { ResourceProfileRecord } from '../resources/types.js';
import { calculateOrderTotals } from './pricing.js';
import { toOrderView } from './serialization.js';
import {
  assertOrderTransitionAllowed,
  assertPaymentPhaseAllows,
  INITIAL_ORDER_STATUS,
  type OrderTransitionRequest,
} from './state.js';
import {
  ORDER_ITEM_SNAPSHOT_VERSION,
  type OrderItemMetadataSnapshot,
  type OrderStatus,
  type OrderView,
  type SnapshotResourceProfile,
} from './types.js';
import { parsePagination, parsePlaceOrderCommand } from './validation.js';

/** How long an unpaid order stays valid before it may expire (payment phase). */
export const DEFAULT_PAYMENT_WINDOW_MS = DAY_MS;

export const DEFAULT_ORDER_LIST_LIMIT = 50;
export const MAX_ORDER_LIST_LIMIT = 100;

export interface OrderServiceOptions {
  store: CommerceStore;
  clock?: Clock;
  /** Overrides the payment window used for `Order.expiresAt`. */
  paymentWindowMs?: number;
}

export interface ListOrdersOptions {
  limit?: number;
  offset?: number;
}

export class OrderService {
  private readonly store: CommerceStore;

  private readonly paymentWindowMs: number;

  readonly clock: Clock;

  constructor(options: OrderServiceOptions) {
    this.store = options.store;
    this.clock = options.clock ?? systemClock;
    this.paymentWindowMs = options.paymentWindowMs ?? DEFAULT_PAYMENT_WINDOW_MS;
  }

  /**
   * Creates an order for the authenticated user.
   *
   * `userId` is a separate argument on purpose: a body field can never become the
   * owner of an order (`.clinerules` → Multi-tenant security).
   */
  async placeOrder(userId: string, input: unknown): Promise<OrderView> {
    const command = parsePlaceOrderCommand(input);
    const capturedAt = this.clock.now();

    return this.store.transaction(async (store) => {
      const product = await store.products.findById(command.productId);

      if (product === null) {
        throw productNotFoundError();
      }

      if (product.status !== 'ACTIVE') {
        throw productNotPurchasableError();
      }

      const variant = await store.variants.findById(command.variantId);

      if (variant === null) {
        throw variantNotFoundError();
      }

      if (variant.productId !== product.id) {
        throw variantProductMismatchError();
      }

      if (variant.status !== 'ACTIVE') {
        throw variantNotPurchasableError();
      }

      const resourceProfile = await requireLiveResourceProfile(store, variant);

      // The price comes from the stored variant — never from the request.
      const totals = calculateOrderTotals([
        {
          unitPriceMinor: variant.priceMinor,
          quantity: command.quantity,
          currency: variant.currency,
        },
      ]);

      const order = await store.orders.create({
        userId,
        status: INITIAL_ORDER_STATUS,
        currency: totals.currency,
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        totalMinor: totals.totalMinor,
        expiresAt: new Date(capturedAt.getTime() + this.paymentWindowMs),
        items: [
          {
            productVariantId: variant.id,
            quantity: command.quantity,
            unitPriceMinor: variant.priceMinor,
            totalPriceMinor: lineTotalMinor(variant.priceMinor, command.quantity),
            metadataSnapshot: buildMetadataSnapshot({
              product,
              variant,
              resourceProfile,
              capturedAt,
            }),
          },
        ],
      });

      return toOrderView(order);
    });
  }

  /** Orders of the authenticated user, newest first. */
  async listForUser(userId: string, options: ListOrdersOptions = {}): Promise<OrderView[]> {
    const { limit, offset } = parsePagination(options, {
      defaultLimit: DEFAULT_ORDER_LIST_LIMIT,
      maxLimit: MAX_ORDER_LIST_LIMIT,
    });

    const orders = await this.store.orders.listForUser(userId, { limit, offset });

    return orders.map(toOrderView);
  }

  /**
   * One order of the authenticated user.
   *
   * The lookup is scoped by owner in the query itself (and the route adds the
   * ownership guard), so another customer's order is reported as not found.
   */
  async getForUser(userId: string, orderId: string): Promise<OrderView> {
    const order = await this.store.orders.findByIdForUser(userId, orderId);

    if (order === null) {
      throw orderNotFoundError();
    }

    return toOrderView(order);
  }

  /**
   * Owner of an order, or `null` when it does not exist.
   *
   * Used by the API ownership guard: an endpoint can decide whether to answer a
   * request without loading another tenant's order.
   */
  async findOwnerUserId(orderId: string): Promise<string | null> {
    return this.store.orders.findOwnerUserId(orderId);
  }

  /** Cancels an unpaid order the customer owns. The only customer-driven transition. */
  async cancel(userId: string, orderId: string): Promise<OrderView> {
    return this.transition(orderId, 'CANCELLED', { source: 'CUSTOMER', ownerUserId: userId });
  }

  /**
   * Guarded status transition.
   *
   * The only reachable transition in this phase is `PENDING → CANCELLED`:
   * payment-driven targets are refused by `assertPaymentPhaseAllows` until a
   * verified payment exists. The write is a compare-and-swap, so two concurrent
   * transitions cannot both win.
   */
  async transition(
    orderId: string,
    to: OrderStatus,
    request: OrderTransitionRequest,
  ): Promise<OrderView> {
    assertPaymentPhaseAllows(to);

    return this.store.transaction(async (store) => {
      const order = await store.orders.findById(orderId);

      if (order === null) {
        throw orderNotFoundError();
      }

      if (request.source === 'CUSTOMER' && order.userId !== request.ownerUserId) {
        // Foreign and missing look the same from the outside.
        throw orderNotFoundError();
      }

      assertOrderTransitionAllowed(order.status, to);

      const changed = await store.orders.updateStatus(orderId, order.status, to);

      if (!changed) {
        throw orderStateChangedError();
      }

      const updated = await store.orders.findById(orderId);

      if (updated === null) {
        throw orderNotFoundError();
      }

      return toOrderView(updated);
    });
  }
}

/** Snapshot of everything a customer bought, as it was at purchase time. */
export function buildMetadataSnapshot(input: {
  product: ProductRecord;
  variant: ProductVariantRecord;
  resourceProfile: ResourceProfileRecord | null;
  capturedAt: Date;
}): OrderItemMetadataSnapshot {
  const { product, variant, resourceProfile, capturedAt } = input;

  return {
    snapshotVersion: ORDER_ITEM_SNAPSHOT_VERSION,
    capturedAt: capturedAt.toISOString(),
    product: {
      id: product.id,
      slug: product.slug,
      name: product.name,
      type: product.type,
      serviceType: product.serviceType,
    },
    variant: {
      id: variant.id,
      name: variant.name,
      sku: variant.sku,
      billingPeriod: variant.billingPeriod,
      currency: variant.currency,
      unitPriceMinor: variant.priceMinor.toString(),
    },
    // The snapshot keeps a copy of the resource class, so a later edit of the
    // profile cannot rewrite what the customer was promised.
    resourceProfile:
      resourceProfile === null ? null : toSnapshotResourceProfile(resourceProfile),
    storageQuotaBytes:
      variant.storageQuotaBytes === null ? null : variant.storageQuotaBytes.toString(),
  };
}

/** The snapshot keeps the enforceable values; the marketing text is dropped. */
function toSnapshotResourceProfile(profile: ResourceProfileRecord): SnapshotResourceProfile {
  const { description: _description, ...values } = toPublicResourceProfile(profile);

  return values;
}

/** A variant that references a resource class may only be bought while it is live. */
async function requireLiveResourceProfile(
  store: CommerceStore,
  variant: ProductVariantRecord,
): Promise<ResourceProfileRecord | null> {
  if (variant.resourceProfileId === null) {
    return null;
  }

  const profile = await store.resourceProfiles.findById(variant.resourceProfileId);

  if (profile === null) {
    throw resourceProfileNotFoundError();
  }

  if (!profile.active) {
    throw resourceProfileInactiveError();
  }

  return profile;
}
