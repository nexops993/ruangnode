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

Deployable Dockerfiles and a local Compose stack are present. Compose runs
PostgreSQL, the control-plane API, the web app, and a Node Agent. The agent is
the only service mounting the host Docker socket.

Database migrations and seeding are run from the owning package, not from here:

```bash
pnpm --filter @ruangnode/database migrate:deploy
pnpm --filter @ruangnode/database db:seed
```

The Compose API and Node Agent require `NODE_AGENT_TOKEN` in the root `.env`.
The value is passed to the API as `NODE_AGENT_TOKEN` and to the agent as its
shared secret. Docker integration tests remain separate from unit tests:

```bash
corepack pnpm --filter @ruangnode/node-agent test
RUN_DOCKER_INTEGRATION=1 corepack pnpm --filter @ruangnode/node-agent test:integration
```
