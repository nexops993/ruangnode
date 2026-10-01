# Operations

This document describes the operational routines for the control plane, the web app and the node agent in the current repository.

## Service health

The repository exposes a minimal liveness endpoint in `apps/api/src/routes/health.ts`:

```bash
curl http://localhost:3001/health
```

Expected success response:

```json
{ "status": "ok", "service": "ruangnode-api", "uptimeSeconds": 42 }
```

For the web app, verify the root page renders and the hosting layer reports the app as healthy.

## Database checks

Run the Prisma validation and migration status commands before and after deployment:

```bash
cd D:/ruangnode
corepack pnpm --filter @ruangnode/database run prisma:validate
corepack pnpm --filter @ruangnode/database run migrate:status
```

## Node and provisioning visibility

The architecture expects node and provisioning health to be visible through the control plane. Use the API and the database-backed infrastructure services to inspect node health, heartbeat and provisioning state rather than reading raw Docker state from the application layer.

Operational checks should include:

- node connectivity and heartbeat age
- capacity vs. allocated usage
- provisioning job status and retry count
- failed create/start/restart operations
- instance lifecycles and runtime ids

## Log handling

When deploying in a container or a host service, keep logs structured and keep the retention window bounded. Avoid writing secrets into logs.

Useful commands:

```bash
journalctl -u ruangnode-api -f
journalctl -u ruangnode-web -f
journalctl -u ruangnode-node-agent -f
```

## Backup and restore

At minimum:

- back up PostgreSQL data regularly
- keep a copy of the environment configuration in a secret manager
- retain release notes and the corresponding git revision

## Maintenance

Use a consistent rollout workflow:

1. Check `git status` and confirm the target revision.
2. Validate the env file and database connectivity.
3. Run the migration command if schema changes are included.
4. Restart or redeploy the service.
5. Confirm `/health` and critical UI/API flows.

## Dry runs and release gates

Before promoting a release, validate:

- typecheck
- lint
- test suite
- web production build
- database validation
- API health endpoint

The repository’s standard verification commands are:

```bash
cd D:/ruangnode
corepack pnpm test
corepack pnpm typecheck
npx eslint .
cd apps/web && npx next build
```
