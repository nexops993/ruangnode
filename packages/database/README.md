# @ruangnode/database

PostgreSQL schema, migrations, development seed and the typed client for the
RuangNode control plane.

**Boundary:** no other package talks to the database directly. The web
application and the Node Agent never import this package's client; they reach
the database only through the control plane API (`docs/ARCHITECTURE.md`,
`.clinerules`).

```text
packages/database/
├── prisma.config.ts        # Prisma CLI configuration (Prisma 7)
├── prisma/
│   ├── schema.prisma       # the schema — source of truth: docs/DATABASE.md
│   ├── migrations/         # migration history
│   └── seed.ts             # development seed (catalog data only)
├── src/
│   ├── client.ts           # createDatabaseClient() — pg driver adapter
│   ├── config.ts           # .env loading and DATABASE_URL handling
│   ├── index.ts            # package entrypoint
│   ├── schema.test.ts      # schema invariants (no database required)
│   └── generated/prisma/   # generated Prisma Client (git-ignored)
└── vitest.config.ts
```

## Commands

```bash
cp .env.example .env                 # set DATABASE_URL first
pnpm --filter @ruangnode/database prisma:validate   # validate the schema
pnpm --filter @ruangnode/database prisma:generate   # generate the client
pnpm --filter @ruangnode/database migrate:dev       # create/apply a migration (dev)
pnpm --filter @ruangnode/database migrate:deploy    # apply migrations (all envs)
pnpm --filter @ruangnode/database migrate:status    # migration state
pnpm --filter @ruangnode/database db:seed           # development seed
pnpm --filter @ruangnode/database typecheck
pnpm --filter @ruangnode/database test
```

`prisma generate` runs automatically as part of the package `typecheck`, so a
fresh checkout typechecks without a manual step. `prisma validate` and
`prisma generate` work without `DATABASE_URL`; migration and seed commands need
it (see D-018 in `docs/DECISIONS.md`).

## Conventions

- Primary keys are UUIDv7 (`@default(uuid(7)) @db.Uuid`), never
  customer-supplied strings.
- Money is `BigInt` in integer minor units with an explicit ISO 4217 `currency`.
  No `Float`, no `Decimal`.
- Bytes (memory, disk, storage quotas) are `BigInt`; CPU is `Int` millicores;
  PID limits are `Int`.
- Order, payment, subscription, provisioning, instance and node states are
  separate enums. They are never merged into one status column.
- Secrets are stored only in `Credential`, as an encrypted envelope
  (`encryptedSecret` + algorithm/key version/IV/auth tag). JSON columns never
  hold secrets or authorization state.
- Foreign keys always declare an explicit referential action: owned children
  cascade, financial/historical references restrict, optional references detach.
- Unique constraints carry the business invariants: webhook
  (`provider`, `externalEventId`), provisioning `idempotencyKey`, payment
  (`provider`, `providerPaymentId`), subscription per order item, instance per
  (`nodeId`, `runtimeId`).

## Changing the schema

1. Edit `prisma/schema.prisma` and describe the change in `docs/DECISIONS.md`.
2. Update `src/schema.test.ts` if the change affects a documented invariant.
3. Generate the migration SQL (no database required):

   ```bash
   DATABASE_URL='postgresql://placeholder:placeholder@localhost:5432/placeholder' \
     pnpm --filter @ruangnode/database exec prisma migrate diff \
     --from-empty --to-schema prisma/schema.prisma --script
   ```

   For an incremental change, diff from the existing migrations instead
   (`--from-migrations prisma/migrations`, which needs a shadow database).
4. Validate: `prisma:validate`, `pnpm typecheck`, `pnpm lint`, `pnpm test`.

## Verification status

- `prisma validate` passes; the migration SQL is byte-identical to a fresh diff
  of the schema.
- The migration SQL was executed against a real PostgreSQL engine (embedded
  PostgreSQL): 19 tables, 19 enum types, 26 foreign keys, `BIGINT` columns
  preserve exact values and a duplicate `(provider, externalEventId)` webhook
  event is rejected by the unique index.
- Not yet verified in this environment: applying the migration through
  `prisma migrate deploy` against a live server and running the seed end-to-end,
  because no PostgreSQL server is available here (D-023).
