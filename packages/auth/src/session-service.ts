/**
 * Sessions.
 *
 * Sessions are database-backed and revocable: the browser holds an opaque token
 * in a cookie, the database holds its SHA-256 hash plus an absolute expiry and a
 * revocation marker. Every authenticated request is decided from the database,
 * so revoking a session takes effect immediately and no authorization decision
 * ever depends on client-supplied state.
 */
import { DAY_MS, MINUTE_MS, systemClock, type Clock } from './clock.js';
import { hiddenResourceError } from './errors.js';
import type {
  AuthStore,
  AuthUser,
  RequestMetadata,
  SessionRecord,
  SessionRevocationReason,
} from './ports.js';
import { isAccountActive } from './roles.js';
import { constantTimeEquals, generateSecretToken, hashSecretToken } from './tokens.js';

/** Absolute session lifetime. */
export const DEFAULT_SESSION_TTL_MS = 30 * DAY_MS;

/**
 * Minimum interval between `lastUsedAt` writes. Without this throttle every
 * authenticated request would cause a write.
 */
export const DEFAULT_TOUCH_THROTTLE_MS = 5 * MINUTE_MS;

export interface IssuedSession {
  sessionId: string;
  /** Plaintext token. Only ever placed in the session cookie. */
  token: string;
  expiresAt: Date;
}

export interface AuthenticatedSession {
  user: AuthUser;
  session: SessionRecord;
}

/** Session view safe to return from an API (no token, no hash). */
export interface PublicSession {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  /** True for the session that made the current request. */
  current: boolean;
}

export function toPublicSession(record: SessionRecord, currentSessionId: string): PublicSession {
  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    lastUsedAt: record.lastUsedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    ipAddress: record.ipAddress,
    userAgent: record.userAgent,
    current: record.id === currentSessionId,
  };
}

export interface SessionServiceOptions {
  store: AuthStore;
  clock?: Clock;
  ttlMs?: number;
  touchThrottleMs?: number;
}

export class SessionService {
  private readonly store: AuthStore;
  private readonly clock: Clock;
  private readonly ttlMs: number;
  private readonly touchThrottleMs: number;

  constructor(options: SessionServiceOptions) {
    this.store = options.store;
    this.clock = options.clock ?? systemClock;
    this.ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    this.touchThrottleMs = options.touchThrottleMs ?? DEFAULT_TOUCH_THROTTLE_MS;
  }

  /** Creates a session and returns the plaintext token exactly once. */
  async issue(userId: string, metadata: RequestMetadata): Promise<IssuedSession> {
    const createdAt = this.clock.now();
    const expiresAt = new Date(createdAt.getTime() + this.ttlMs);
    const token = generateSecretToken();

    const session = await this.store.sessions.create({
      userId,
      tokenHash: hashSecretToken(token),
      createdAt,
      expiresAt,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    });

    return { sessionId: session.id, token, expiresAt };
  }

  /**
   * Resolves a session token to its user.
   *
   * Returns `null` for unknown, expired, revoked or malformed tokens, and for
   * sessions whose account is no longer active (which also revokes them).
   */
  async authenticate(token: string): Promise<AuthenticatedSession | null> {
    if (token.trim() === '') {
      return null;
    }

    const tokenHash = hashSecretToken(token);
    const session = await this.store.sessions.findByTokenHash(tokenHash);

    if (session === null || !constantTimeEquals(session.tokenHash, tokenHash)) {
      return null;
    }

    const now = this.clock.now();

    if (session.revokedAt !== null || session.expiresAt.getTime() <= now.getTime()) {
      return null;
    }

    const user = await this.store.users.findById(session.userId);

    if (user === null || !isAccountActive(user.status)) {
      // A suspended or disabled account loses access immediately, even with a
      // valid session token.
      await this.store.sessions.revokeById(session.id, now, 'ADMIN_REVOKED');
      return null;
    }

    if (now.getTime() - session.lastUsedAt.getTime() >= this.touchThrottleMs) {
      await this.store.sessions.touch(session.id, now);
    }

    return { user, session };
  }

  /** Revokes the session identified by a token. Idempotent. */
  async revokeByToken(token: string, reason: SessionRevocationReason): Promise<boolean> {
    return this.store.sessions.revokeByTokenHash(hashSecretToken(token), this.clock.now(), reason);
  }

  /**
   * Revokes one of the caller's own sessions.
   *
   * Ownership is checked here rather than by the caller: a session that belongs
   * to somebody else is reported as not found, so the endpoint cannot be used to
   * enumerate session identifiers (`.clinerules` → IDOR).
   */
  async revokeOwnedSession(
    sessionId: string,
    ownerUserId: string,
    reason: SessionRevocationReason,
  ): Promise<void> {
    const session = await this.store.sessions.findById(sessionId);

    if (session === null || session.userId !== ownerUserId) {
      throw hiddenResourceError();
    }

    await this.store.sessions.revokeById(session.id, this.clock.now(), reason);
  }

  async listActive(userId: string): Promise<SessionRecord[]> {
    return this.store.sessions.listActiveForUser(userId, this.clock.now());
  }

  /** Revokes every session of a user except the one supplied. */
  async revokeOthers(
    userId: string,
    currentSessionId: string,
    reason: SessionRevocationReason,
  ): Promise<number> {
    return this.store.sessions.revokeAllForUser(userId, this.clock.now(), reason, {
      exceptSessionId: currentSessionId,
    });
  }

  /** Revokes every session of a user, including the current one. */
  async revokeAll(userId: string, reason: SessionRevocationReason): Promise<number> {
    return this.store.sessions.revokeAllForUser(userId, this.clock.now(), reason);
  }
}
