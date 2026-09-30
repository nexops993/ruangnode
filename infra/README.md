# Infrastructure

Deployment and local-development infrastructure for RuangNode.

```text
infra/
├── docker/    # Dockerfiles, Docker Compose, reverse-proxy and node configs
└── scripts/   # operational scripts (migrations, seeds, backups, checks)
```

## Boundaries

- The web application, API and Node Agent are deployed as separate services.
- PostgreSQL, Redis (when introduced) and internal control ports are never
  exposed to the public internet.
- The Docker socket is reachable only by the Node Agent on its own node. The
  web application and the control plane API never talk to Docker.
- No credentials, tokens or private keys are stored in this directory. Use
  environment variables or a secret manager, and keep local state in
  `infra/local/` (git-ignored).

## Current status

Phase 0 established the workspace. Phase 1 added the database foundation in
`packages/database` (schema, migrations, development seed). This directory
still contains no deployable artifacts; the following are added in later phases:

- `infra/docker/Dockerfile.web`, `Dockerfile.api`, `Dockerfile.node-agent`
- `infra/docker/docker-compose.dev.yml` (PostgreSQL, Redis when needed)
- `infra/scripts/` health-check and backup entrypoints

Database migrations and seeding are run from the owning package, not from here:

```bash
pnpm --filter @ruangnode/database migrate:deploy
pnpm --filter @ruangnode/database db:seed
```
