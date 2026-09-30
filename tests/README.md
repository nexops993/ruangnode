# Tests

Cross-package integration tests for RuangNode.

```text
tests/
├── integration/   # tests that exercise more than one workspace package
├── package.json   # @ruangnode/tests workspace project
└── vitest.config.ts
```

## Conventions

- Unit tests live next to the code they cover (`src/**/*.test.ts` inside the
  package) and are run by that package's Vitest project.
- Integration tests live here and may import several workspace packages, for
  example `@ruangnode/api` together with `@ruangnode/auth`.
- `pnpm test` at the repository root runs every project registered in the root
  `vitest.config.ts`.

## Database-backed tests

`tests/support/embedded-postgres.ts` starts PGlite (PostgreSQL compiled to
WebAssembly) with its PostgreSQL wire-protocol socket server and applies the
committed migrations from `packages/database/prisma/migrations`. That lets
`tests/integration/auth-database.test.ts` exercise the real Prisma client, the
real constraints and the real HTTP layer without an external database service.

Limitations of the embedded server (see `docs/DECISIONS.md`, D-039): a single
connection, so two overlapping transactions are not possible; concurrency against
a multi-connection PostgreSQL server still has to be verified in CI/operations.

## Required coverage (see .clinerules)

Later phases must add tests for pricing/order calculations, webhook signature
verification, provisioning idempotency and resource profile application.
Authentication, session revocation, authorization, ownership and tenant isolation
are covered by `tests/integration/auth-database.test.ts` together with the unit
tests in `packages/auth` and `apps/api`.
