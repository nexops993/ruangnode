# RuangNode API Specification

## API style

Initial API: REST over HTTPS.

Base:

``` text
/api/v1
```

Authentication: - secure session cookie for web - service-to-service
authentication for Node Agents - short-lived scoped credentials for
machine operations where appropriate

All API inputs must be schema validated.

## Standard response

Success:

``` json
{
  "data": {},
  "requestId": "..."
}
```

Error:

``` json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Resource not found",
    "requestId": "..."
  }
}
```

Do not expose stack traces or secrets.

## Authentication

``` text
POST /auth/register
POST /auth/login
POST /auth/logout
GET  /auth/me
POST /auth/password/reset/request
POST /auth/password/reset/confirm
```

Implemented in Phase 1B under `/api/v1/auth`. Contract details:

- The session is carried by an `httpOnly`, `sameSite=lax`, HMAC-signed cookie
  (`__Host-ruangnode_session` when `Secure`). Tokens never appear in a URL, a
  header or a response body.
- `POST /register` returns `201` with `{ data: { user } }` and signs the new
  customer in. The role is always `CUSTOMER`.
- `POST /login` returns `200` with `{ data: { user } }`. Unknown accounts, wrong
  passwords and inactive accounts all return the same `401`.
- `POST /logout` returns `204`, clears the cookie and revokes the session.
  Idempotent.
- `GET /me` returns `{ data: { user } }` or `401`.
- `POST /password/reset/request` always returns `202` with the same body, whether
  or not the account exists.
- `POST /password/reset/confirm` returns `200`; the token is single-use, expires
  after 60 minutes and revokes every session of the account.
- `422` (`VALIDATION_FAILED`) is returned for malformed input; the message lists
  field names only.
- Authentication endpoints are rate limited (`429` with `Retry-After`).
- `Cache-Control: no-store` is set on every authentication response.

### Session management

``` text
GET    /auth/sessions
DELETE /auth/sessions/:id
POST   /auth/sessions/revoke-all
```

`GET /auth/sessions` lists the caller's active sessions (`current` marks the
requesting one) and never returns a token or a token hash.
`DELETE /auth/sessions/:id` revokes one session; a session that belongs to
somebody else is reported as `404`. `POST /auth/sessions/revoke-all` revokes every
other session of the caller and keeps the current one.

### Roles

`CUSTOMER`, `SUPPORT`, `ADMIN` (`User.role`). Role checks are server-side only;
`SUPPORT`/`ADMIN` routes use the `requireRole` guard, and customer-owned resources
use `requireOwnership`, which returns `404` for another tenant's resource.

## Products

``` text
GET  /products
GET  /products/:slug
POST /admin/products
PATCH /admin/products/:id
DELETE /admin/products/:id

POST /admin/products/:id/variants
PATCH /admin/product-variants/:id
DELETE /admin/product-variants/:id
```

## Resource profiles

``` text
GET  /admin/resource-profiles
POST /admin/resource-profiles
GET  /admin/resource-profiles/:id
PATCH /admin/resource-profiles/:id
DELETE /admin/resource-profiles/:id
```

`DELETE` deactivates the profile; it never physically deletes a profile that may
be referenced by historical variants or instances. Only admins can modify
resource profiles.

## Orders

``` text
POST /orders
GET  /orders
GET  /orders/:id
POST /orders/:id/cancel
```

Users may only access their own orders.

## Payments

``` text
POST /payments/create
GET  /payments/:id
```

Provider webhook:

``` text
POST /webhooks/payments/:provider
```

Webhook endpoints must verify provider signatures and enforce
idempotency.

## Subscriptions

``` text
GET  /subscriptions
GET  /subscriptions/:id
POST /subscriptions/:id/cancel
POST /subscriptions/:id/renew
POST /subscriptions/:id/upgrade
```

## Instances

``` text
GET  /instances
POST /instances
GET  /instances/:id
POST /instances/:id/start
POST /instances/:id/stop
POST /instances/:id/restart
PATCH /instances/:id/configuration
DELETE /instances/:id
```

All instance endpoints require ownership or privileged admin
authorization.

## Instance metrics

``` text
GET /instances/:id/metrics
GET /instances/:id/metrics/history
```

Metrics returned should include: - cpu - memory - disk - network -
uptime - status

## Instance logs

``` text
GET /instances/:id/logs
GET /instances/:id/logs/stream
```

The streaming endpoint must not expose logs from another instance.

## Files

``` text
GET    /instances/:id/files
POST   /instances/:id/files/upload
POST   /instances/:id/files/mkdir
PATCH  /instances/:id/files
DELETE /instances/:id/files
GET    /instances/:id/files/download
```

All paths must be normalized and constrained to the instance root.

Never allow: - `..` - absolute host paths - symlink escapes - arbitrary
Docker host paths

## Console

``` text
POST /instances/:id/console/session
WS   /instances/:id/console
```

Console access must be restricted to the instance runtime.

No host shell.

## Domains

``` text
GET  /instances/:id/domains
POST /instances/:id/domains
DELETE /instances/:id/domains/:domainId
```

Custom domain verification must be required before activation.

## Admin nodes

``` text
GET    /admin/nodes
POST   /admin/nodes
GET    /admin/nodes/:id
PATCH  /admin/nodes/:id
POST   /admin/nodes/:id/drain
POST   /admin/nodes/:id/maintenance
```

## Admin instances

``` text
GET  /admin/instances
GET  /admin/instances/:id
POST /admin/instances/:id/reconcile
POST /admin/instances/:id/retry-provisioning
```

## Node Agent API

Prefer authenticated agent-to-control-plane communication rather than
exposing privileged endpoints publicly.

Logical operations:

``` text
agent.register
agent.heartbeat
agent.capacity
agent.createInstance
agent.deleteInstance
agent.startInstance
agent.stopInstance
agent.restartInstance
agent.updateResources
agent.metrics
agent.logs
agent.health
agent.fileOperation
```

Every command must include: - command ID - instance ID - timestamp -
authentication context - idempotency key where applicable

The agent must reject commands for unknown or unauthorized instances.

## Rate limiting

Apply rate limits to: - login - registration - password reset - public
API - file upload - console session creation - expensive admin
operations

## API versioning

Use `/api/v1`.

Breaking changes require a new version.
