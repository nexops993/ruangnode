/**
 * @ruangnode/services
 *
 * Boundary: business logic of the control plane — catalog and pricing, orders,
 * payment adapters, subscriptions, provisioning, scheduling and lifecycle
 * state machines.
 *
 * Phase 0 scope: the package boundary and its build configuration exist so the
 * API layer can call services instead of embedding business logic in handlers
 * (see .clinerules: "Never put business logic directly into UI components" and
 * "Build reusable domain services").
 *
 * Planned contents (later phases):
 *   - catalog, pricing and resource profile application
 *   - order and payment service with provider adapters
 *   - provisioning service with idempotency keys and explicit state flow
 *     PENDING -> PAID -> PROVISIONING -> ACTIVE
 *   - node scheduler and managed-service adapters
 *
 * Dependencies on infrastructure (database, payment providers, node agents)
 * are injected as interfaces so the services stay testable.
 */
export {};
