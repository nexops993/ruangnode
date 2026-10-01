/**
 * @ruangnode/database
 *
 * Boundary: the PostgreSQL schema, migrations and the typed client used by the
 * control plane. No other package talks to the database directly.
 *
 * What lives here (Phase 1):
 *   - `prisma/schema.prisma`  the complete schema (see docs/DATABASE.md)
 *   - `prisma/migrations`     the first migration
 *   - `prisma/seed.ts`        development seed (catalog data only)
 *   - `src/client.ts`         the driver-adapter based client factory
 *   - `src/config.ts`         environment handling for tooling and processes
 *
 * Rules enforced by the schema and the tests next to it:
 *   - money is stored in integer minor units, never floating point
 *   - order, payment, subscription, provisioning, instance and node state stay
 *     separate enums/columns
 *   - webhook events are unique per (provider, externalEventId)
 *   - provisioning jobs carry a unique idempotency key
 *   - credentials are stored as an encrypted envelope, never in plaintext
 *   - resource profiles describe limits that infrastructure can actually
 *     enforce (docs/RESOURCE_ISOLATION.md)
 */

export * from './client.js';
export * from './config.js';

/**
 * Generated Prisma client types.
 *
 * Re-exported as *types only*: consumers that need to name the client or a
 * transaction client (for example the Prisma-backed store in `@ruangnode/auth`)
 * get the exact generated types without pulling the client runtime into their
 * module graph. Runtime values (`createDatabaseClient`, and the generated enums
 * when they are needed) are imported explicitly.
 */
export { Prisma } from './generated/prisma/client.js';
export type { PrismaClient } from './generated/prisma/client.js';

/**
 * Schema enums, re-exported as runtime values.
 *
 * The database layer owns the enumerations of the schema (docs/DATABASE.md),
 * so domain code must not re-declare them: a duplicated literal union silently
 * drifts from the schema the day a value is added. `ProductStatus`, for example,
 * is both the const object (`ProductStatus.ACTIVE`) and the string union type
 * (`'DRAFT' | 'ACTIVE' | 'ARCHIVED'`) derived from the generated client.
 */
export {
  BillingPeriod,
  DiskPolicy,
  MemorySwapPolicy,
  OrderStatus,
  PaymentStatus,
  ProductStatus,
  ProductType,
} from './generated/prisma/enums.js';
