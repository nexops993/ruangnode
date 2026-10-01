# Phase 2 Commerce Core Audit

Audit baseline: commit `433b7bb`. Reviewed `docs/DECISIONS.md`,
`docs/DATABASE.md`, `docs/API.md`, `packages/services/src/`,
`apps/api/src/commerce/`, the Prisma schema and related tests.

## Implemented Functionality

- Product and variant administration is implemented through `ProductService` and
  `VariantService`: draft-first creation, slug/SKU uniqueness, product-type and
  billing-period checks, resource-profile compatibility, guarded publication,
  archival/deactivation, and admin projections.
- Resource profiles are validated with explicit CPU millicores, byte, PID,
  swap-policy and disk-policy rules. Profiles can be activated/deactivated and
  resource values are guarded while an active variant uses the profile.
- Public catalog reads filter products to `ACTIVE`, variants to `ACTIVE`, and
  exclude variants whose resource profile is inactive or missing. Type,
  `serviceType`, pagination, slug lookup and public/admin serialization are
  present.
- Prices and byte quantities remain `bigint` in the domain and persistence
  adapter, and are serialized as decimal strings. `OrderService` computes line
  totals and order totals from the stored variant price.
- Order creation uses the authenticated user id, verifies product/variant
  ownership and availability, captures commercial/resource data in an order-item
  snapshot, starts orders as `PENDING`, and writes the order plus lines in one
  transaction. Customer listing, detail, cancellation and hidden cross-tenant
  access are implemented.
- Commerce routes use `requireAuth`, `requireRole('ADMIN')`, and an ownership
  guard. Request schemas reject unknown/server-owned fields and response
  projections prevent `BigInt` and internal fields from reaching JSON.
- The Prisma adapter maps domain records explicitly, preserves `BigInt`, maps
  nullable JSON using `Prisma.DbNull`, translates unique/missing-row errors,
  uses compare-and-swap for order status, and binds nested store operations to a
  Prisma interactive transaction.

## Incomplete Functionality

- Payment-backed order transitions are not implemented. `PAID`, `FAILED`,
  `EXPIRED` and `REFUNDED` are intentionally gated by
  `assertPaymentPhaseAllows()` in `packages/services/src/orders/state.ts`.
  There are no payment or webhook routes, so this is a Phase 2 boundary rather
  than a defect in order creation.
- Node compatibility validation for a resource profile is not implemented.
  `docs/DATABASE.md` requires validation against a target node, but the current
  commerce ports have no node repository, target-node input or compatibility
  service. This is likely owned by scheduling/provisioning, but remains absent.
- The API specification lists `DELETE /admin/resource-profiles/:id`; no such
  route exists in `apps/api/src/commerce/routes.ts`. This conflicts with
  `DECISIONS.md` D-021 and the resource service design, which intentionally
  deactivates profiles rather than deleting referenced history. The contract
  needs to be reconciled; currently the documented endpoint is incomplete.
- Payments, subscriptions, provisioning, Node Agent operations and related
  routes are outside this checkpoint and were not implemented, as required by
  the audit scope.

## Confirmed Defects

1. **Profile deactivation can bypass the lifecycle guard.**
   `ResourceProfileService.update()` calls `assertNotUsedByActiveVariant()` only
   when resource values change. `parseUpdateResourceProfileInput()` accepts
   `active`, so `PATCH /admin/resource-profiles/:id` with `{ "active": false }`
   can deactivate a profile still referenced by an active variant. The separate
   `setActive()` path is guarded, but the generic PATCH route bypasses it.
   Relevant code: `packages/services/src/resources/resource-profile-service.ts`
   (`update`, `setActive`) and `apps/api/src/commerce/routes.ts`
   (`registerAdminProfileRoutes`).

2. **Public catalog pagination and detail can expose non-purchasable products.**
   `CatalogService.buildPublicProducts()` removes inactive-profile variants but
   still returns every active product passed to it. Consequently an active
   product with no sellable variants is returned with `variants: []` and
   `priceFrom: null`; list pagination is also applied before this filtering,
   which can produce short pages while later sellable products are omitted.
   `getProductBySlug()` likewise returns such an empty product instead of the
   documented purchasable public view. Relevant code:
   `packages/services/src/catalog/catalog-service.ts` (`listProducts`,
   `getProductBySlug`, `buildPublicProducts`).

## Potential Risks

- Product publication, variant publication, profile updates and profile
  deactivation use read-then-write checks without a transaction or conditional
  database update. Concurrent admin operations can invalidate a check between
  the read and write. The order path has stronger transactional/CAS behavior.
- An active variant's price, currency, resource profile and configuration can be
  edited by `VariantService.update()`. Order snapshots preserve historical
  orders, but checkout-versus-edit concurrency and the intended catalog
  mutation policy are not defined or tested.
- The production Prisma adapter has no commerce integration tests in the
  reviewed test set. Its transaction binding, JSON null mapping, BigInt mapping,
  referential constraints and rollback behavior are therefore code-reviewed but
  not exercised against PostgreSQL here.
- The API standard in `docs/API.md` includes `requestId` in success and error
  envelopes, but the shared `ErrorResponseBody`, commerce schemas and
  `toErrorResponse()` omit it. This is a platform contract mismatch, not a
  commerce authorization defect.

## Missing Tests

- API/service test for PATCH `{ active: false }` on a profile used by an active
  variant; the status endpoint is tested indirectly, but the bypass is not.
- Catalog tests proving active products with zero sellable variants are omitted,
  product-detail behavior is consistent, and pagination occurs over sellable
  products.
- Contract test for the documented resource-profile DELETE behavior after the
  API/decision conflict is resolved.
- Product/variant/profile lifecycle concurrency tests.
- PostgreSQL-backed Prisma adapter tests for order rollback, nested order-item
  creation, BigInt/nullable JSON mapping, unique violations and restricted
  historical references.
- Order-service tests for customer cancellation ownership, missing orders,
  compare-and-swap conflicts, and snapshot stability after catalog/profile
  mutation.
- Route tests for validation/error serialization across all commerce write
  endpoints, including the standard `requestId` contract if that field remains
  required.

## Prioritized Remaining Phase 2 Tasks

1. Fix the profile PATCH lifecycle path so every deactivation goes through the
   same active-variant guard; add a regression test.
2. Define public-catalog semantics around sellability, then filter before
   pagination and add list/detail regression tests.
3. Resolve the `DELETE /admin/resource-profiles/:id` conflict between `API.md`
   and D-021. Prefer an explicit deactivation contract if physical deletion is
   forbidden by historical references.
4. Add PostgreSQL integration coverage for `createPrismaCommerceStore()` and
   transaction rollback/referential behavior.
5. Decide and document whether active variant commercial fields may change, and
   add concurrency/immutability coverage accordingly.
6. Implement payment/webhook-driven order transitions only in the payment phase;
   do not weaken the current payment gate in Commerce Core.

## Validation

Focused tests passed at audit time:

- `@ruangnode/services`: 5 files, 38 tests.
- `@ruangnode/api`: 5 files, 61 tests.

The tests pass, but the confirmed defects above are outside their current
assertions. No source code, dependencies or existing tests were modified.