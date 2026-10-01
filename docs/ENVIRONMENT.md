# Environment configuration

This repository intentionally keeps environment configuration at the boundary of each runtime process. The examples live in root and package-local `.env.example` files, and the actual runtime values are expected to be injected by the deployment environment or a secret manager.

## Required files

- `.env.example` — repository-level environment template
- `apps/api/.env.example` — API runtime values
- `apps/web/.env.example` — web runtime values
- `node-agent/.env.example` — infrastructure agent values

## Repository root variables

The root `.env.example` includes runtime settings used across the platform:

- `NODE_ENV`
- `LOG_LEVEL`
- `WEB_APP_URL`
- `API_HOST`
- `API_PORT`
- `API_PUBLIC_URL`
- `DATABASE_URL`
- `SESSION_SECRET`
- `SESSION_TTL_HOURS`
- `PASSWORD_RESET_TTL_MINUTES`
- `SESSION_COOKIE_SECURE`
- `REDIS_URL` (optional, reserved for future job/queue state)
- `PAYMENT_PROVIDER`
- `PAYMENT_WEBHOOK_SECRET`
- `NODE_AGENT_ID`
- `NODE_AGENT_CONTROL_PLANE_URL`
- `NODE_AGENT_SHARED_SECRET`
- `STORAGE_ENDPOINT`
- `STORAGE_ACCESS_KEY_ID`
- `STORAGE_SECRET_ACCESS_KEY`

## API-specific configuration

The control plane API validates its environment at process start. The configuration is defined in `apps/api/src/auth/config.ts` and `packages/database/src/config.ts`.

Important values:

- `SESSION_SECRET` must be set and at least 32 characters long
- `SESSION_COOKIE_SECURE` defaults to `true` in production
- `WEB_APP_URL` is used for password-reset URLs
- `DATABASE_URL` must be provided before Prisma can connect
- `NODE_AGENT_URL` and `NODE_AGENT_TOKEN` must be provided together to enable authenticated infrastructure lifecycle routes

## Web-specific configuration

The browser app should receive the public base URLs only. Avoid leaking private service URLs or credentials.

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_WEB_URL`

## Node agent configuration

The node agent owns Docker runtime execution. Its runtime configuration is separate from the control-plane API and should use a different secret set.

- `NODE_AGENT_ID`
- `NODE_AGENT_SHARED_SECRET`
- `NODE_AGENT_CONTROL_PLANE_URL`
- `DOCKER_HOST`
- optional mTLS values such as `NODE_AGENT_TLS_CERT` and `NODE_AGENT_TLS_KEY`

## Security rules

- Never commit real `.env` files.
- Keep secrets in the deployment environment or managed secret storage.
- Do not print secrets in logs or errors.
- Use separate credentials for each runtime role.
- Prefer `__Host-` cookie semantics for secure browser sessions.

## Example workflow

```bash
cd D:/ruangnode
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp node-agent/.env.example node-agent/.env
```

Then replace the placeholder values with real deployment-specific settings.
