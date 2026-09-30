# RuangNode Security Specification

## Security priority

RuangNode runs customer workloads on infrastructure controlled by the
platform.

A compromise can affect multiple tenants.

Security boundaries are therefore a core product requirement.

## Trust zones

``` text
Internet
  |
  v
Cloudflare / Edge
  |
  v
Web/API
  |
  +---- Database
  |
  +---- Payment providers
  |
  +---- Node Agent channel
              |
              v
           Node host
              |
              v
           Docker
              |
              v
        Customer container
```

## Customer isolation

A customer must only access: - their account - their orders - their
payments - their subscriptions - their instances - their files - their
credentials

Never authorize based solely on a URL/resource ID.

Always check ownership.

## Authentication

Requirements: - secure password hashing if password auth is used -
secure session cookies - session expiration - logout/revocation -
password reset tokens - optional MFA architecture

Never store plaintext passwords.

## Authorization

Roles: - CUSTOMER - SUPPORT - ADMIN

Customer: - own resources only

Support: - support/customer operational access according to explicit
permissions

Admin: - platform management

Use server-side authorization.

## Secrets

Secrets include: - AI provider API keys - database passwords - payment
credentials - Cloudflare credentials - node credentials - session
secrets - agent credentials

Requirements: - encrypted at rest where stored - never log - never
return from list APIs - never commit to Git - rotate where supported

## API keys

For BYOK: - accept over HTTPS - encrypt at rest - decrypt only when
required - mask in UI - never expose plaintext after initial entry
unless explicitly designed and authorized

## Node Agent

The agent is privileged.

Requirements: - authenticated control-plane communication - replay
protection where appropriate - command authorization - request IDs -
idempotency - auditability - minimal host privileges

Never provide arbitrary host command execution.

## Docker

Never expose Docker daemon directly to the public internet.

Never mount:

``` text
/var/run/docker.sock
```

into customer containers.

Customer containers must not receive host root filesystem access.

## Console

A customer console must be attached to their container only.

Never implement:

``` text
user input → host shell
```

## Files

Every path must be: - normalized - relative to the instance root -
checked against traversal - checked against symlink escapes

Reject: - `../` - absolute paths - host filesystem paths

## Uploads

Validate: - size - content type - filename - destination - storage quota

Never trust a filename extension.

## Webhooks

Verify signatures before processing.

Store external event IDs to prevent replay/duplicate processing.

## Rate limits

Rate-limit: - login - registration - password reset - API - console
sessions - file operations - uploads - expensive admin operations

## CSRF

For cookie-authenticated state-changing requests, use an appropriate
CSRF protection strategy.

## XSS

- escape user-generated content
- use safe rendering
- sanitize where HTML is allowed
- set appropriate Content Security Policy when practical

## SQL injection

Use Prisma parameterized queries.

Do not build SQL from raw untrusted strings.

## SSRF

Any feature that fetches a customer-provided URL must defend against
SSRF.

Block access to: - localhost - loopback - link-local - cloud metadata
endpoints - internal control-plane networks

unless explicitly required and safely proxied.

## Audit logging

Audit: - login/security changes - admin actions - provisioning -
resource changes - payment adjustments - credential changes - instance
access operations

Do not log secrets.

## Network

Separate: - public web - control-plane internal services - node agent -
database

Database and Docker must not be publicly reachable.

## Backups

Back up: - database - critical configuration - customer persistent data
according to product policy

Test restore procedures.

## Incident response

Prepare procedures for: - compromised node - leaked credential -
malicious customer workload - payment fraud - data breach - agent
compromise

A compromised node should be drainable and removable from scheduling.

## Dependency security

Keep dependencies updated.

Use: - lockfiles - automated vulnerability scanning - minimal
dependencies

Review security-sensitive packages before adoption.

## Production secrets

Never place secrets in: - frontend bundles - Git - screenshots -
documentation examples - public issue trackers

Use placeholders in documentation.

## Security principle

Assume customer workloads are untrusted.

The platform must protect the host, other customers, the control plane,
and the database from customer-controlled code.
