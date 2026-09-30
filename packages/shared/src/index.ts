/**
 * @ruangnode/shared
 *
 * Platform-wide primitives shared by every RuangNode service and application.
 *
 * Phase 0 scope: explicit result values and the structured error taxonomy that
 * the control plane API, services and Node Agent all depend on. Domain models
 * (products, orders, instances, provisioning) are added in later phases.
 */

export * from './errors.js';
export * from './result.js';
