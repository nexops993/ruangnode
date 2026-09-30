# RuangNode — Decisions

Architectural and engineering decisions that must not live only in chat history
(see `.clinerules` → Documentation).

---

## Phase 0 — Project foundation

Status: implemented.

Scope: workspace, tooling and package boundaries only. No authentication, no
payments, no provisioning, no Docker runtime, no UI pages and no business
features. Every directory listed below exists and validates (`pnpm install`,
TypeScript, ESLint, Vitest).

Deliverables:

| Area | Artifact |
| --- | --- |
| Workspace | `package.json`, `pnpm-workspace.yaml` (with a dependency catalog) |
| TypeScript | `tsconfig.base.json` + one `tsconfig.json` per project |
| Lint / format | `eslint.config.mjs` (flat config), `.prettierrc.json`, `.prettierignore` |
| Tests | `vitest.config.ts` (root project aggregation) + per-project configs |
| Environment | `.env.example` (documented variables, no real values) |
| Applications | `apps/web`, `apps/api` |
| Libraries | `packages/shared`, `packages/database`, `packages/auth`, `packages/services`, `packages/ui` |
| Infrastructure | `node-agent`, `infra/`, `tests/` |

---

### D-001 — pnpm workspaces as the single package manager

Context: `MASTER_CLINE_PROMPT.md` prefers pnpm workspaces; the repository is a
monorepo containing applications, libraries and a node agent that share types
and tooling.

Decision: one pnpm workspace rooted at `ruangnode`, pinned through
`packageManager: pnpm@12.8.1` and `engines.node >= 22.12.0`. Each project
declares the dependencies it actually imports (no reliance on hoisting), so
package boundaries stay visible and enforced.

Consequence: `pnpm install` is the only supported install command. `npm` and
`yarn` are not supported. CI and developers should activate pnpm through
corepack (`corepack enable pnpm`).

### D-002 — Dependency versions are declared once in a pnpm catalog

Context: nine workspace projects would otherwise repeat the same version
ranges for TypeScript, Vitest, ESLint, Node types, etc.

Decision: all shared toolchain versions live in the `catalog:` block of
`pnpm-workspace.yaml`; projects reference them with `"catalog:"`.

Consequence: bumping a tool means editing one file. Adding a new project means
declaring `"catalog:"` entries rather than copied ranges.

### D-003 — TypeScript 5.9 for now (not 7.x)

Context: the registry currently publishes TypeScript 7.0.2 as `latest`, but the
current `typescript-eslint` release (`8.71.0`) declares a peer range of
`>=4.8.4 <6.1.0`.

Decision: pin `typescript: ^5.9.3`.

Consequence: type-aware linting and the parser stay on a supported combination.
TypeScript 7 can be adopted once `typescript-eslint` supports it; the change is
a single catalog entry.

### D-004 — Strict TypeScript, typecheck-only in Phase 0

Context: `MASTER_CLINE_PROMPT.md` requires strict typing; Phase 0 has no build
or deployment pipeline yet.

Decision: `tsconfig.base.json` enables `strict`, `noImplicitOverride`,
`noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`, `noUnusedLocals`,
`noUnusedParameters`, `noImplicitReturns`, `verbatimModuleSyntax`,
`isolatedModules` and `noEmit`. Projects extend it; a project may only widen
`lib`/`types` (for example `apps/web` adds DOM, `packages/shared` deliberately
keeps `types: []` so platform primitives stay runtime-agnostic).

Consequence: `pnpm typecheck` validates every project without emitting output.
Build outputs and a `dist` pipeline are introduced in a later phase together
with the deployment artifacts.

### D-005 — Module resolution: `NodeNext` for services, `bundler` for Next.js

Context: platform packages run on Node.js and are consumed by other workspace
packages; the Next.js app is bundled.

Decision: the base config uses `module: NodeNext` /
`moduleResolution: NodeNext`, and relative imports inside platform packages use
explicit `.js` specifiers (`./errors.js`). `apps/web` overrides resolution to
`bundler` with `jsx: preserve`, as required by Next.js.

Consequence: platform code stays correct when it is eventually executed by Node
directly. Workspace packages expose their sources through `exports` with a
`types` condition (`./src/index.ts`); the `dist` condition is added when the
build pipeline lands.

### D-006 — Next.js 16 + React 19 for the web application

Context: `MASTER_CLINE_PROMPT.md` prefers Next.js for the public store, the
customer panel and the admin panel.

Decision: `apps/web` is a Next.js App Router project. Phase 0 contains the
application shell (`src/app/layout.tsx`) and `next.config.ts` only; routes are
intentionally deferred.

Consequence: no `src/app/page.tsx` exists yet, so the app has no user-visible
page. The first route and the Neo-Brutalist design system (`docs/DESIGN.md`,
`packages/ui`) arrive in a later phase.

### D-007 — Fastify 5 for the control plane API

Context: the API framework is not fixed by the specification. The control plane
needs schema validation, structured error handling, hooks for authentication and
authorization, and fast in-process testing.

Decision: `apps/api` uses Fastify 5 with the instance created by an exported
`buildServer()` factory (`src/server.ts`). `src/index.ts` is the process
bootstrap and is deliberately not part of the package `exports`, so importing
`@ruangnode/api` never starts a listener.

Consequence: tests and integration tests drive the API through `app.inject()`.
Route modules register their own paths; business logic belongs in
`@ruangnode/services`, never in handlers.

### D-008 — Shared error taxonomy and `Result` in `@ruangnode/shared`

Context: `.clinerules` requires structured errors that are safe for users,
detailed in server logs and free of secrets; `MASTER_CLINE_PROMPT.md` requires
typed errors with meaningful codes.

Decision: `@ruangnode/shared` exports `AppError` (code, safe message, derived
HTTP status, `retryable`, internal `cause`), the `ErrorCode` union, the
`ErrorResponseBody` envelope, `toErrorResponse()` (which maps unknown errors to
a generic 500 without leaking their message) and an explicit `Result<T, E>`
type. The API error handler is the single place that converts errors into
responses.

Consequence: every later phase returns the same error envelope; unexpected
errors cannot leak internals such as connection strings or addresses.

### D-009 — Vitest 5 with per-project configuration

Context: unit tests belong next to their code, while integration tests span
packages.

Decision: each project that owns tests has a `vitest.config.ts` with a project
name; the root `vitest.config.ts` aggregates them under `test.projects`, so
`pnpm test` runs everything from the repository root. `tests/` is a workspace
project (`@ruangnode/tests`) for cross-package integration tests.

Consequence: `pnpm test` is the single test entrypoint; a package can also run
`pnpm --filter <name> test`.

### D-010 — ESLint 10 flat config, formatting owned by Prettier

Context: lint and format responsibilities must not overlap.

Decision: `eslint.config.mjs` composes `@eslint/js` recommended plus
`typescript-eslint` recommended (non-type-checked in Phase 0), sets Node/browser
globals per directory, forbids `any`, requires `===`, prefers type-only imports
and warns on `console` outside tests. Prettier owns formatting; markdown is
ignored so the hand-written specifications and `docs/` are not rewritten.

Consequence: `pnpm lint` and `pnpm format:check` are separate gates.
Type-aware linting (`recommendedTypeChecked` with `projectService`) is deferred
until the domain code exists — see Deferred work below.

### D-011 — Package boundaries are enforced by structure

Decision: responsibilities are separated exactly as `.clinerules` requires.

| Project | Owns |
| --- | --- |
| `apps/web` | Public store, customer panel, admin panel (UI only) |
| `apps/api` | Control plane HTTP API: authenticate → authorize → validate → service → respond |
| `packages/services` | Domain services (catalog, orders, payments, provisioning, scheduling) |
| `packages/database` | PostgreSQL schema, migrations and typed client |
| `packages/auth` | Sessions, password hashing, roles, ownership guards |
| `packages/shared` | Platform primitives (results, errors, common types) |
| `packages/ui` | Neo-Brutalist design system |
| `node-agent` | The only component that talks to Docker |
| `infra` | Deployment and local infrastructure artifacts |
| `tests` | Cross-package integration tests |

Consequence: `apps/web` and `apps/api` have no Docker access by construction;
`node-agent` is the only project that will depend on the Docker runtime.

### D-012 — `.env.example` documents configuration without secrets

Decision: `.env.example` lists every environment variable the platform will
consume (runtime, web, API, PostgreSQL, sessions, Redis, payment provider, node
agent, object storage) with empty or clearly non-secret placeholder values.

Consequence: no `.env` file is created, no credential is invented, and the file
is safe to commit. `.gitignore` ignores `.env` and `.env.*` while keeping
`.env.example`.

### D-013 — Git repository initialized with no committed history

Decision: `git init` was run in the repository root; the Phase 0 files are left
uncommitted so the owner can review the first commit.

Consequence: `.gitignore` already protects secrets, dependencies and build
output before anything is committed.

### D-014 — Dependency build scripts are allow-listed

Context: pnpm blocks dependency lifecycle scripts by default, and installation
fails when a blocked build script is required.

Decision: `pnpm-workspace.yaml` sets `allowBuilds: { esbuild: true }`, because
esbuild (used by Vite/Vitest and tsx) installs its native binary from a
postinstall script. Any future entry must be justified the same way (extended in
D-025).

Consequence: no dependency can execute install-time code without an explicit,
reviewable entry in the workspace configuration.

---

## Phase 1 — Database foundation

Status: implemented. Scope: the PostgreSQL/Prisma schema, the first migration, a
development seed, the typed client factory and the tests that guard the schema.
No authentication, payments, provisioning, Node Agent or UI work is included.

Deliverables:

| Area | Artifact |
| --- | --- |
| Schema | `packages/database/prisma/schema.prisma` (19 entities, 19 enums) |
| Migration | `packages/database/prisma/migrations/20260930000000_init/` |
| Seed | `packages/database/prisma/seed.ts` (development catalog data only) |
| Client | `packages/database/src/client.ts`, `src/config.ts`, `src/index.ts` |
| CLI config | `packages/database/prisma.config.ts` |
| Tests | `packages/database/src/schema.test.ts`, `src/config.test.ts` |

### D-015 — Prisma ORM 7 with the `pg` driver adapter, schema owned by `packages/database`

Context: `README.md` sketched a root-level `prisma/` directory, while the
package boundaries in D-011 give `packages/database` full ownership of the
schema, migrations and typed client.

Decision: the schema, migrations, seed and `prisma.config.ts` live in
`packages/database`; the root `prisma/` directory from the sketch is not used.
Prisma 7 is used with the `prisma-client` generator (plain TypeScript output in
`src/generated/prisma`) and the `@prisma/adapter-pg` driver adapter, because
Prisma 7 is engine-free for queries and requires a driver adapter.

Consequence: `packages/database` owns the whole database lifecycle. Generated
client code is ignored by Git, ESLint and Prettier (`**/generated/`), and the
package `typecheck` script runs `prisma generate` first so a clean checkout can
typecheck without a manual step.

### D-016 — `User.role` is an enum; there is no `Role` table

Context: `docs/DATABASE.md` lists `Role` among the core entities, while the
role values are a fixed set (`CUSTOMER`, `SUPPORT`, `ADMIN`) and Phase 1 must
not build a permission system.

Decision: roles are modelled as the `UserRole` enum on `User.role`. No `Role`
table, no join table and no per-permission rows exist. Authorization stays
server-side (`.clinerules`: never trust role values from a client).

Consequence: adding role-based permission *grants* later requires a migration
and an explicit decision; changing the role of a user does not.

### D-017 — Money in integer minor units, bytes in bytes, CPU in millicores

Context: `docs/PAYMENTS.md` forbids floating-point money;
`docs/RESOURCE_ISOLATION.md` requires unambiguous resource units.

Decision:
- money (`ProductVariant.price`, `Order.subtotal/discount/total`,
  `OrderItem.unitPrice/totalPrice`, `Payment.amount`) is `BigInt` in integer
  minor units with an explicit ISO 4217 `currency` on every aggregate
- byte quantities (`memoryLimitBytes`, `memorySwapBytes`, `diskLimitBytes`,
  node totals/reservations/allocations, `storageQuota`) are `BigInt` bytes
- CPU is `Int` millicores (1000 = 1 CPU); PID limits are `Int`
- the schema contains no `Float` and no `Decimal`

Consequence: `BigInt` values must be converted explicitly when they cross the
API boundary as JSON; the alternative (`Int`) would overflow gigabyte and large
rupiah values. `packages/database/src/schema.test.ts` fails if a monetary or
byte column is ever narrowed.

### D-018 — Prisma CLI configuration and environment loading

Context: Prisma 7 removed `url` from the `datasource` block, no longer reads
`.env` automatically and moved seed configuration into `prisma.config.ts`.

Decision: `packages/database/prisma.config.ts` declares the schema path, the
migrations path, `seed: "tsx prisma/seed.ts"` and `datasource.url` from
`DATABASE_URL`. Environment files are loaded with Node's built-in
`process.loadEnvFile` (package `.env`, then the repository root `.env`), so no
`dotenv` dependency is added. `datasource.url` is omitted when `DATABASE_URL` is
unset, which keeps `prisma validate` and `prisma generate` usable in CI without
a database while migration and seed commands fail loudly.

Consequence: `prisma migrate diff` (and every other schema-engine command)
requires `DATABASE_URL` to be configured even when it never connects; the
migration in this repository was therefore generated with a placeholder URL.
`.env` remains the single place for local configuration (D-012).

### D-019 — Credentials are stored as an encryption envelope, never as plaintext

Context: `docs/SECURITY.md` requires secrets encrypted at rest, never returned
from list APIs and never logged.

Decision: `Credential` stores `encryptedSecret` (ciphertext) plus the envelope
parameters needed to decrypt it: `encryptionAlgorithm` (`aes-256-gcm` by
default), `encryptionKeyVersion`, `encryptionIv` and `encryptionAuthTag`.
`metadata` is documented as non-secret descriptive data only. Key material is
never stored in the database.

Consequence: the encryption/decryption service is implemented in the phase that
introduces credentials (BYOK keys). Key rotation is supported through
`encryptionKeyVersion` without a schema change.

### D-020 — Node agent credentials are hashed; node capacity reserves host overhead

Context: `docs/NODE_AGENT.md` requires an authenticated, revocable node
identity, and `docs/RESOURCE_ISOLATION.md` requires nodes to reserve host
overhead instead of handing 100% of RAM to customers.

Decision: `Node` gains `agentTokenHash` (hash of the long-lived agent
credential issued at registration; the plaintext is shown once and never
stored), plus `reservedCpuMillicores`, `reservedMemoryBytes` and
`reservedStorageBytes` (default 0), so schedulable capacity is
`total - reserved - allocated`. `NodeHeartbeat` records the heartbeat payload
documented in `docs/NODE_AGENT.md` (agent version, uptime, capacity,
allocations, runtime health, reported status).

Consequence: the scheduler has one explicit definition of available capacity,
and the Node Agent phase only has to verify the token hash.

### D-021 — Referential actions encode ownership versus history

Decision: foreign keys declare explicit actions instead of relying on defaults:
- owned children cascade: `ProductVariant → Product`, `OrderItem → Order`,
  `Payment → Order`, `SupportMessage → SupportTicket`, `InstanceDomain →
  Instance`, `NodeHeartbeat → Node`, `ProvisioningJob → Instance`,
  `Credential → User`, `Download → User`
- historical or financial references restrict: `Order`/`Subscription`/
  `Instance → User`, `OrderItem`/`Subscription`/`Instance → ProductVariant`,
  `Instance → Node`, `Instance`/`ProductVariant → ResourceProfile`,
  `Subscription → OrderItem`, `Download → Product`, `SupportTicket → User`
- optional or audit references detach: `Instance → Subscription`,
  `Credential → Instance`, `ProvisioningJob → Node`, `AuditLog → User`,
  `SupportMessage → User`

Consequence: deleting a user cannot destroy orders, instances or audit trails;
a resource profile in use cannot be deleted (it is deactivated); instances and
audit rows survive the removal of the node or user they mention.

### D-022 — Idempotency is enforced by unique constraints

Context: `docs/PROVISIONING.md` and `docs/PAYMENTS.md` require repeated webhook
delivery and repeated provisioning requests to be idempotent.

Decision: the database enforces
- `WebhookEvent @@unique([provider, externalEventId])`
- `ProvisioningJob.idempotencyKey @unique`
- `Payment @@unique([provider, providerPaymentId])`
- `Subscription @@unique([orderItemId])` (one entitlement per order item)
- `Instance @@unique([nodeId, runtimeId])` (one runtime object per instance)

Consequence: duplicate processing fails at the database instead of creating a
second instance, payment or subscription. `Instance.subscriptionId` is
deliberately *not* unique, because a replacement/migration workflow may attach a
new instance to the same subscription.

### D-023 — The first migration was generated offline and is applied by an operator

Context: no PostgreSQL server is available in this development environment, and
Prisma 7 requires a configured datasource even for `migrate diff`.

Decision: `20260930000000_init/migration.sql` was produced with
`prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`
using a placeholder `DATABASE_URL` (no connection is made), and the result was
verified twice: it is byte-identical to a fresh diff of the current schema, and
it executes cleanly against a real PostgreSQL engine, creating 19 tables, 19
enum types and 26 foreign keys and rejecting a duplicate webhook event with a
unique violation. Applying it to a real database (`prisma migrate deploy`) and
recording it in `_prisma_migrations` remains an operator step.

Consequence: the repository contains a verified, reviewable migration, but the
`_prisma_migrations` history exists only after the first `migrate deploy`.

### D-024 — The seed creates catalog data only and refuses to run in production

Decision: `prisma/seed.ts` upserts resource profiles, products and product
variants (mirroring the examples in `docs/RESOURCE_ISOLATION.md`) on their
natural keys, so it is idempotent. It contains no credentials, keys, users, node
registrations or payment data, and it throws when `NODE_ENV=production`.

Consequence: no secret can enter the repository through seed data, and
development databases can be re-seeded safely. User accounts are created by the
authentication phase, not by the seed.

### D-025 — Prisma build scripts are allow-listed (extends D-014)

Context: `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS` when a required
lifecycle script is blocked, and the Prisma CLI needs the schema/migration
engine binaries that `prisma` and `@prisma/engines` install in postinstall.

Decision: `pnpm-workspace.yaml` adds `prisma: true` and `@prisma/engines: true`
to `allowBuilds`, next to `esbuild: true`, with the reason recorded inline.

Consequence: exactly three dependencies may execute install-time code.

### D-026 — Schema invariants are enforced by tests, not by review

Context: `.clinerules` requires tests for pricing, idempotency and resource
profile application, and Phase 1 has no database to test against.

Decision: `packages/database/src/schema.test.ts` parses `schema.prisma` and
asserts the properties that must not regress: every entity exists, every primary
key is a UUIDv7, money and bytes are `BigInt`, no `Float`/`Decimal` exists, the
six state machines stay separate with the documented values, webhook /
provisioning / payment / subscription / instance uniqueness holds, every foreign
key declares a referential action, ownership columns are indexed, append-only
tables stay append-only, `ResourceProfile` describes enforceable limits and
`Credential` has no plaintext column. `src/config.test.ts` covers `DATABASE_URL`
handling, including that a connection string never appears in an error message.

Consequence: a schema change that breaks a documented invariant fails
`pnpm test` before it can reach a migration.

---

## Phase 1B — Authentication foundation

Status: implemented. Scope: real authentication on top of the Phase 1 database —
Argon2id password hashing, database-backed sessions, secure session cookies,
registration, login, logout, session lookup/revocation, password reset, RBAC and
ownership guards, rate limiting, input validation and audit events. No payments,
provisioning, scheduler, Node Agent, Docker runtime, customer dashboard or admin
UI are included.

Deliverables:

| Area | Artifact |
| --- | --- |
| Auth domain | `packages/auth/src/*` (password, tokens, sessions, auth service, authorization, rate limit, ports) |
| Persistence adapter | `packages/auth/src/adapters/prisma-auth-store.ts` |
| Schema | `Session`, `PasswordResetToken`, `SessionRevocationReason` + migration `20260930120000_auth_sessions` |
| HTTP layer | `apps/api/src/auth/*` (routes, guards, cookies, schemas, rate limiting, config) |
| Wiring | `apps/api/src/server.ts` (`AuthModuleOptions`), `apps/api/src/index.ts` (Prisma + Argon2id + config) |
| Tests | `packages/auth/src/*.test.ts`, `apps/api/src/auth/*.test.ts`, `tests/integration/auth-database.test.ts` |

### D-027 — Argon2id password hashing with `@node-rs/argon2`

Context: `docs/SECURITY.md` requires secure password hashing and the task
requires Argon2id specifically. The alternative package (`argon2`) needs a native
build or a prebuild download step during install, which the workspace policy
(D-014/D-025) treats as a supply-chain decision.

Decision: passwords are hashed with Argon2id through `@node-rs/argon2`, which
ships prebuilt N-API binaries and runs no install-time code. Parameters follow the
OWASP recommendation: `m=19456 KiB` (19 MiB), `t=2`, `p=1`, 32-byte output,
Argon2 v19. The algorithm is not passed as an option because the library exposes it
as an ambient `const enum`, which cannot be imported under `isolatedModules`; the
tests assert the exact PHC prefix `$argon2id$v=19$m=19456,t=2,p=1$` instead, so a
silent algorithm change cannot pass unnoticed.

Consequence: `password.test.ts` covers the parameters, verification, salting,
fail-closed behaviour on malformed hashes and `needsRehash`. Login transparently
re-hashes a stored hash that was produced with outdated parameters, so the cost
can be raised later without invalidating existing credentials.

### D-028 — Sessions are database rows; only token hashes are stored

Context: sessions must be revocable from the database, and the task forbids
storing or returning session secrets.

Decision: a session is a `Session` row with `tokenHash` (SHA-256 of the token),
`expiresAt`, `lastUsedAt`, `revokedAt`/`revokedReason` and request metadata. The
plaintext token exists only in the client cookie. Every authenticated request
resolves the session from the database, so revocation is immediate and never
depends on client state. `lastUsedAt` is refreshed at most once per throttle
window (5 minutes) to avoid a write per request. A session whose account is no
longer `ACTIVE` is rejected *and* revoked.

Consequence: `Session.tokenHash` is unique, so a token maps to exactly one
session; expired and revoked rows are kept as an audit trail.

### D-029 — Session cookies are hardened and tokens never travel in URLs

Decision: the session cookie is `httpOnly`, `secure` outside development,
`sameSite=lax`, `path=/`, HMAC-signed with `SESSION_SECRET` and named
`__Host-ruangnode_session` whenever it is `Secure` (the prefix makes browsers
reject a cookie set from a subdomain). The token is read only from the cookie:
never from a query string, a header or a request body. A tampered cookie fails
signature verification and is rejected before the database is consulted.
`Cache-Control: no-store` is set on every authentication response.

Consequence: an XSS bug cannot read the session token, a CSRF POST from another
site is blocked, and tokens cannot leak through referrers or logs.

### D-030 — Email addresses are normalized in the application

Context: `User.email` is unique with a case-sensitive comparison, and the Phase 1
notes left the question open.

Decision: `normalizeEmail()` (trim + lower-case) is applied in the domain service
before every lookup and write, and `isValidEmail()` performs a conservative
structural check. No `citext` extension and no functional index is introduced.

Consequence: `Ada@Example.com` and `ada@example.com` cannot become two accounts,
the rule lives in one place, and the database stays portable.

### D-031 — Authentication services depend on ports, not on Prisma

Decision: `packages/auth` defines `AuthStore` (users, sessions, password resets,
audit) plus `PasswordHasher`, `PasswordResetNotifier` and `Clock` as interfaces.
`createPrismaAuthStore()` is the production adapter and the only module that knows
about Prisma; `@ruangnode/auth/testing` provides an in-memory implementation and a
deterministic clock. `AuthStore.transaction()` runs the password-reset
confirmation atomically (claim the token, replace the hash, revoke sessions).

Consequence: the API, the unit tests and the integration tests exercise the same
service code. The API tests drive the real Fastify instance with the in-memory
store; the integration tests drive it with the Prisma store against a real
PostgreSQL engine.

### D-032 — Password reset: single-use, expiring, non-disclosing

Decision:
- a request always answers `202` with the same body, whether or not the account
  exists (`accountFound` is recorded in the audit log only)
- tokens are 256-bit random values; only the SHA-256 hash is stored
- a token expires after 60 minutes (`PASSWORD_RESET_TTL_MINUTES`) and is consumed
  by a conditional update (`usedAt IS NULL AND expiresAt > now`), which is the
  single-use guard
- a new request invalidates outstanding tokens for that account
- confirmation replaces the hash and revokes every session in one transaction, so
  the user must sign in again
- delivery goes through the `PasswordResetNotifier` port; the API wires
  `NullPasswordResetNotifier` because transactional email is a later phase, and
  tests wire the capturing notifier. No implementation may log the token, and the
  token is never returned by an API

Consequence: the flow is complete and testable end-to-end without pretending that
an email was sent; wiring the email adapter is a later, isolated change.

### D-033 — RBAC and ownership are decided server-side

Decision: roles come from `User.role` (`CUSTOMER`, `SUPPORT`, `ADMIN`) and are
never accepted from a request body — registration always creates a `CUSTOMER`.
`packages/auth/src/authorization.ts` holds the pure policy; Fastify guards
(`requireAuth`, `requireRole`, `requireOwnership`) only translate the outcome into
a response. A resource that belongs to another customer is reported as **404** so
the API cannot be used to enumerate other tenants' resources; a *role* failure is a
**403**. SUPPORT access to a resource type is opt-in per guard (`allowSupport`),
and an inactive account is refused even with the right role.

Consequence: every customer-owned route is written as
`[requireAuth, requireOwnership(loadOwnerId)]`, and the ownership check uses an
identifier from the URL (never from the body) resolved server-side.

### D-034 — Rate limiting is in-process until Redis is justified

Decision: login, registration, password-reset request and password-reset
confirmation are rate limited by a sliding-window limiter in `@ruangnode/auth`.
Login and reset are limited twice: per client address and per hashed account
identifier (the raw email is hashed, so limiter state holds no personal data).
Denials return `429` with `Retry-After` through the shared error envelope. The
clock is injected so window behaviour is deterministic in tests.

Consequence: the limiter is per-process and resets on restart; it must be replaced
with a shared store before the API is scaled horizontally. This limitation is
recorded here rather than silently accepted.

### D-035 — Validation stays at the boundary and in the domain, with no new dependency

Decision: route inputs are validated by Fastify's AJV schemas
(`apps/api/src/auth/schemas.ts`), which is the validation mechanism the API
already uses; the domain services re-validate independently so they stay safe when
called outside HTTP. Fastify's default `removeAdditional` behaviour strips fields
that are not in the schema, so a smuggled `role` cannot reach a service. Response
schemas are declared as well: Fastify serialises through them, so a field that is
not listed (for example a password hash added to a projection) can never reach a
client. Validation failures are mapped onto the shared `VALIDATION_FAILED` (422)
envelope with field *names* only — never submitted values.

Consequence: no schema-validation library is added, and the API contract is
enforced on both the request and the response side.

### D-036 — Authentication audit events, with secrets rejected at the boundary

Decision: registration, successful and failed logins, logout, session revocation,
"revoke all other sessions", password-reset request, completion and rejection are
recorded in `AuditLog` with stable action names (`auth.*`). Failure reasons are
recorded in metadata (`UNKNOWN_ACCOUNT`, `INVALID_PASSWORD`, `ACCOUNT_NOT_ACTIVE`,
`EXPIRED`, `ALREADY_USED`, …) while the client always receives one generic error.
`assertAuditMetadataIsSafe()` rejects any metadata key that looks like a secret
(password, token, secret, hash, credential, key) at write time, in both store
implementations.

Consequence: the audit trail explains failures that the API deliberately hides, and
a programming mistake that tries to persist a secret fails loudly in tests instead
of silently leaking.

<!-- phase1b-append -->

### D-037 — Sessions and password-reset tokens are separate tables

Context: `docs/DATABASE.md` lists the core entities but has no table for sessions
or reset tokens, while Phase 1B requires database-backed sessions and single-use
reset tokens.

Decision: migration `20260930120000_auth_sessions` adds `Session`,
`PasswordResetToken` and the `SessionRevocationReason` enum, both cascading from
`User` and both storing only token hashes. The schema invariant tests in
`packages/database/src/schema.test.ts` cover them.

Consequence: session and reset state stay out of `User` and out of JSON columns,
and the tables can be pruned independently (indexes on `expiresAt`).

### D-038 — Authentication configuration is environment-driven and fails fast

Decision: `authConfigFromEnv()` reads `SESSION_SECRET` (required, at least 32
characters), `NODE_ENV`, `SESSION_COOKIE_SECURE`, `SESSION_TTL_HOURS`,
`PASSWORD_RESET_TTL_MINUTES` and `WEB_APP_URL`. Invalid values throw instead of
silently defaulting, and no error message ever contains the secret value. The
process entrypoint (`apps/api/src/index.ts`) resolves the database client, the
Prisma store, the Argon2id hasher and this configuration *before* listening, so a
misconfigured deployment cannot start without working authentication.
`buildServer()` without an authentication module registers no auth routes and logs
a warning — the entrypoint always provides one, and the health endpoint stays
available for diagnostics.

Consequence: `pnpm --filter @ruangnode/api start` requires `DATABASE_URL` and
`SESSION_SECRET`; `.env.example` documents all of them.

### D-039 — Cross-package tests run against an embedded PostgreSQL

Context: `.clinerules` requires tests for authorization, ownership, session
revocation and tenant isolation, but no PostgreSQL server is available in this
environment and Docker is not installed.

Decision: `tests/support/embedded-postgres.ts` starts PGlite (PostgreSQL compiled
to WebAssembly) with its PostgreSQL wire-protocol socket server and applies the
committed migrations. `tests/integration/auth-database.test.ts` then drives the real
Prisma store, the real Argon2id hasher and the real Fastify instance over HTTP.
PGlite accepts a single connection, so two overlapping transactions are not
possible; the concurrency guarantee is therefore asserted through the conditional
claim itself, and the test file documents this limitation.

Consequence: the persistence path, the migrations, the unique constraints and the
audit writes are verified for real in CI without an external service. Verification
against a multi-connection PostgreSQL server (concurrent transactions, connection
pooling) remains an operator/CI task.

### D-040 — Secret exposure is a tested property, not a convention

Decision: the suite asserts that
- no response body ever contains a password, a session token, a reset token or a
  `passwordHash` field (`packages/auth` and `apps/api` tests, plus the integration
  test)
- the Fastify log output of a full authentication flow contains none of those
  values (asserted against a capturing log stream)
- neither store contains a plaintext token
- audit rows contain no secrets

Consequence: a regression that starts returning or logging a secret fails the build
rather than being caught in review.

---

## Open questions after Phase 1B

Still open, and deliberately not invented:

- Password-reset email delivery: the `PasswordResetNotifier` port exists and the
  API wires the null implementation, so reset links are generated but not sent.
- Password change for a signed-in user (current password required) is not
  implemented; only the reset flow changes a password.
- E-mail verification on registration and MFA (`docs/SECURITY.md` calls MFA
  optional architecture) are not implemented.
- CSRF tokens: `sameSite=lax` covers the documented state-changing POSTs, but a
  double-submit or origin-check strategy is not implemented yet.
- `docs/API.md` documents a `requestId` field in responses; the current envelope
  (`@ruangnode/shared`, Phase 0) does not include it.
- Rate limiting is per-process (D-034) and must move to a shared store before
  horizontal scaling.
- Concurrency verification against a multi-connection PostgreSQL server (D-039).
- Admin/support user management (creating SUPPORT/ADMIN accounts, suspending
  accounts) has no API yet; roles are only changeable through the database.

## Open database questions (not resolved in Phase 1)

Each of these needs a decision in the phase that implements it, rather than an
invented column now.

- Refunds: `docs/PAYMENTS.md` requires a refund *record*, but `Refund` is not in
  the `docs/DATABASE.md` entity list, so only `PaymentStatus.REFUNDED` exists
  today.
- Node capability advertisement (which service types a node supports) is not in
  `docs/DATABASE.md`; the scheduler needs it before provisioning can select
  nodes.
- Provisioning job leases/locks (`docs/PROVISIONING.md` → "Concurrency") are
  represented by the unique idempotency key only; lease columns are not added
  yet.
- Subscription billing policy (grace period, suspension behaviour, deletion
  retention) is not modelled; only period start/end and `cancelAtPeriodEnd`
  exist.
- `Download` is not linked to the order/order item that entitled it; that
  authorization check is still open.
- E-mail uniqueness is case-sensitive at the database level; normalization is
  resolved in the application (see D-030).
- Retention/pruning of `NodeHeartbeat`, `WebhookEvent` and `AuditLog` rows is an
  operational decision that needs a documented policy.
- `User.externalAuthProvider` / `externalAuthSubject` are provisioned for
  external identity, but the authentication phase must confirm the shape.

## Deferred work

Updated after Phase 1B: the database foundation (Phase 1) and the authentication
foundation (Phase 1B) are implemented. Still deferred:

- Commerce, payments and provider adapters (`packages/services`).
- Provisioning, scheduling, instance lifecycle and Node Agent runtime.
- Docker runtime integration and resource-limit enforcement.
- Web routes, design tokens and components (`packages/ui`, `apps/web`).
- Password-reset email delivery and the transactional email adapter (D-032).
- Applying the migrations to a real database (`prisma migrate deploy`) and
  creating the `_prisma_migrations` history — an operator step (D-023).
- Build pipeline (`dist` outputs and additional `exports` conditions),
  Dockerfiles and `docker-compose.dev.yml`.
- Type-aware ESLint rules and coverage thresholds.
- Structured logging and request-id propagation (`pino` is currently used only
  through Fastify's built-in logger).
- Redis usage: only once asynchronous jobs, queues, rate limiting or transient
  state genuinely require it (a shared rate-limit store is the first candidate,
  see D-034).

## How to run

```bash
corepack enable pnpm        # or use: npx pnpm@12.8.1
pnpm install
pnpm typecheck              # root config files + every workspace project
pnpm lint
pnpm test                   # shared, database, API and integration tests
pnpm format:check
```

Database and authentication commands:

```bash
cp .env.example .env                          # set DATABASE_URL and SESSION_SECRET
pnpm --filter @ruangnode/database prisma:validate
pnpm --filter @ruangnode/database prisma:generate
pnpm --filter @ruangnode/database migrate:deploy
pnpm --filter @ruangnode/database db:seed
pnpm --filter @ruangnode/api start             # requires DATABASE_URL + SESSION_SECRET
```

Run a single project's checks with a filter:

```bash
pnpm --filter @ruangnode/api typecheck
pnpm --filter @ruangnode/auth test
pnpm --filter @ruangnode/database test
```
