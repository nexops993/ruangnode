/**
 * Roles and account status.
 *
 * These values mirror the `UserRole` and `UserStatus` enums in
 * `packages/database/prisma/schema.prisma`. They are declared here (instead of
 * importing the generated Prisma enums) so that authorization code stays free of
 * a runtime dependency on the database client; `roles.test.ts` parses the schema
 * and fails if the two definitions ever drift apart.
 *
 * Roles are always evaluated server-side: a role supplied by a client is never
 * trusted (`.clinerules` → Multi-tenant security).
 */
export const ROLES = ['CUSTOMER', 'SUPPORT', 'ADMIN'] as const;

export type Role = (typeof ROLES)[number];

/** Account states. Only `ACTIVE` accounts may authenticate. */
export const ACCOUNT_STATUSES = ['ACTIVE', 'SUSPENDED', 'DISABLED'] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function isAccountStatus(value: unknown): value is AccountStatus {
  return typeof value === 'string' && (ACCOUNT_STATUSES as readonly string[]).includes(value);
}

/** Only an active account may sign in or keep an existing session. */
export function isAccountActive(status: AccountStatus): boolean {
  return status === 'ACTIVE';
}

/**
 * Privileged roles may act on resources they do not own, but only through an
 * explicit permission (see `authorization.ts` → `allowSupport`).
 */
export function isPrivilegedRole(role: Role): boolean {
  return role === 'SUPPORT' || role === 'ADMIN';
}
