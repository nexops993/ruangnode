# @ruangnode/auth

Authentication, sessions, password hashing, role checks and ownership enforcement
for the RuangNode control plane.

**Boundary:** this package has no HTTP framework dependency. Fastify-specific
guards live in `apps/api/src/auth` and delegate every decision to the pure policy
functions here, so the same rules apply to route handlers, services and future
admin tooling.

```text
packages/auth/
├── src/
│   ├── password.ts          Argon2id hashing + password policy
│   ├── tokens.ts            bearer-token generation, SHA-256 hashing, constant-time compare
│   ├── session-service.ts   issue / resolve / revoke sessions
│   ├── auth-service.ts      register, login, logout, password reset
│   ├── authorization.ts     role + ownership policy (pure functions)
│   ├── rate-limit.ts        sliding-window limiter for auth endpoints
│   ├── audit.ts             audit action names + secret-safety guard
│   ├── ports.ts             storage and delivery interfaces
│   ├── adapters/            Prisma-backed store (production)
│   └── testing/             in-memory store, test clock, capturing notifier
└── vitest.config.ts
```

## Rules implemented here

- Passwords are Argon2id hashes (OWASP parameters), never plaintext, never logged,
  never returned. Login re-hashes credentials stored with outdated parameters.
- Sessions are database rows; only the SHA-256 hash of the token is stored, so
  revocation is immediate and does not depend on client state.
- Password-reset tokens are single-use (claimed by a conditional update),
  expiring, and revoke every session when used. A reset request never discloses
  whether an account exists.
- Roles are evaluated server-side; a role supplied by a client is never trusted.
- A resource owned by somebody else is reported as *not found*, so the API cannot
  be used to enumerate other tenants' resources.
- Audit metadata that looks like a secret is rejected at write time.

## Usage

```ts
import { AuthService, createArgon2idPasswordHasher, createPrismaAuthStore } from '@ruangnode/auth';

const store = createPrismaAuthStore(prisma);
const auth = new AuthService({ store, hasher: createArgon2idPasswordHasher() });
```

Tests use the same service with the doubles from `@ruangnode/auth/testing`:

```ts
import { createTestAuthFixture } from '@ruangnode/auth/testing';

const { service, store, clock, notifier } = createTestAuthFixture();
```

The Prisma adapter expects the tables from
`packages/database/prisma/migrations/20260930120000_auth_sessions`
(`Session`, `PasswordResetToken`).

## Tests

```bash
pnpm --filter @ruangnode/auth test
```

`apps/api/src/auth/*.test.ts` covers the HTTP contract, and
`tests/integration/auth-database.test.ts` runs the same flows against a real
PostgreSQL engine.
