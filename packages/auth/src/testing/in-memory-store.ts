/**
 * In-memory implementation of the authentication store.
 *
 * Test double for `AuthStore`. It lives in the package (exported through
 * `@ruangnode/auth/testing`) so the API tests and the cross-package integration
 * tests exercise exactly the same implementation, and it mirrors the documented
 * behaviour of the Prisma store, including:
 *
 *   - a duplicate email throws the same structured conflict error
 *   - `claim` is a single-use transition (a second caller gets `false`)
 *   - `transaction` rolls back on failure
 *
 * It is never used by the control plane process: `apps/api/src/index.ts` always
 * wires the Prisma store.
 */
import { assertAuditMetadataIsSafe } from '../audit.js';
import { emailAlreadyRegisteredError } from '../errors.js';
import type {
  AuditEventInput,
  AuditRepository,
  AuthStore,
  AuthUser,
  CreatePasswordResetInput,
  CreateSessionInput,
  CreateUserInput,
  PasswordResetRecord,
  PasswordResetRepository,
  SessionRecord,
  SessionRepository,
  UserRepository,
} from '../ports.js';

interface StoreState {
  users: Map<string, AuthUser>;
  sessions: Map<string, SessionRecord>;
  passwordResets: Map<string, PasswordResetRecord>;
  auditEvents: AuditEventInput[];
}

export interface InMemoryAuthStore extends AuthStore {
  /** All accounts, for assertions. */
  inspectUsers(): AuthUser[];
  /** All sessions, including revoked and expired ones, for assertions. */
  inspectSessions(): SessionRecord[];
  /** All reset tokens, including consumed ones, for assertions. */
  inspectPasswordResets(): PasswordResetRecord[];
  /** Recorded audit events, in write order. */
  inspectAuditEvents(): AuditEventInput[];
  /**
   * Changes an account's status, for tests that exercise suspension or
   * disabling. The real store only exposes this through admin tooling.
   */
  setUserStatus(userId: string, status: AuthUser['status']): void;
  /**
   * Changes an account's role, for tests that exercise privileged access. The
   * real store only exposes this through admin tooling.
   */
  setUserRole(userId: string, role: AuthUser['role']): void;
}

export interface InMemoryAuthStoreOptions {
  /** Id generator; defaults to `crypto.randomUUID()`. */
  generateId?: () => string;
}

export function createInMemoryAuthStore(options: InMemoryAuthStoreOptions = {}): InMemoryAuthStore {
  const generateId = options.generateId ?? (() => crypto.randomUUID());

  let state: StoreState = {
    users: new Map(),
    sessions: new Map(),
    passwordResets: new Map(),
    auditEvents: [],
  };

  const users: UserRepository = {
    async findByEmail(email) {
      for (const user of state.users.values()) {
        if (user.email === email) {
          return { ...user };
        }
      }

      return null;
    },

    async findById(id) {
      const user = state.users.get(id);

      return user === undefined ? null : { ...user };
    },

    async create(input: CreateUserInput) {
      for (const user of state.users.values()) {
        if (user.email === input.email) {
          throw emailAlreadyRegisteredError();
        }
      }

      const user: AuthUser = {
        id: generateId(),
        email: input.email,
        name: input.name,
        role: input.role,
        status: 'ACTIVE',
        passwordHash: input.passwordHash,
        lastLoginAt: null,
      };

      state.users.set(user.id, user);

      return { ...user };
    },

    async updatePasswordHash(userId, passwordHash) {
      const user = state.users.get(userId);

      if (user === undefined) {
        throw new Error(`In-memory store: user ${userId} does not exist.`);
      }

      state.users.set(userId, { ...user, passwordHash });
    },

    async recordSuccessfulLogin(userId, at) {
      const user = state.users.get(userId);

      if (user === undefined) {
        throw new Error(`In-memory store: user ${userId} does not exist.`);
      }

      state.users.set(userId, { ...user, lastLoginAt: at });
    },
  };

  const sessions: SessionRepository = {
    async create(input: CreateSessionInput) {
      const session: SessionRecord = {
        id: generateId(),
        userId: input.userId,
        tokenHash: input.tokenHash,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        lastUsedAt: input.createdAt,
        revokedAt: null,
        revokedReason: null,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      };

      state.sessions.set(session.id, session);

      return { ...session };
    },

    async findByTokenHash(tokenHash) {
      for (const session of state.sessions.values()) {
        if (session.tokenHash === tokenHash) {
          return { ...session };
        }
      }

      return null;
    },

    async findById(id) {
      const session = state.sessions.get(id);

      return session === undefined ? null : { ...session };
    },

    async listActiveForUser(userId, now) {
      return [...state.sessions.values()]
        .filter(
          (session) =>
            session.userId === userId &&
            session.revokedAt === null &&
            session.expiresAt.getTime() > now.getTime(),
        )
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .map((session) => ({ ...session }));
    },

    async touch(id, at) {
      const session = state.sessions.get(id);

      if (session !== undefined) {
        state.sessions.set(id, { ...session, lastUsedAt: at });
      }
    },

    async revokeById(id, at, reason) {
      const session = state.sessions.get(id);

      if (session === undefined || session.revokedAt !== null) {
        return false;
      }

      state.sessions.set(id, { ...session, revokedAt: at, revokedReason: reason });

      return true;
    },

    async revokeByTokenHash(tokenHash, at, reason) {
      for (const session of state.sessions.values()) {
        if (session.tokenHash === tokenHash) {
          return sessions.revokeById(session.id, at, reason);
        }
      }

      return false;
    },

    async revokeAllForUser(userId, at, reason, options) {
      let revoked = 0;

      for (const session of state.sessions.values()) {
        if (
          session.userId !== userId ||
          session.revokedAt !== null ||
          session.id === options?.exceptSessionId
        ) {
          continue;
        }

        state.sessions.set(session.id, { ...session, revokedAt: at, revokedReason: reason });
        revoked += 1;
      }

      return revoked;
    },
  };

  const passwordResets: PasswordResetRepository = {
    async create(input: CreatePasswordResetInput) {
      const record: PasswordResetRecord = {
        id: generateId(),
        userId: input.userId,
        tokenHash: input.tokenHash,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        usedAt: null,
        requestedIp: input.requestedIp,
        requestedUserAgent: input.requestedUserAgent,
      };

      state.passwordResets.set(record.id, record);

      return { ...record };
    },

    async findByTokenHash(tokenHash) {
      for (const record of state.passwordResets.values()) {
        if (record.tokenHash === tokenHash) {
          return { ...record };
        }
      }

      return null;
    },

    async claim(tokenHash, at) {
      for (const record of state.passwordResets.values()) {
        if (record.tokenHash !== tokenHash) {
          continue;
        }

        if (record.usedAt !== null || record.expiresAt.getTime() <= at.getTime()) {
          return false;
        }

        state.passwordResets.set(record.id, { ...record, usedAt: at });

        return true;
      }

      return false;
    },

    async invalidateForUser(userId, at) {
      let invalidated = 0;

      for (const record of state.passwordResets.values()) {
        if (record.userId !== userId || record.usedAt !== null) {
          continue;
        }

        state.passwordResets.set(record.id, { ...record, usedAt: at });
        invalidated += 1;
      }

      return invalidated;
    },
  };

  const audit: AuditRepository = {
    async record(event: AuditEventInput) {
      assertAuditMetadataIsSafe(event.metadata);
      state.auditEvents.push({ ...event });
    },
  };

  const store: InMemoryAuthStore = {
    users,
    sessions,
    passwordResets,
    audit,

    async transaction<T>(work: (transactionStore: AuthStore) => Promise<T>): Promise<T> {
      const snapshot = structuredClone(state);

      try {
        return await work(store);
      } catch (error) {
        state = snapshot;
        throw error;
      }
    },

    inspectUsers: () => [...state.users.values()].map((user) => ({ ...user })),
    inspectSessions: () => [...state.sessions.values()].map((session) => ({ ...session })),
    inspectPasswordResets: () =>
      [...state.passwordResets.values()].map((record) => ({ ...record })),
    inspectAuditEvents: () => state.auditEvents.map((event) => ({ ...event })),

    setUserStatus(userId, status) {
      const user = state.users.get(userId);

      if (user === undefined) {
        throw new Error(`In-memory store: user ${userId} does not exist.`);
      }

      state.users.set(userId, { ...user, status });
    },

    setUserRole(userId, role) {
      const user = state.users.get(userId);

      if (user === undefined) {
        throw new Error(`In-memory store: user ${userId} does not exist.`);
      }

      state.users.set(userId, { ...user, role });
    },
  };

  return store;
}
