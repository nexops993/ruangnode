/**
 * Prisma-backed implementation of the authentication store.
 *
 * This is the production persistence path. It is the only module in
 * `@ruangnode/auth` that knows about Prisma, and it is written against the
 * generated client's *types* only (`import type`), so importing this module does
 * not pull the database runtime into every consumer.
 *
 * Invariants enforced here rather than in the database:
 *   - a duplicate email surfaces as the same structured conflict error as the
 *     in-memory store, so both implementations behave identically
 *   - `claim` is a conditional update, which makes reset-token single-use
 *     race-free at the storage layer
 *   - audit metadata is rejected before it is written if it looks like a secret
 */
import type { Prisma, PrismaClient } from '@ruangnode/database';

import { assertAuditMetadataIsSafe } from '../audit.js';
import { emailAlreadyRegisteredError } from '../errors.js';
import type {
  AuditEventInput,
  AuthStore,
  AuthUser,
  CreatePasswordResetInput,
  CreateSessionInput,
  CreateUserInput,
  PasswordResetRecord,
  SessionRecord,
} from '../ports.js';
import type { AccountStatus, Role } from '../roles.js';
import type { SessionRevocationReason } from '../ports.js';

/** Either the root client or an interactive-transaction client. */
type PrismaLike = PrismaClient | Prisma.TransactionClient;

/** Row shapes this adapter relies on (structural, so no model imports). */
interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: AccountStatus;
  passwordHash: string | null;
  lastLoginAt: Date | null;
}

interface SessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date;
  revokedAt: Date | null;
  revokedReason: SessionRevocationReason | null;
  ipAddress: string | null;
  userAgent: string | null;
}

interface PasswordResetRow {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  requestedIp: string | null;
  requestedUserAgent: string | null;
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    passwordHash: row.passwordHash,
    lastLoginAt: row.lastLoginAt,
  };
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
  };
}

function toPasswordResetRecord(row: PasswordResetRow): PasswordResetRecord {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    requestedIp: row.requestedIp,
    requestedUserAgent: row.requestedUserAgent,
  };
}

/** True for a PostgreSQL unique-constraint violation reported by Prisma. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function buildStore(client: PrismaLike, transaction: AuthStore['transaction']): AuthStore {
  return {
    users: {
      async findByEmail(email: string): Promise<AuthUser | null> {
        const row = await client.user.findUnique({ where: { email } });

        return row === null ? null : toAuthUser(row);
      },

      async findById(id: string): Promise<AuthUser | null> {
        const row = await client.user.findUnique({ where: { id } });

        return row === null ? null : toAuthUser(row);
      },

      async create(input: CreateUserInput): Promise<AuthUser> {
        try {
          const row = await client.user.create({
            data: {
              email: input.email,
              name: input.name,
              passwordHash: input.passwordHash,
              role: input.role,
            },
          });

          return toAuthUser(row);
        } catch (error) {
          if (isUniqueViolation(error)) {
            // The unique index is the real guard against a registration race;
            // the pre-check in the service is only a fast path.
            throw emailAlreadyRegisteredError();
          }

          throw error;
        }
      },

      async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
        await client.user.update({ where: { id: userId }, data: { passwordHash } });
      },

      async recordSuccessfulLogin(userId: string, at: Date): Promise<void> {
        await client.user.update({ where: { id: userId }, data: { lastLoginAt: at } });
      },
    },

    sessions: {
      async create(input: CreateSessionInput): Promise<SessionRecord> {
        const row = await client.session.create({
          data: {
            userId: input.userId,
            tokenHash: input.tokenHash,
            expiresAt: input.expiresAt,
            createdAt: input.createdAt,
            lastUsedAt: input.createdAt,
            ipAddress: input.ipAddress,
            userAgent: input.userAgent,
          },
        });

        return toSessionRecord(row);
      },

      async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
        const row = await client.session.findUnique({ where: { tokenHash } });

        return row === null ? null : toSessionRecord(row);
      },

      async findById(id: string): Promise<SessionRecord | null> {
        const row = await client.session.findUnique({ where: { id } });

        return row === null ? null : toSessionRecord(row);
      },

      async listActiveForUser(userId: string, now: Date): Promise<SessionRecord[]> {
        const rows = await client.session.findMany({
          where: { userId, revokedAt: null, expiresAt: { gt: now } },
          orderBy: { createdAt: 'desc' },
        });

        return rows.map(toSessionRecord);
      },

      async touch(id: string, at: Date): Promise<void> {
        await client.session.update({ where: { id }, data: { lastUsedAt: at } });
      },

      async revokeById(id: string, at: Date, reason: SessionRevocationReason): Promise<boolean> {
        const result = await client.session.updateMany({
          where: { id, revokedAt: null },
          data: { revokedAt: at, revokedReason: reason },
        });

        return result.count > 0;
      },

      async revokeByTokenHash(
        tokenHash: string,
        at: Date,
        reason: SessionRevocationReason,
      ): Promise<boolean> {
        const result = await client.session.updateMany({
          where: { tokenHash, revokedAt: null },
          data: { revokedAt: at, revokedReason: reason },
        });

        return result.count > 0;
      },

      async revokeAllForUser(
        userId: string,
        at: Date,
        reason: SessionRevocationReason,
        options?: { exceptSessionId?: string },
      ): Promise<number> {
        const result = await client.session.updateMany({
          where: {
            userId,
            revokedAt: null,
            ...(options?.exceptSessionId === undefined
              ? {}
              : { id: { not: options.exceptSessionId } }),
          },
          data: { revokedAt: at, revokedReason: reason },
        });

        return result.count;
      },
    },

    passwordResets: {
      async create(input: CreatePasswordResetInput): Promise<PasswordResetRecord> {
        const row = await client.passwordResetToken.create({
          data: {
            userId: input.userId,
            tokenHash: input.tokenHash,
            createdAt: input.createdAt,
            expiresAt: input.expiresAt,
            requestedIp: input.requestedIp,
            requestedUserAgent: input.requestedUserAgent,
          },
        });

        return toPasswordResetRecord(row);
      },

      async findByTokenHash(tokenHash: string): Promise<PasswordResetRecord | null> {
        const row = await client.passwordResetToken.findUnique({ where: { tokenHash } });

        return row === null ? null : toPasswordResetRecord(row);
      },

      async claim(tokenHash: string, at: Date): Promise<boolean> {
        const result = await client.passwordResetToken.updateMany({
          where: { tokenHash, usedAt: null, expiresAt: { gt: at } },
          data: { usedAt: at },
        });

        return result.count === 1;
      },

      async invalidateForUser(userId: string, at: Date): Promise<number> {
        const result = await client.passwordResetToken.updateMany({
          where: { userId, usedAt: null },
          data: { usedAt: at },
        });

        return result.count;
      },
    },

    audit: {
      async record(event: AuditEventInput): Promise<void> {
        assertAuditMetadataIsSafe(event.metadata);

        await client.auditLog.create({
          data: {
            action: event.action,
            actorUserId: event.actorUserId,
            resourceType: event.resourceType,
            resourceId: event.resourceId,
            metadata: event.metadata as Prisma.InputJsonValue | undefined,
            ipAddress: event.ipAddress ?? null,
            userAgent: event.userAgent ?? null,
            ...(event.createdAt === undefined ? {} : { createdAt: event.createdAt }),
          },
        });
      },
    },

    transaction,
  };
}

/**
 * Creates the Prisma-backed authentication store.
 *
 * The caller owns the client lifecycle (`createDatabaseClient()` from
 * `@ruangnode/database`) and is responsible for disconnecting it.
 */
export function createPrismaAuthStore(prisma: PrismaClient): AuthStore {
  function runTransaction<T>(work: (store: AuthStore) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => work(buildStore(tx, runTransaction)));
  }

  return buildStore(prisma, runTransaction);
}
