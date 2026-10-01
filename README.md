# RuangNode

RuangNode is a TypeScript monorepo for a digital-product marketplace and a
managed application hosting control plane. Customers can browse products,
create orders, authenticate through session cookies, and operate managed
instances through the API and web interface. The longer-term product vision
also includes subscriptions, provider-backed payments, multiple nodes, and
managed services such as Hermes Agent; those areas are not all implemented yet.

The repository is **not production-ready by default**. Docker runtime behavior
requires a Docker Engine, deployment requires real secrets and PostgreSQL, and
several documented product surfaces remain planned work.

## Current status

### Implemented

- pnpm workspace with TypeScript packages and applications.
- Fastify API with schema validation, structured error responses, health check,
     authentication, sessions, password reset flow, roles, and ownership guards.
- Catalog, product variants, resource profiles, orders, payment abstractions,
     and payment webhook service boundaries backed by Prisma repositories.
- PostgreSQL schema, committed Prisma migrations, seed support, and generated
     Prisma client workflow.
- Customer instance listing and lifecycle operations: start, stop, restart,
     metrics, logs, deletion, and provisioning request handling.
- Node Agent HTTP transport with bearer authentication, Docker adapter,
     idempotent creation, container discovery after agent restart, and runtime
     inspection.
- Docker resource configuration for CPU quota, memory, swap policy, PID limit,
     private per-instance network, capability dropping, and read-only rootfs.
- Persisted provisioning reconciliation on API startup. It aligns database
     instance status with an agent inspection and marks unrecoverable jobs failed.
- Minimal Next.js web page for authenticated instance operations.

### Planned or incomplete

- Production payment provider integration, subscription billing, refunds, and
     wallet/ledger behavior.
- Node registration from the agent, heartbeat reporting, capacity reporting,
     automatic node draining, and fleet-wide reconciliation endpoints.
- File management, console sessions, custom domains, service-specific health
     checks, persistent storage orchestration, and encrypted credential workflows.
- Complete public store, customer panel, and admin panel experiences. The web
     app currently contains a minimal instance dashboard.
- Hermes Agent or another managed-service adapter as a complete product.
- Production TLS/reverse-proxy configuration, observability, backup/restore
     procedures, and VPS hardening.

The detailed product and architecture plans are in [PRD.md](PRD.md) and
[ARCHITECTURE.md](ARCHITECTURE.md). Planned API surfaces in [docs/API.md](docs/API.md)
must not be interpreted as implemented endpoints unless they are present in
the current API source.

## Architecture

```text
Browser
     |
     v
Next.js web app  ----->  Fastify control-plane API  ----->  PostgreSQL
                                                                                     |
                                                                                     +---- commerce and auth services
                                                                                     +---- scheduler/provisioning/reconciler
                                                                                     |
                                                                  authenticated HTTP
                                                                                     |
                                                                  Node Agent on a node
                                                                                     |
                                                                           Docker Engine
```

The control plane owns business state. The Node Agent is the only component
intended to talk to Docker. The API stores instance and provisioning state in
PostgreSQL and reconciles runtime observations back into that state. Customer
requests are authorized by account ownership or server-side role checks.

### Technology actually used

- Node.js `>=22.12.0` and pnpm `>=12` through Corepack.
- TypeScript, ESLint, Prettier, and Vitest.
- Fastify for the API.
- Next.js 16, React 19, and React DOM 19 for the web app.
- Prisma 7 with PostgreSQL and `@prisma/adapter-pg`.
- Argon2id via `@node-rs/argon2` for password hashing.
- `dockerode` for the Node Agent Docker adapter.
- PGlite socket integration tests for database adapter coverage without an
     external PostgreSQL service.

## Repository layout

```text
apps/
     api/                 Fastify control-plane API
     web/                 Next.js web application
packages/
     auth/                Authentication, sessions, authorization primitives
     database/            Prisma schema, migrations, seed, database client
     services/            Catalog, orders, payments, infrastructure services
     shared/              Shared contracts and utilities
     ui/                  Shared UI package
node-agent/            Trusted Docker runtime service and HTTP transport
infra/
     docker/              Dockerfiles and local Compose stack
     scripts/             Migration and health-check scripts
tests/                 Cross-package PostgreSQL integration tests
docs/                  Architecture, API, security, deployment, and operations
```

The Prisma source of truth is `packages/database/prisma/`; there is no
root-level Prisma directory.

## Requirements

- Node.js `22.12+`.
- Corepack enabled with pnpm `12.8.1` or a compatible pnpm `12` release.
- PostgreSQL for running the API and applying migrations.
- Docker Engine only for Node Agent runtime use, Docker Compose deployment, or
     the opt-in Docker integration test.
- A POSIX shell is required for the scripts under `infra/scripts/`; the main
     pnpm commands also work from Windows PowerShell when invoked with Corepack.

## Local setup

From PowerShell on Windows:

```powershell
Set-Location D:\ruangnode
corepack enable
corepack pnpm install
Copy-Item .env.example .env
```

From a Unix-like shell:

```bash
cd /path/to/ruangnode
corepack enable
corepack pnpm install
cp .env.example .env
```

Set at least `DATABASE_URL` and a 32-character-or-longer `SESSION_SECRET` in
`.env`. To enable infrastructure routes, set `NODE_AGENT_URL` and
`NODE_AGENT_TOKEN` together. The package-local `.env.example` files document
API, web, and Node Agent-specific values; runtime configuration is still
expected to come from the deployment environment or a secret manager.

## Database and Prisma

The database package owns the schema and migrations. With PostgreSQL available
and `DATABASE_URL` set:

```bash
corepack pnpm --filter @ruangnode/database prisma:validate
corepack pnpm --filter @ruangnode/database migrate:deploy
corepack pnpm --filter @ruangnode/database db:seed
```

Other available database commands are `prisma:generate`, `prisma:format`,
`migrate:dev`, `migrate:status`, and `migrate:diff`. The seed is development
data and should not be treated as a production provisioning step.

## Development commands

The root scripts are defined in [package.json](package.json):

```bash
corepack pnpm test
corepack pnpm test:watch
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format:check
```

Run the API and web development servers in separate terminals:

```bash
corepack pnpm --dir apps/api dev
corepack pnpm --dir apps/web dev
```

The API defaults to `http://localhost:3001`, and the web app defaults to
`http://localhost:3000`. The API process requires a usable database and
authentication environment. There is no root `dev` script.

For a production web build:

```bash
corepack pnpm --dir apps/web build
corepack pnpm --dir apps/web start
```

The API production command is `corepack pnpm --dir apps/api start`.

## API and instance lifecycle

The implemented API is mounted below `/api/v1`. It includes authentication and
session routes, public catalog reads, admin product/variant/resource-profile
management, customer orders and payments, payment webhooks, and the current
instance/node routes. The exact implemented route handlers are in
`apps/api/src`; the broader contract and planned surfaces are documented in
[docs/API.md](docs/API.md).

Managed instance requests follow this boundary:

1. The API verifies authentication, ownership, order/payment eligibility, and
      resource requirements.
2. `NodeScheduler` selects an online node with a fresh heartbeat and enough
      available capacity.
3. `ProvisioningService` creates an idempotent database job and instance.
4. The API calls the authenticated Node Agent over HTTP.
5. The Node Agent creates and starts a Docker container, then returns an
      inspection result.
6. `InfrastructureReconciler` checks persisted jobs and instance state again
      when the API starts.

The Docker adapter currently applies CPU, memory, swap, PID, network, and
container security settings. Disk policy is represented in the configuration,
but a hard disk quota must not be assumed unless the node storage strategy
actually enforces it.

## Node Agent and Docker

Run the agent directly on a trusted Docker host with a shared secret:

```bash
corepack pnpm --dir node-agent exec tsx src/main.ts
```

`NODE_AGENT_SHARED_SECRET` must be at least 32 characters. `GET /health` is
public; runtime endpoints under `/v1/instances` require
`Authorization: Bearer <secret>`. The agent supports create, inspect, start,
stop, restart, delete, metrics, and logs operations. It does not expose an
arbitrary host shell.

Docker integration is intentionally separate from unit tests:

```bash
corepack pnpm --filter @ruangnode/node-agent test
RUN_DOCKER_INTEGRATION=1 corepack pnpm --filter @ruangnode/node-agent test:integration
```

The integration command must be run on a host with a reachable Docker Engine.
It is not evidence that Docker works on a machine where the command is left in
its default opt-out mode.

## Compose and deployment

The local Compose file runs PostgreSQL, API, web, and one Node Agent. It mounts
the host Docker socket into the Node Agent only. Set `NODE_AGENT_TOKEN` in the
root `.env` before starting it:

```bash
docker compose -f infra/docker/docker-compose.yml up -d --build
```

This stack is a local/trusted-host example, not a complete production setup.
For VPS deployment, use the procedures in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md),
the environment reference in [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md), and
the operational guidance in [docs/OPERATIONS.md](docs/OPERATIONS.md). Put a TLS
reverse proxy in front of public services, keep PostgreSQL and Docker private,
and run the Node Agent on the host that owns the Docker Engine.

## Testing status and limitations

The repository contains unit tests for authentication, commerce, services,
Node Agent transport/Docker configuration, reconciliation, and lifecycle
behavior. Cross-package database tests use PGlite and committed migrations.

The Docker integration test is opt-in and cannot be considered verified unless
`RUN_DOCKER_INTEGRATION=1` is used on a host with Docker Engine. No VPS,
production reverse proxy, real payment provider, TLS setup, or production
backup/restore procedure is verified by the local test suite.

## Security and GitHub preparation

- `.env` files are ignored; only `.env.example` templates are intended to be
     tracked.
- Dependencies, Prisma generated output, build output, logs, coverage, local
     infrastructure state, keys, certificates, and other local artifacts are
     ignored by [`.gitignore`](.gitignore).
- Never add database passwords, session secrets, payment credentials, agent
     tokens, private keys, or customer credentials to Git.
- Never expose the Docker socket or the Node Agent publicly without a deliberate
     authenticated and TLS-protected deployment boundary.
- Review `git status` and `git diff --check` before creating a GitHub commit.

This repository is ready for a user-reviewed GitHub upload, but this task does
not create a commit or push anything.

## Further documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — system boundaries and future architecture
- [PRD.md](PRD.md) — product requirements and roadmap
- [docs/API.md](docs/API.md) — API contract and planned surfaces
- [docs/DATABASE.md](docs/DATABASE.md) — database model and invariants
- [docs/NODE_AGENT.md](docs/NODE_AGENT.md) — agent boundary and Docker policy
- [docs/PROVISIONING.md](docs/PROVISIONING.md) — provisioning lifecycle and recovery
- [docs/PAYMENTS.md](docs/PAYMENTS.md) — payment provider abstraction and security
- [docs/SECURITY.md](docs/SECURITY.md) — tenant, secret, network, and runtime security
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — deployment commands and boundaries
- [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) — environment variables and examples
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — operational checks and procedures
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — common setup problems
