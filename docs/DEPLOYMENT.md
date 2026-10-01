# Deployment

This repository is structured as a monorepo and is intended to be deployed as separate runtime units:

- control-plane API in `apps/api`
- public/customer/admin web app in `apps/web`
- PostgreSQL database in `packages/database`
- node agent in `node-agent`
- optional reverse proxy and Docker runtime on infrastructure nodes

The examples in this document follow the repository’s actual layout and intentionally avoid real secrets.

## Prerequisites

- Node.js 22.12+
- Corepack enabled
- PostgreSQL 16+ accessible from the API runtime
- Docker available for node agent infrastructure
- a reverse proxy such as Caddy or Nginx for TLS termination

Install the workspace dependencies:

```bash
cd D:/ruangnode
corepack enable pnpm
corepack pnpm install
```

If `pnpm` is still not on PATH in your shell, use the explicit Corepack form throughout:

```bash
corepack pnpm <command>
```

## Database deployment

The database is owned by `packages/database` and uses Prisma migrations.

Create or update the root environment file before running Prisma:

```bash
cp .env.example .env
```

Then set the real value for `DATABASE_URL` and run:

```bash
corepack pnpm --filter @ruangnode/database run prisma:validate
corepack pnpm --filter @ruangnode/database run migrate:deploy
corepack pnpm --filter @ruangnode/database run db:seed
```

The repository is designed to use a single root `.env` for local development and deployment. Do not commit real credentials.

## API deployment

The API is the control plane and uses the environment described in `apps/api/.env.example`.

```bash
cp apps/api/.env.example apps/api/.env
```

Then populate at least:

- `DATABASE_URL`
- `SESSION_SECRET`
- `WEB_APP_URL`
- `API_PUBLIC_URL`
- `NODE_AGENT_URL` and `NODE_AGENT_TOKEN` when infrastructure lifecycle is enabled

Start the service:

```bash
corepack pnpm --dir apps/api start
```

Production health checks use the API’s liveness endpoint:

```bash
curl http://localhost:3001/health
```

## Web deployment

The web application uses the values from `apps/web/.env.example`.

```bash
cp apps/web/.env.example apps/web/.env
```

Production build and runtime:

```bash
corepack pnpm --dir apps/web build
corepack pnpm --dir apps/web start
```

The web app should be placed behind a reverse proxy and should not directly reach the Docker control plane.

## Node agent deployment

The `node-agent` package is the only component that talks to Docker. The intended runtime configuration is documented in `node-agent/.env.example`.

Example startup sequence:

```bash
cp node-agent/.env.example node-agent/.env
corepack pnpm --dir node-agent exec tsx src/main.ts
```

The production deployment should:

- bind only to the node’s private network interface or a trusted agent port
- use mTLS or a shared secret for control-plane authentication
- keep Docker access limited to the agent service
- expose only the required health and runtime endpoints

## Docker Compose example

A minimal local deployment can be started from `infra/docker/docker-compose.yml`:

```bash
cd D:/ruangnode
docker compose -f infra/docker/docker-compose.yml up -d --build
```

The Compose file runs PostgreSQL, API, web, and one local Node Agent. It
requires `NODE_AGENT_TOKEN` in the root `.env`; the agent mounts the host
Docker socket and is therefore suitable only for a trusted development host.
For a VPS deployment, run the Node Agent on the node that owns Docker and
allow the API to reach its private `NODE_AGENT_URL`.

## Reverse proxy guidance

Use Caddy or Nginx in front of the API and web app.

Recommended public flow:

- `https://ruangnode.example` → web app
- `https://api.ruangnode.example` → API
- `https://agent.ruangnode.example` → node agent endpoint
- customer instance domains → reverse proxy / routing metadata configured separately

The proxy should terminate TLS, forward real client addresses with `X-Forwarded-For`, and enforce the platform’s security headers.

## Rollback guidance

1. Stop the process or service currently serving the target stack.
2. Restore the previous environment file or secret source.
3. Re-run Prisma migrations only if the expected rollback is safe and explicit.
4. Redeploy the previous Docker image or git revision.
5. Validate `/health` and the critical service endpoints before re-enabling traffic.

## Service health checks

- API: `GET /health`
- Web: `GET /` plus render health checks in the hosting layer
- Postgres: direct connection check with `psql` or a container health probe
- Node agent: dedicated health endpoint (implementation-specific)

## Deployment boundaries

The control plane owns business state. The node agent owns runtime execution. The API must never directly manipulate Docker.

This separation is a deployment constraint and a security requirement.
