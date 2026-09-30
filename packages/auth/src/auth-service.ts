/**
 * Authentication service.
 *
 * Owns the use cases: register, log in, log out, resolve the current user,
 * revoke sessions and complete the password-reset flow. It depends on ports
 * (store, hasher, notifier, clock) and contains no HTTP, Fastify or Prisma
 * knowledge, so the same logic is driven by route handlers, tests and future
 * admin tooling.
 *
 * Security rules implemented here:
 *   - passwords are hashed with Argon2id and never stored or logged in plaintext
 *   - a client-supplied role is never trusted: registration always creates a
 *     CUSTOMER
 *   - failures that could disclose account state (unknown account, wrong
 *     password, inactive account) return one identical error, while the real
 *     reason is recorded in the audit log
 *   - password-reset requests always produce the same outcome, whether or not the
 *     account exists
 *   - a reset token is single-use, expiring, and revokes every existing session
 */
import { MINUTE_MS, systemClock, type Clock } from './clock.js';
import { isValidEmail, normalizeEmail } from './email.js';
import {
  AUDIT_ACTIONS,
  AUDIT_RESOURCE_TYPES,
  type AuditAction,
  type AuditMetadata,
} from './audit.js';
import {
  emailAlreadyRegisteredError,
  invalidCredentialsError,
  invalidResetTokenError,
} from './errors.js';
import { buildPasswordResetUrl, NullPasswordResetNotifier } from './notifiers.js';
import {
  DEFAULT_PASSWORD_POLICY,
  findPasswordPolicyViolation,
  type PasswordPolicy,
  type PasswordHasher,
} from './password.js';
import type { AuthStore, AuthUser, PasswordResetNotifier, RequestMetadata } from './ports.js';
import { isAccountActive } from './roles.js';
import {
  SessionService,
  type AuthenticatedSession,
  type IssuedSession,
} from './session-service.js';
import { generateSecretToken, hashSecretToken } from './tokens.js';
import { AppError } from '@ruangnode/shared';

/** Reset links are short-lived: long enough for a mail round trip, no longer. */
export const DEFAULT_PASSWORD_RESET_TTL_MS = 60 * MINUTE_MS;

const DEFAULT_RESET_LINK_BASE_URL = 'https://ruangnode.me/account/reset-password';

/** User projection safe to return from an API (never the password hash). */
export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  role: AuthUser['role'];
  status: AuthUser['status'];
}

export function toPublicUser(user: AuthUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
  };
}

export interface AuthenticatedResult {
  user: PublicUser;
  session: IssuedSession;
}

export interface RegisterInput {
  email: string;
  password: string;
  name?: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface PasswordResetRequestInput {
  email: string;
}

export interface PasswordResetConfirmInput {
  token: string;
  password: string;
}

export interface AuthServiceOptions {
  store: AuthStore;
  hasher: PasswordHasher;
  clock?: Clock;
  notifier?: PasswordResetNotifier;
  passwordPolicy?: PasswordPolicy;
  sessionTtlMs?: number;
  touchThrottleMs?: number;
  passwordResetTtlMs?: number;
  resetLinkBaseUrl?: string;
}

/** Why a login attempt failed. Recorded in the audit log only. */
type LoginFailureReason =
  'UNKNOWN_ACCOUNT' | 'NO_PASSWORD' | 'INVALID_PASSWORD' | 'ACCOUNT_NOT_ACTIVE';

/** Why a reset token was rejected. Recorded in the audit log only. */
type ResetFailureReason = 'UNKNOWN_TOKEN' | 'EXPIRED' | 'ALREADY_USED' | 'UNKNOWN_ACCOUNT';

function validationFailed(message: string): AppError {
  return new AppError({ code: 'VALIDATION_FAILED', message });
}

export class AuthService {
  private readonly store: AuthStore;
  private readonly hasher: PasswordHasher;
  private readonly clock: Clock;
  private readonly notifier: PasswordResetNotifier;
  private readonly passwordPolicy: PasswordPolicy;
  private readonly passwordResetTtlMs: number;
  private readonly resetLinkBaseUrl: string;

  /** Session operations, also used by the API guards. */
  readonly sessions: SessionService;

  /**
   * Hash of a random value, used to spend comparable work when no password hash
   * exists. Without it, "unknown account" would answer measurably faster than
   * "wrong password" and leak account existence.
   */
  private dummyHashPromise: Promise<string> | null = null;

  constructor(options: AuthServiceOptions) {
    this.store = options.store;
    this.hasher = options.hasher;
    this.clock = options.clock ?? systemClock;
    this.notifier = options.notifier ?? new NullPasswordResetNotifier();
    this.passwordPolicy = options.passwordPolicy ?? DEFAULT_PASSWORD_POLICY;
    this.passwordResetTtlMs = options.passwordResetTtlMs ?? DEFAULT_PASSWORD_RESET_TTL_MS;
    this.resetLinkBaseUrl = options.resetLinkBaseUrl ?? DEFAULT_RESET_LINK_BASE_URL;

    this.sessions = new SessionService({
      store: options.store,
      clock: this.clock,
      ...(options.sessionTtlMs === undefined ? {} : { ttlMs: options.sessionTtlMs }),
      ...(options.touchThrottleMs === undefined
        ? {}
        : { touchThrottleMs: options.touchThrottleMs }),
    });
  }

  /**
   * Creates an account and signs it in.
   *
   * The role is always CUSTOMER: privilege is granted by an admin action, never
   * by a registration request.
   */
  async register(input: RegisterInput, metadata: RequestMetadata): Promise<AuthenticatedResult> {
    const email = normalizeEmail(input.email);

    if (!isValidEmail(email)) {
      throw validationFailed('Enter a valid email address.');
    }

    const violation = findPasswordPolicyViolation(input.password, {
      email,
      policy: this.passwordPolicy,
    });

    if (violation !== null) {
      throw validationFailed(violation.message);
    }

    if ((await this.store.users.findByEmail(email)) !== null) {
      throw emailAlreadyRegisteredError();
    }

    const passwordHash = await this.hasher.hash(input.password);
    const name = input.name?.trim();

    const user = await this.store.users.create({
      email,
      name: name === undefined || name === '' ? null : name,
      passwordHash,
      role: 'CUSTOMER',
    });

    await this.recordAudit(AUDIT_ACTIONS.register, user.id, { role: user.role }, metadata, user.id);

    const session = await this.sessions.issue(user.id, metadata);

    return { user: toPublicUser(user), session };
  }

  /**
   * Verifies credentials and starts a session.
   *
   * Every failure mode answers with the same error; the reason is audited.
   */
  async login(input: LoginInput, metadata: RequestMetadata): Promise<AuthenticatedResult> {
    const email = normalizeEmail(input.email);
    const user = await this.store.users.findByEmail(email);
    const failureReason = await this.verifyCredentials(user, input.password);

    if (failureReason !== null) {
      await this.recordAudit(
        AUDIT_ACTIONS.loginFailed,
        user?.id ?? null,
        { reason: failureReason, emailKnown: user !== null },
        metadata,
        user?.id ?? null,
      );

      throw invalidCredentialsError();
    }

    // `verifyCredentials` returns null only for an existing, active account.
    const authenticatedUser = user as AuthUser;
    const session = await this.sessions.issue(authenticatedUser.id, metadata);

    await this.store.users.recordSuccessfulLogin(authenticatedUser.id, this.clock.now());

    await this.recordAudit(
      AUDIT_ACTIONS.loginSucceeded,
      authenticatedUser.id,
      { role: authenticatedUser.role },
      metadata,
      authenticatedUser.id,
    );

    return { user: toPublicUser(authenticatedUser), session };
  }

  /** Ends the session identified by `token`. Idempotent. */
  async logout(token: string, metadata: RequestMetadata): Promise<void> {
    const authenticated = await this.sessions.authenticate(token);

    if (authenticated === null) {
      return;
    }

    await this.sessions.revokeByToken(token, 'LOGOUT');

    await this.recordAudit(
      AUDIT_ACTIONS.logout,
      authenticated.user.id,
      {},
      metadata,
      authenticated.session.id,
      AUDIT_RESOURCE_TYPES.session,
    );
  }

  /** Resolves the current user from a session token, or `null`. */
  async authenticate(token: string): Promise<AuthenticatedSession | null> {
    return this.sessions.authenticate(token);
  }

  /**
   * Revokes a single session belonging to the caller.
   *
   * `SessionService.revokeOwnedSession` reports a foreign session as not found,
   * so this cannot be used to probe other users' sessions.
   */
  async revokeSession(
    actorUserId: string,
    sessionId: string,
    metadata: RequestMetadata,
  ): Promise<void> {
    await this.sessions.revokeOwnedSession(sessionId, actorUserId, 'LOGOUT');

    await this.recordAudit(
      AUDIT_ACTIONS.sessionRevoked,
      actorUserId,
      {},
      metadata,
      sessionId,
      AUDIT_RESOURCE_TYPES.session,
    );
  }

  /** Revokes every session of the caller except the current one. */
  async revokeOtherSessions(
    userId: string,
    currentSessionId: string,
    metadata: RequestMetadata,
  ): Promise<number> {
    const revokedCount = await this.sessions.revokeOthers(userId, currentSessionId, 'LOGOUT_ALL');

    await this.recordAudit(
      AUDIT_ACTIONS.sessionsRevokedAll,
      userId,
      { revokedCount },
      metadata,
      userId,
    );

    return revokedCount;
  }

  /**
   * Starts a password reset.
   *
   * The caller must always answer with `AUTH_MESSAGES.passwordResetRequested`,
   * whatever happens here, so the endpoint cannot be used to discover whether an
   * account exists.
   */
  async requestPasswordReset(
    input: PasswordResetRequestInput,
    metadata: RequestMetadata,
  ): Promise<void> {
    const email = normalizeEmail(input.email);
    const user = isValidEmail(email) ? await this.store.users.findByEmail(email) : null;
    const eligible = user !== null && isAccountActive(user.status) && user.passwordHash !== null;

    if (user !== null && eligible) {
      const now = this.clock.now();
      const expiresAt = new Date(now.getTime() + this.passwordResetTtlMs);
      const token = generateSecretToken();

      // Only the most recent link stays valid: a new request invalidates any
      // outstanding tokens for the account.
      await this.store.passwordResets.invalidateForUser(user.id, now);

      await this.store.passwordResets.create({
        userId: user.id,
        tokenHash: hashSecretToken(token),
        createdAt: now,
        expiresAt,
        requestedIp: metadata.ipAddress,
        requestedUserAgent: metadata.userAgent,
      });

      await this.notifier.send({
        userId: user.id,
        email: user.email,
        token,
        resetUrl: buildPasswordResetUrl(this.resetLinkBaseUrl, token),
        expiresAt,
        requestedIp: metadata.ipAddress,
      });
    }

    await this.recordAudit(
      AUDIT_ACTIONS.passwordResetRequested,
      user?.id ?? null,
      { accountFound: eligible },
      metadata,
      user?.id ?? null,
    );
  }

  /**
   * Completes a password reset.
   *
   * The token is claimed atomically, the password hash is replaced and every
   * session is revoked in one transaction, so a failure cannot leave a consumed
   * token with an unchanged password.
   */
  async confirmPasswordReset(
    input: PasswordResetConfirmInput,
    metadata: RequestMetadata,
  ): Promise<void> {
    const now = this.clock.now();
    const tokenHash = hashSecretToken(input.token);
    const record = await this.store.passwordResets.findByTokenHash(tokenHash);
    const failureReason = describeResetFailure(record, now);

    if (record === null || failureReason !== null) {
      await this.recordAudit(
        AUDIT_ACTIONS.passwordResetRejected,
        record?.userId ?? null,
        { reason: failureReason ?? 'UNKNOWN_TOKEN' },
        metadata,
        record?.userId ?? null,
      );

      throw invalidResetTokenError();
    }

    const user = await this.store.users.findById(record.userId);

    if (user === null) {
      await this.recordAudit(
        AUDIT_ACTIONS.passwordResetRejected,
        null,
        { reason: 'UNKNOWN_ACCOUNT' satisfies ResetFailureReason },
        metadata,
        null,
      );

      throw invalidResetTokenError();
    }

    const violation = findPasswordPolicyViolation(input.password, {
      email: user.email,
      policy: this.passwordPolicy,
    });

    if (violation !== null) {
      throw validationFailed(violation.message);
    }

    const passwordHash = await this.hasher.hash(input.password);

    await this.store.transaction(async (transaction) => {
      const claimed = await transaction.passwordResets.claim(tokenHash, now);

      if (!claimed) {
        // Lost a race against a concurrent confirmation: the token is spent.
        throw invalidResetTokenError();
      }

      await transaction.users.updatePasswordHash(user.id, passwordHash);
      await transaction.sessions.revokeAllForUser(user.id, now, 'PASSWORD_RESET');
    });

    await this.recordAudit(AUDIT_ACTIONS.passwordResetCompleted, user.id, {}, metadata, user.id);
  }

  /**
   * Verifies a password, returning the failure reason or `null` on success.
   *
   * Also transparently upgrades a stored hash when it was produced with outdated
   * Argon2id parameters.
   */
  private async verifyCredentials(
    user: AuthUser | null,
    password: string,
  ): Promise<LoginFailureReason | null> {
    if (user === null || user.passwordHash === null) {
      await this.spendComparableHashingTime(password);

      return user === null ? 'UNKNOWN_ACCOUNT' : 'NO_PASSWORD';
    }

    if (!(await this.hasher.verify(user.passwordHash, password))) {
      return 'INVALID_PASSWORD';
    }

    if (!isAccountActive(user.status)) {
      return 'ACCOUNT_NOT_ACTIVE';
    }

    if (this.hasher.needsRehash(user.passwordHash)) {
      await this.store.users.updatePasswordHash(user.id, await this.hasher.hash(password));
    }

    return null;
  }

  /** Spends work comparable to a real verification, to avoid a timing oracle. */
  private async spendComparableHashingTime(password: string): Promise<void> {
    this.dummyHashPromise ??= this.hasher.hash(generateSecretToken());
    await this.hasher.verify(await this.dummyHashPromise, password);
  }

  private async recordAudit(
    action: AuditAction,
    actorUserId: string | null,
    metadata: AuditMetadata,
    request: RequestMetadata,
    resourceId: string | null,
    resourceType: string = AUDIT_RESOURCE_TYPES.user,
  ): Promise<void> {
    await this.store.audit.record({
      action,
      actorUserId,
      resourceType,
      resourceId,
      metadata,
      ipAddress: request.ipAddress,
      userAgent: request.userAgent,
    });
  }
}

/** Classifies a reset token without telling the caller which case it was. */
function describeResetFailure(
  record: { expiresAt: Date; usedAt: Date | null } | null,
  now: Date,
): ResetFailureReason | null {
  if (record === null) {
    return 'UNKNOWN_TOKEN';
  }

  if (record.usedAt !== null) {
    return 'ALREADY_USED';
  }

  return record.expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : null;
}
