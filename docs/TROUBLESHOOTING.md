# Troubleshooting

This guide covers the most common issues when running the repository locally or during deployment.

## `pnpm` is not recognized

The repository is configured for Corepack-based pnpm activation.

Use:

```bash
corepack enable pnpm
corepack pnpm install
```

If the shell still does not resolve `pnpm`, run commands through `corepack pnpm` directly.

## `DATABASE_URL` is missing

The API and Prisma tooling fail fast if the database connection string is not configured.

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
```

Then set `DATABASE_URL` to a valid PostgreSQL connection string.

## Session cookie issues

The API requires a valid `SESSION_SECRET`.

Check:

- `SESSION_SECRET` exists
- value length is at least 32 characters
- `SESSION_COOKIE_SECURE` matches the deployment’s HTTPS configuration

## API and web do not connect

Confirm:

- `API_PORT` matches the running service
- `NEXT_PUBLIC_API_URL` points to the correct URL
- the reverse proxy forwards traffic correctly
- CORS and session cookies are configured for the actual hostnames

## Node agent runtime failures

The node agent is the only component allowed to reach Docker. Verify:

- Docker is running on the host
- the agent environment file is populated
- `NODE_AGENT_SHARED_SECRET` matches the control plane expectation
- the Docker socket permissions permit the agent user

## Prisma migration failures

Run:

```bash
cd D:/ruangnode
corepack pnpm --filter @ruangnode/database run prisma:validate
corepack pnpm --filter @ruangnode/database run migrate:status
```

If the schema is out of sync, apply migrations and then verify the runtime health endpoint.

## Web build issues

Run the production build from the app folder:

```bash
cd D:/ruangnode/apps/web
npx next build
```

If errors are specific to environment variables, confirm the `.env` file has the right public URLs and no secret values are accidentally placed in browser variables.

## Health checks are failing

Check service logs:

```bash
journalctl -u ruangnode-api -f
journalctl -u ruangnode-web -f
journalctl -u ruangnode-node-agent -f
```

Then verify:

- Postgres connectivity
- correct ports
- correct environment file
- reverse proxy health checks

## Common security check

If a service refuses to start, check for:

- missing secret values
- invalid port value
- invalid Boolean values for `SESSION_COOKIE_SECURE`
- untrusted agent credentials

The repository intentionally fails fast in the presence of invalid configuration rather than silently starting with insecure defaults.
