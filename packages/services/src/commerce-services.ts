/**
 * Composition root of the commerce domain.
 *
 * The API layer (and any future admin tooling) receives *services*, never a
 * database client: it cannot reach around a service to the tables
 * (`.clinerules` → dependency injection for infrastructure adapters).
 *
 * The store is injected, so the same services run against the Prisma-backed
 * store in production and against the same adapter over a real PostgreSQL
 * started for a test.
 */
import { CatalogService } from './catalog/catalog-service.js';
import { ProductService } from './catalog/product-service.js';
import { VariantService } from './catalog/variant-service.js';
import { systemClock, type Clock } from './clock.js';
import { OrderService } from './orders/order-service.js';
import type { CommerceStore } from './ports.js';
import { ResourceProfileService } from './resources/resource-profile-service.js';
import { deterministicPaymentAdapter, PaymentService } from './payments/payment-service.js';
import type { PaymentProviderAdapter } from './payments/types.js';

export interface CommerceServices {
  /** Customer-safe read model (products + variants + resource classes). */
  catalog: CatalogService;
  /** Admin product operations. Authorization happens at the API boundary. */
  products: ProductService;
  /** Admin product-variant operations. */
  variants: VariantService;
  /** Admin resource-profile operations (configuration data only). */
  resourceProfiles: ResourceProfileService;
  /** Customer orders: creation, listing, reading and guarded cancellation. */
  orders: OrderService;
  payments: PaymentService;
}

export interface CreateCommerceServicesOptions {
  store: CommerceStore;
  clock?: Clock;
  /** Payment deadline applied to a new order. Defaults to 24 hours. */
  paymentWindowMs?: number;
  paymentProviders?: readonly PaymentProviderAdapter[];
}

export function createCommerceServices(
  options: CreateCommerceServicesOptions,
): CommerceServices {
  const clock = options.clock ?? systemClock;
  const { store } = options;

  return {
    catalog: new CatalogService({ store }),
    products: new ProductService({ store, clock }),
    variants: new VariantService({ store, clock }),
    resourceProfiles: new ResourceProfileService({ store, clock }),
    orders: new OrderService({
      store,
      clock,
      ...(options.paymentWindowMs === undefined
        ? {}
        : { paymentWindowMs: options.paymentWindowMs }),
    }),
    payments: new PaymentService({
      store,
      clock,
      providers: new Map(
        (options.paymentProviders ?? [deterministicPaymentAdapter()]).map((provider) => [
          provider.provider,
          provider,
        ]),
      ),
    }),
  };
}
