# MASTER CLINE PROMPT — RuangNode

## 0. MANDATORY PROJECT IDENTITY

Project name: **RuangNode**

Domain: **ruangnode.me**

Never rename this project to NexOps, Hermes, or another brand.

RuangNode is a commercial digital-product marketplace combined with managed application hosting. Customers can purchase digital products and managed services, receive isolated application instances, and manage those instances from a customer panel.

The implementation target is the complete intended architecture described by the project documentation. Do not build a disposable demo, fake MVP, cosmetic prototype, or UI-only simulation.

---

## 1. FIRST ACTION: READ THE PROJECT SPECIFICATION

Before writing production code, read all of these files completely:

- `.clinerules`
- `README.md`
- `PRD.md`
- `ARCHITECTURE.md`
- `DESIGN.md`
- `docs/DATABASE.md`
- `docs/API.md`
- `docs/NODE_AGENT.md`
- `docs/RESOURCE_ISOLATION.md`
- `docs/PROVISIONING.md`
- `docs/PAYMENTS.md`
- `docs/SECURITY.md`

Treat these documents as the authoritative project specification.

If the implementation needs a decision not covered by the documents, choose a technically sound option, document the decision, and keep it compatible with the existing architecture.

Do not silently replace the architecture with a simpler unrelated architecture.

---

## 2. DEVELOPMENT PRINCIPLES

Build the system as a real production-oriented application.

Mandatory principles:

1. TypeScript with strict typing.
2. Strong separation of concerns.
3. Multi-tenant authorization from the beginning.
4. Database-backed state; do not use JSON files as the production data store.
5. Real Docker resource enforcement for managed instances.
6. Real provisioning lifecycle.
7. Idempotent jobs and webhook handling.
8. Secure Node Agent communication.
9. Encrypted secrets.
10. Audit logging for sensitive administrative operations.
11. No public Docker socket.
12. No arbitrary host shell exposed to customers.
13. No fake resource limits.
14. No fake payment-success path exposed as production behavior.
15. No hard-coded credentials.
16. No secrets committed to Git.
17. Every API endpoint must perform authentication and authorization appropriate to the operation.
18. Every customer-owned object must be checked for tenant ownership.
19. Build reusable domain services rather than putting business logic directly into UI components.
20. Keep the architecture ready for multiple nodes.

Do not stop after creating scaffolding if the requested feature can reasonably be implemented in the current environment.

---

## 3. RECOMMENDED REPOSITORY STRUCTURE

Use a clean monorepo unless the existing repository requires another structure.

Suggested structure:

```text
ruangnode/
├─ apps/
│  ├─ web/
│  └─ api/
├─ packages/
│  ├─ db/
│  ├─ auth/
│  ├─ ui/
│  ├─ config/
│  ├─ types/
│  └─ services/
├─ node-agent/
├─ infra/
│  ├─ docker/
│  └─ scripts/
├─ docs/
├─ tests/
├─ .clinerules
├─ PRD.md
├─ ARCHITECTURE.md
├─ DESIGN.md
├─ README.md
├─ package.json
├─ pnpm-workspace.yaml
└─ .env.example
```

The exact structure may be adjusted if a technically superior equivalent is justified.

Prefer:

- pnpm workspaces
- TypeScript
- Next.js for the web/customer/admin interface
- PostgreSQL
- Prisma or another strongly typed PostgreSQL ORM
- Redis only where asynchronous jobs, queues, rate limiting, or transient state genuinely benefit from it
- Docker for managed application instances

Do not introduce unnecessary infrastructure merely for appearance.

---

## 4. SYSTEM ARCHITECTURE

Implement the following conceptual architecture:

```text
Customer Browser
      |
      v
Cloudflare / Reverse Proxy
      |
      v
RuangNode Web
      |
      +------> RuangNode API
                  |
                  +------> PostgreSQL
                  |
                  +------> Payment Providers
                  |
                  +------> Provisioning Engine
                  |
                  +------> Scheduler
                  |
                  +------> Node Agents
                              |
                              v
                           Docker
                              |
                              v
                    Customer Instances
```

Control Plane responsibilities:

- authentication
- authorization
- customer accounts
- products
- variants
- pricing
- orders
- payments
- subscriptions
- resource profiles
- instance records
- provisioning
- scheduling
- node management
- domains
- support
- audit
- administrative controls

Node Agent responsibilities:

- register with control plane
- authenticate
- heartbeat
- report capacity
- report metrics
- create containers
- start/stop/restart containers
- apply resource limits
- collect logs
- provide controlled file operations
- provide controlled console operations
- reconcile desired state
- report health
- safely handle node draining

The Node Agent must not expose arbitrary host shell access.

---

## 5. CORE DATA MODEL

Implement the database model described in `docs/DATABASE.md`.

At minimum support:

- User
- Role
- Product
- ProductVariant
- ResourceProfile
- Order
- OrderItem
- Payment
- Subscription
- Node
- NodeHeartbeat
- Instance
- ProvisioningJob
- Credential
- InstanceDomain
- SupportTicket
- SupportMessage
- AuditLog
- WebhookEvent
- Download

Use proper relationships, foreign keys, indexes, timestamps, uniqueness constraints, and status enums where appropriate.

Separate:

- order state
- payment state
- subscription state
- provisioning state
- instance runtime state

Do not collapse these into one generic status field.

Webhook events must be idempotent and uniquely identifiable by provider + external event ID.

Money must be represented safely using integer minor units rather than floating-point currency values.

---

## 6. AUTHENTICATION AND AUTHORIZATION

Implement real authentication.

Required capabilities:

- registration
- login
- logout
- password hashing
- session handling
- protected routes
- role-based authorization
- customer/admin separation
- ownership checks
- session invalidation where appropriate
- rate limiting on sensitive authentication operations

Never trust IDs supplied by the browser without verifying ownership.

A customer must never be able to access:

- another customer's order
- another customer's instance
- another customer's files
- another customer's logs
- another customer's credentials
- another customer's subscription
- administrative APIs

Admin authorization must be explicit.

---

## 7. PUBLIC WEBSITE

Implement:

- Home
- Products
- Product detail
- Pricing
- Documentation
- FAQ
- Login
- Register
- Terms
- Privacy
- Contact

The public store must support both:

1. Digital products
2. Managed services

Do not create two unrelated commerce systems.

Products should be represented by reusable product/product-variant concepts.

---

## 8. CUSTOMER PANEL

Implement a real customer dashboard.

Required areas:

- Overview
- My Products
- My Services
- Service detail
- Deployments
- Orders
- Billing
- Wallet if enabled by the implementation
- Payment history
- Support
- Account

A managed service detail page must support the documented capabilities:

- status
- start
- stop
- restart
- CPU usage
- memory usage
- disk usage
- logs
- configuration
- files
- console
- access information
- custom domains
- upgrade
- renewal

Use server-side authorization for every operation.

The UI must reflect actual backend state.

Do not create buttons that only change local UI state.

---

## 9. ADMIN PANEL

Implement:

- Dashboard
- Customers
- Products
- Orders
- Payments
- Subscriptions
- Nodes
- Instances
- Provisioning
- Resource Profiles
- Logs
- Tickets
- Announcements
- Settings
- Audit Log

Administrative actions should generate audit records where appropriate.

The admin must be able to:

- create/edit products
- create/edit variants
- create/edit resource profiles
- register nodes
- inspect node health
- inspect instances
- inspect provisioning jobs
- inspect payments
- inspect customers
- inspect audit events

---

## 10. RESOURCE PROFILES

Resource limits are a core feature.

A resource profile should support, where technically enforceable:

- CPU
- memory
- memory/swap policy
- disk
- PID limit
- network policy/limit if actually enforceable

CPU must be enforced using Docker/cgroup controls.

Memory must use a hard Docker memory limit.

PID limits must use Docker PID limits.

Do not represent a limit in the UI unless the runtime actually enforces it.

For disk:

- use real storage quota support when available;
- otherwise expose measured usage and explicitly distinguish it from a hard quota;
- never claim a soft monitoring limit is a hard enforcement limit.

The scheduler must account for host overhead and available capacity.

---

## 11. NODE AGENT

Implement a separate Node Agent application.

The agent must:

- authenticate to the control plane
- register a node
- send heartbeats
- report capacity
- report runtime health
- receive authorized instance commands
- create managed containers
- start/stop/restart containers
- apply Docker resource limits
- collect metrics
- collect logs
- perform controlled file operations
- support controlled console functionality
- reconcile desired state

The agent should preferably use an outbound authenticated connection so a customer-facing public port is not required on every node.

Use TLS for network communication.

Use per-node credentials/tokens that can be rotated.

Never expose the host Docker socket to customer containers.

Never give customer-facing API routes direct access to the host Docker socket.

---

## 12. DOCKER RUNTIME

Every managed application instance must be isolated.

Use:

- dedicated container identity
- resource limits
- PID limits
- controlled filesystem paths
- restricted network configuration
- non-root execution where compatible
- explicit container lifecycle
- health checks where appropriate

The implementation must support actual instance lifecycle:

```text
pending
provisioning
starting
running
stopped
restarting
error
deleting
deleted
```

Use a state machine or equivalent guarded transitions rather than arbitrary status mutation.

---

## 13. PROVISIONING ENGINE

Implement the lifecycle described in `docs/PROVISIONING.md`:

```text
Order
  ↓
Payment confirmed
  ↓
Provisioning job
  ↓
Node selection
  ↓
Instance creation
  ↓
Configuration
  ↓
Start
  ↓
Health check
  ↓
Active
```

Provisioning must be asynchronous where appropriate.

Jobs must be idempotent.

If a step fails:

- persist the failure
- preserve diagnostic information
- avoid duplicate resources
- support safe retry
- move the instance/job to a meaningful recoverable state

Implement reconciliation so the control plane can detect divergence between desired and actual runtime state.

---

## 14. NODE SCHEDULER

Implement scheduling based on:

- node status
- available CPU
- available memory
- instance resource profile
- node capacity
- region
- product compatibility
- draining state

Do not simply select the first node.

A node marked draining must not receive new instances.

The scheduler must reserve enough host capacity for the operating system and node services.

---

## 15. SERVICE ADAPTERS

Managed products must use a service-adapter concept.

Define an interface similar to:

```ts
interface ManagedServiceAdapter {
  create(...)
  delete(...)
  start(...)
  stop(...)
  restart(...)
  configure(...)
  health(...)
  metrics(...)
  logs(...)
}
```

The exact API may differ.

Implement Hermes as the first managed-service adapter.

Do not hard-code the entire platform around Hermes.

The architecture must allow future services such as:

- n8n
- Telegram bots
- Discord bots
- automation services
- other Dockerized applications

Each service should declare its compatible resource profiles and runtime requirements.

---

## 16. HERMES SERVICE

Hermes is a managed product offered through RuangNode.

The platform must treat Hermes as an application/service integration.

Support:

- instance provisioning
- start/stop/restart
- configuration
- logs
- metrics
- access information
- credentials/configuration management
- resource profiles
- upgrade/renewal

Prefer BYOK for AI provider credentials initially.

Secrets must:

- be encrypted at rest
- never be logged
- never be returned unnecessarily
- never be stored in plaintext in Git
- never be embedded in frontend bundles

Keep the Hermes adapter replaceable.

Do not make Hermes-specific assumptions part of the generic instance model.

---

## 17. PAYMENTS

Implement a provider abstraction.

Conceptually:

```ts
interface PaymentProvider {
  createPayment(...)
  verifyWebhook(...)
  getPaymentStatus(...)
  refund(...)
}
```

Support the architecture for providers such as:

- Midtrans
- Xendit
- Stripe

The first implementation may depend on whichever provider credentials are actually available.

If credentials are unavailable during development:

- implement the adapter interface
- implement a clearly isolated development/test provider if necessary
- keep production payment-success paths protected
- never silently treat arbitrary frontend requests as paid orders

Webhook processing must verify authenticity and be idempotent.

---

## 18. DIGITAL PRODUCTS

The marketplace must also support digital products.

Implement:

- product listing
- product details
- variants
- pricing
- orders
- payment
- purchase history
- protected download delivery
- download authorization

Downloads must not be publicly accessible by predictable filesystem URLs.

Use authorization before generating/accessing downloads.

---

## 19. FILE MANAGER

For managed instances implement controlled file operations.

Required concepts:

- list
- read
- write
- create
- rename
- delete
- upload/download where appropriate

Security requirements:

- canonicalize paths
- prevent `../` traversal
- restrict access to the instance's assigned workspace
- enforce size limits
- enforce upload limits
- validate filenames
- never expose arbitrary host paths

Do not allow customers to escape their instance filesystem.

---

## 20. CONTROLLED WEB CONSOLE

Implement a controlled console for managed instances.

The console must not become an unrestricted host shell.

Commands must execute inside the managed container context only.

Use:

- authentication
- instance ownership authorization
- session authorization
- rate limiting where appropriate
- command/session lifecycle control
- output streaming
- termination support

Never execute customer console commands directly on the host.

---

## 21. LOGS AND MONITORING

Implement:

- current CPU usage
- current memory usage
- memory limit
- current disk usage
- PID usage where available
- instance status
- uptime
- recent logs
- health state

Metrics must come from actual runtime state.

Do not fabricate metrics.

Use polling or streaming according to what is appropriate.

The UI should clearly distinguish:

- current usage
- allocated limit
- measured storage
- enforced quota

---

## 22. DOMAINS

Implement instance domain management.

Support:

- custom domain records
- domain verification workflow
- instance-domain association
- status
- removal

Do not claim that a domain is active merely because a customer entered it.

The backend must verify the required state.

Keep Cloudflare integration replaceable/configurable.

---

## 23. SECURITY REQUIREMENTS

Implement the security requirements from `docs/SECURITY.md`.

At minimum:

- secure password hashing
- secure sessions
- RBAC
- tenant isolation
- authorization checks
- CSRF protection where applicable
- XSS-safe rendering
- SQL injection protection through parameterized ORM/query APIs
- SSRF protection
- rate limiting
- request validation
- upload validation
- path traversal protection
- secret encryption
- audit logs
- webhook verification
- safe Docker execution
- no public Docker socket
- no arbitrary host shell
- safe error messages
- secure logging
- production-safe headers

Never log:

- passwords
- API keys
- session tokens
- node secrets
- payment secrets
- private credentials

---

## 24. UI / UX

Follow `DESIGN.md`.

Visual direction:

**Neo-Brutalism**

Characteristics:

- thick black borders
- hard offset shadows
- strong typography
- high contrast
- bright accent colors
- clear whitespace
- tactile buttons
- strong cards
- bold section hierarchy
- responsive layout

Suggested accent family:

- electric blue
- purple
- pink
- yellow
- cyan
- green

Do not turn the design into generic glassmorphism SaaS.

Do not use excessive gradients, blurred glass panels, or low-contrast minimalist cards.

The interface must remain usable and accessible.

Responsive targets:

- desktop
- tablet
- mobile

Build reusable components for:

- buttons
- cards
- badges
- tables
- forms
- dialogs
- tabs
- metrics cards
- status indicators
- navigation
- empty states
- error states
- loading states

---

## 25. API DESIGN

Use the REST API described in `docs/API.md`.

Base path:

```text
/api/v1
```

Organize endpoints around:

- auth
- users
- products
- product variants
- resource profiles
- orders
- payments
- subscriptions
- instances
- metrics
- logs
- files
- console
- domains
- support
- admin nodes
- admin instances
- provisioning
- audit

Every handler must include:

1. authentication
2. authorization
3. input validation
4. business logic
5. safe error handling
6. audit logging where appropriate

---

## 26. OBSERVABILITY

Implement enough observability to operate the system.

Include:

- structured application logs
- request IDs
- provisioning job logs
- node heartbeat timestamps
- instance state changes
- audit events
- payment webhook records
- meaningful error states

Avoid logging sensitive values.

---

## 27. TESTING

Testing is mandatory.

Implement tests for:

### Authentication
- registration
- login
- unauthorized access
- role checks

### Tenant isolation
- customer A cannot access customer B data
- customer A cannot operate customer B instance
- customer A cannot access customer B files/logs

### Products
- product creation
- variants
- pricing
- availability

### Orders
- order creation
- ownership
- state transitions

### Payments
- valid webhook
- invalid webhook
- duplicate webhook
- payment state transition

### Provisioning
- successful provisioning
- retry
- duplicate job
- failure recovery
- idempotency

### Resource profiles
- CPU mapping
- memory mapping
- PID mapping
- invalid profile rejection

### Node Agent
- authentication
- heartbeat
- node registration
- command authorization
- reconciliation

### Runtime
- container creation
- resource limit application
- lifecycle operations

### Security
- path traversal
- unauthorized file access
- secret exposure prevention
- SSRF protections where applicable

Run:

```text
lint
typecheck
unit tests
integration tests
build
```

before considering a major implementation phase complete.

---

## 28. DEVELOPMENT ENVIRONMENT

Inspect the actual development environment before choosing installation steps.

Check:

- operating system
- Node.js
- pnpm/npm
- Docker
- Docker Compose
- PostgreSQL availability
- Git
- available ports

Do not blindly overwrite existing project configuration.

Create:

```text
.env.example
```

with documented variables.

Never create a real `.env` containing invented credentials.

If a development database is needed, provide Docker Compose or another reproducible local method.

---

## 29. DEVELOPMENT SEEDING

Provide a safe development seed mechanism.

It may create:

- development admin
- development customer
- sample products
- sample resource profiles
- sample node
- sample service adapter configuration

Do not hard-code a production password.

Use environment variables or explicitly generated development credentials.

Mark seeded records clearly as development data.

---

## 30. INFRASTRUCTURE

Provide deployment artifacts for:

- web
- API
- Node Agent
- PostgreSQL
- Redis if used

Include:

- Dockerfiles
- docker-compose configuration for development
- environment documentation
- migration commands
- seed commands
- health checks
- startup commands

Do not assume the current small VPS is a production cluster.

The current development VPS is a test environment.

---

## 31. CURRENT TEST NODE

A small Azure VM is available for development/testing.

Known characteristics:

- Ubuntu 22.04
- x86_64
- 2 vCPU
- approximately 1 GB RAM
- approximately 62 GB disk
- Docker installed
- 2 GB swap
- hostname: `ruangnode`

This node is for testing the Node Agent and resource isolation.

Do not assume it is suitable for production hosting.

Do not hard-code its public IP or credentials into source code.

Do not automatically deploy to it unless explicit credentials and authorization are available.

---

## 32. RESOURCE ISOLATION VALIDATION

The test environment has already demonstrated that Docker limits can be enforced using settings equivalent to:

```text
--memory=128m
--memory-swap=128m
--cpus=0.5
--pids-limit=100
```

The implementation must preserve this principle.

When a resource profile is applied, verify the actual Docker configuration instead of trusting only database values.

The system should eventually expose runtime-confirmed limits to the control plane.

---

## 33. ERROR HANDLING

Do not hide errors.

Every important operation should have:

- typed errors where practical
- meaningful error codes
- safe user-facing messages
- detailed server-side diagnostics
- retryability information where relevant

Never expose stack traces, secrets, internal paths, or infrastructure credentials to customers.

---

## 34. IDE / CLINE EXECUTION BEHAVIOR

You are operating as the implementation agent inside Cline.

Work directly on the repository.

Before making large changes:

1. inspect the repository
2. inspect package configuration
3. inspect existing source
4. inspect existing tests
5. inspect documentation
6. determine what already exists
7. preserve useful existing work

Do not rewrite functioning code without a reason.

Do not create duplicate implementations of the same domain service.

Prefer extending existing modules when they fit the architecture.

---

## 35. IMPLEMENTATION ORDER

Implement the system in coherent vertical phases while preserving the final architecture.

Recommended sequence:

### Phase 1 — Foundation

- monorepo/tooling
- TypeScript
- database
- configuration
- logging
- shared types
- auth foundation
- UI foundation
- test infrastructure

### Phase 2 — Commerce

- products
- variants
- resource profiles
- catalog
- cart/order model
- customer order history
- digital product delivery

### Phase 3 — Accounts and panels

- customer panel
- admin panel
- RBAC
- ownership enforcement
- support
- audit

### Phase 4 — Control Plane

- instances
- node model
- node scheduler
- provisioning jobs
- service adapters
- lifecycle state machine

### Phase 5 — Node Agent

- registration
- authentication
- heartbeat
- capacity
- Docker runtime
- resource enforcement
- metrics
- logs

### Phase 6 — Managed Services

- Hermes adapter
- configuration
- access information
- instance operations
- monitoring

### Phase 7 — Payments

- provider abstraction
- payment creation
- verified webhook
- subscription lifecycle
- renewal
- upgrade
- refunds where supported

### Phase 8 — Advanced operations

- files
- controlled console
- domains
- reconciliation
- node draining
- operational tooling

### Phase 9 — Hardening

- security review
- tenant isolation tests
- rate limits
- secret review
- error handling
- observability
- migration review
- deployment review

Do not interpret this as permission to replace later phases with mocks.

Each phase should implement real interfaces that remain compatible with the final system.

---

## 36. DEFINITION OF DONE

A feature is not done merely because:

- a page exists
- a button exists
- an API route returns hard-coded JSON
- a database row is inserted without runtime behavior
- a Docker container is created without resource enforcement
- a payment screen says "success"

A feature is done when its important path is connected end-to-end.

For example:

```text
Customer purchase
→ payment
→ verified webhook
→ order paid
→ provisioning job
→ scheduler
→ node agent
→ Docker instance
→ resource profile applied
→ health check
→ customer sees running instance
```

Similarly:

```text
Customer clicks Restart
→ authenticated API
→ ownership check
→ instance command
→ node agent
→ Docker restart
→ runtime state
→ control plane update
→ UI reflects actual state
```

---

## 37. WHAT NOT TO DO

Never:

- rename RuangNode
- build only a frontend mock
- fake provisioning
- fake resource limits
- expose Docker socket publicly
- execute host shell commands from customer APIs
- trust browser-supplied ownership
- store secrets in plaintext
- hard-code API keys
- hard-code payment success
- use floating point for monetary values
- make Hermes the entire architecture
- create a single giant source file
- duplicate domain logic across routes
- silently swallow provisioning errors
- claim a disk quota is enforced when it is only monitored
- commit `.env`
- use real credentials in fixtures
- deploy to production automatically
- remove architectural boundaries merely to make the code shorter

---

## 38. CLINE WORKFLOW

At the start:

1. Read all project documents.
2. Inspect repository state.
3. Create an implementation plan in the repository if one does not already exist.
4. Identify existing code worth preserving.
5. Implement the architecture.
6. Run tests continuously.
7. Fix errors rather than bypassing tests.
8. Keep documentation synchronized with architectural changes.
9. At the end of each major phase, report:
   - files created
   - files changed
   - features implemented
   - tests run
   - tests passed/failed
   - known blockers
   - next implementation phase

Do not ask for confirmation for every small implementation decision.

Ask only when a genuinely blocking decision requires user-specific information, credentials, external account access, or a product decision that cannot be safely inferred.

---

## 39. EXTERNAL DEPENDENCIES

If a feature requires external credentials or services, implement the correct abstraction and integration points.

Examples:

- payment provider credentials
- Cloudflare API
- SMTP
- object storage
- AI provider API keys

Use environment variables.

Document exactly what is required.

Do not invent credentials.

Do not block unrelated development because a production credential is unavailable.

---

## 40. CLOUDFLARE / DOMAIN

The production domain is:

```text
ruangnode.me
```

Cloudflare is intended to be the DNS/reverse-proxy layer.

Do not hard-code Cloudflare-specific behavior into the core application.

Domain management should be implemented behind a provider/integration layer.

Do not change DNS records automatically unless explicit credentials and authorization are provided.

---

## 41. COMMERCIAL READINESS

The final architecture must be suitable for a commercial service.

Consider:

- tenant isolation
- billing
- renewal
- suspension
- cancellation
- resource upgrades
- resource downgrades
- node capacity
- instance lifecycle
- auditability
- support
- backups
- failure recovery
- security
- operational visibility

Do not assume a single VPS forever.

The architecture must support adding additional nodes later without redesigning the customer-facing product.

---

## 42. FINAL INSTRUCTION

Build **RuangNode**, not a tutorial project.

The goal is a functioning platform where:

1. A visitor can browse products.
2. A customer can create an account.
3. A customer can purchase a digital product or managed service.
4. A verified payment can trigger provisioning.
5. The scheduler can select a suitable node.
6. The Node Agent can create the instance.
7. Docker actually enforces the resource profile.
8. The customer can manage the instance from the panel.
9. Admins can manage products, customers, nodes, instances, provisioning, payments, and audit logs.
10. The system can support multiple nodes and multiple managed service types.
11. Hermes is one service integration rather than the entire platform.
12. The architecture remains secure and maintainable.

Start by reading the specification files and inspecting the repository. Then implement the system according to this document and the existing project documentation.
