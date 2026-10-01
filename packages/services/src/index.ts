/**
 * @ruangnode/services
 *
 * Boundary: business logic of the control plane — catalog, pricing, orders and
 * the lifecycle state machines. Payment adapters, subscriptions, provisioning,
 * scheduling and the runtime come later; nothing in this package pretends those
 * exist.
 *
 * Contents (Phase 2 — commerce core):
 *
 *   `clock.ts`, `money.ts`, `numbers.ts`, `validation.ts`
 *       platform primitives: a time port, integer minor units, and the
 *       boundary parsing every service validates its input with
 *   `errors.ts`
 *       the user-safe error taxonomy (`AppError`/`ErrorCode` based)
 *   `ports.ts`
 *       the storage interfaces; `adapters/prisma-commerce-store.ts` implements
 *       them over PostgreSQL, so no service knows about Prisma
 *   `catalog/`
 *       products, variants, the public catalog projection and the guarded
 *       `DRAFT ⇄ ACTIVE → ARCHIVED` lifecycle
 *   `resources/`
 *       resource profiles: the enforceable resource class as *configuration*
 *       (enforcement is the Node Agent's job, in the runtime phase)
 *   `orders/`
 *       order creation with server-side pricing and snapshots, the order of the
 *       customer's own orders, and the guarded order state machine
 *   `commerce-services.ts`
 *       the composition root used by the API layer
 *
 * Rules this package implements:
 *   - money is integer minor units in `BigInt` and leaves as decimal strings;
 *     floating point never touches a price
 *   - a client supplies *what* to buy and nothing else: price, totals, discount,
 *     status, ownership, payment and provisioning state are server-owned
 *   - authorization is decided by the API guards; services stay framework-free
 *     and reusable
 *   - an order and its lines are written in one transaction, with a snapshot of
 *     what was bought
 *   - payment-driven order transitions are refused until the payment phase
 */
export * from './clock.js';
export * from './commerce-services.js';
export * from './errors.js';
export * from './money.js';
export * from './numbers.js';
export * from './ports.js';
export * from './validation.js';

export * from './catalog/catalog-service.js';
export * from './catalog/profile-lookup.js';
export * from './catalog/product-service.js';
export * from './catalog/serialization.js';
export * from './catalog/status.js';
export * from './catalog/types.js';
export * from './catalog/validation.js';
export * from './catalog/variant-service.js';

export * from './orders/order-service.js';
export * from './orders/pricing.js';
export * from './orders/serialization.js';
export * from './orders/state.js';
export * from './orders/types.js';
export * from './orders/validation.js';

export * from './resources/resource-profile-service.js';
export * from './resources/serialization.js';
export * from './resources/types.js';
export * from './resources/validation.js';

export * from './adapters/prisma-commerce-store.js';
