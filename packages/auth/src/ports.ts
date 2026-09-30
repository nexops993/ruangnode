/**
 * Storage ports.
 *
 * The authentication domain talks to these interfaces only. The production
 * implementation is Prisma-backed (`adapters/prisma-auth-store.ts`); tests use an
 * in-memory implementation (`testing/in-memory-store.ts`). This keeps the
 * services testable without a database while the persistence path stays a real
 * adapter (`.clinerules` → dependency injection for infrastructure adapters).
 */
import type { AccountStatus, Role } from './roles.js';
import type { AuditAction, AuditMetadata } from './audit.js';

/** An account as the authentication domain sees it (includes the hash). */
export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: AccountStatus;
  /** `null` for accounts that only have an external identity. */
  passwordHash: string | null;
  lastLoginAt: Date | null;
}

export type SessionRevocationReason = 'LOGOUT' | 'LOGOUT_ALL' | 'PASSWORD_RESET' | 'ADMIN_REVOKED';

export interface SessionRecord {
  id: string;
  userId: string;
  /** SHA-256 of the session token. Never returned to a client. */
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date;
  revokedAt: Date | null;
  revokedReason: SessionRevocationReason | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface PasswordResetRecord {
  id: string;
  userId: string;
  /** SHA-256 of the reset token. Never returned to a client. */
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  requestedIp: string | null;
  requestedUserAgent: string | null;
}

export interface CreateUserInput {
  email: string;
  name: string | null;
  /** `null` for accounts that only have an external identity. */
  passwordHash: string | null;
  /**
   * Always `CUSTOMER` for self-service registration. Privileged roles are only
   * granted by an admin action, never by a request body.
   */
  role: Role;
}

export interface UserRepository {
  findByEmail(email: string): Promise<AuthUser | null>;
  findById(id: string): Promise<AuthUser | null>;
  /** Throws `emailAlreadyRegisteredError()` when the email is taken. */
  create(input: CreateUserInput): Promise<AuthUser>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  recordSuccessfulLogin(userId: string, at: Date): Promise<void>;
}

export interface CreateSessionInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface SessionRepository {
  create(input: CreateSessionInput): Promise<SessionRecord>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  findById(id: string): Promise<SessionRecord | null>;
  /** Sessions that are neither revoked nor expired at `now`. */
  listActiveForUser(userId: string, now: Date): Promise<SessionRecord[]>;
  touch(id: string, at: Date): Promise<void>;
  /** Returns `false` when the session was already revoked or does not exist. */
  revokeById(id: string, at: Date, reason: SessionRevocationReason): Promise<boolean>;
  revokeByTokenHash(tokenHash: string, at: Date, reason: SessionRevocationReason): Promise<boolean>;
  revokeAllForUser(
    userId: string,
    at: Date,
    reason: SessionRevocationReason,
    options?: { exceptSessionId?: string },
  ): Promise<number>;
}

export interface CreatePasswordResetInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  requestedIp: string | null;
  requestedUserAgent: string | null;
}

export interface PasswordResetRepository {
  create(input: CreatePasswordResetInput): Promise<PasswordResetRecord>;
  findByTokenHash(tokenHash: string): Promise<PasswordResetRecord | null>;
  /**
   * Atomically claims a token. Returns `true` only for the caller that
   * transitioned it from unused to used, which makes single-use enforcement
   * race-free.
   */
  claim(tokenHash: string, at: Date): Promise<boolean>;
  /** Marks outstanding unused tokens as consumed (used on a new request). */
  invalidateForUser(userId: string, at: Date): Promise<number>;
}

export interface AuditEventInput {
  action: AuditAction;
  /** `null` for events without an authenticated actor (failed logins). */
  actorUserId: string | null;
  resourceType: string;
  resourceId: string | null;
  metadata?: AuditMetadata;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt?: Date;
}

export interface AuditRepository {
  record(event: AuditEventInput): Promise<void>;
}

/**
 * Unit of work over the authentication repositories.
 *
 * `transaction` runs `work` atomically: password-reset confirmation consumes a
 * token, changes the password hash and revokes sessions as one operation, so a
 * failure cannot leave a consumed token with an unchanged password.
 */
export interface AuthStore {
  users: UserRepository;
  sessions: SessionRepository;
  passwordResets: PasswordResetRepository;
  audit: AuditRepository;
  transaction<T>(work: (store: AuthStore) => Promise<T>): Promise<T>;
}

/** A reset notification handed to an out-of-band delivery adapter. */
export interface PasswordResetNotification {
  userId: string;
  email: string;
  /** Single-use reset token. Must never be logged or returned by an API. */
  token: string;
  /** Absolute URL the customer follows; contains the token by design. */
  resetUrl: string;
  expiresAt: Date;
  requestedIp: string | null;
}

/**
 * Delivery port for password-reset messages.
 *
 * Email delivery is a later phase; the API wires `NullPasswordResetNotifier`
 * (which does nothing and says so) and tests wire the capturing notifier. No
 * implementation may log the token.
 */
export interface PasswordResetNotifier {
  send(notification: PasswordResetNotification): Promise<void>;
}

/** Request metadata that is recorded with sessions and audit events. */
export interface RequestMetadata {
  ipAddress: string | null;
  userAgent: string | null;
}
