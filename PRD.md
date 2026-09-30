# RuangNode — Product Requirements Document

## 1. Product Identity

**Brand:** RuangNode  
**Domain:** `ruangnode.me`

RuangNode is a commercial digital-product marketplace and managed
application hosting platform.

The platform sells downloadable digital products and managed services.
One important managed-service category is hosted AI agents such as
Hermes Agent. Customers purchase a plan, receive an isolated instance,
and manage that instance through the RuangNode panel.

RuangNode must be designed as a general platform, not as a website
hard-coded exclusively around Hermes.

## 2. Product Vision

RuangNode should make technical products deployable and purchasable
without requiring customers to understand Linux administration, Docker,
VPS provisioning, networking, or application installation.

The customer experience should be:

1.  Browse a product.
2.  Purchase it.
3.  Pay.
4.  Receive the service/product.
5.  Configure it from the RuangNode panel.
6.  Monitor its status and resources.
7.  Upgrade, renew, or cancel it when applicable.

For managed services, provisioning should eventually happen
automatically.

## 3. Product Categories

The catalog must support multiple product types:

### Digital products

Examples: - Scripts - Source code - Templates - Plugins - Configuration
packs - Automation files - Documentation - Other downloadable assets

### Managed services

Examples: - Hermes Agent hosting - n8n hosting - Discord bot hosting -
Telegram bot hosting - Other containerized applications

### Subscription services

Products can have: - Monthly billing - Yearly billing - One-time
purchase - Optional trial period - Optional renewal

## 4. Core Customer Experience

### Public website

Required pages:

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
- Contact/support

The homepage must clearly communicate: - What RuangNode sells - What
managed hosting provides - Why the service is useful - Available plans -
How deployment works

### Customer panel

Required areas:

- Overview
- My Products
- My Services
- Service detail
- Deployments
- Orders
- Billing
- Wallet/balance
- Payment history
- Support tickets
- Account settings
- Security settings

Managed-service detail pages should support:

- Status
- Start
- Stop
- Restart
- Resource usage
- Logs
- Configuration
- Files
- Console where supported
- Access information
- Custom domain
- Upgrade/downgrade
- Renewal
- Service activity/history

### Admin panel

Required areas:

- Dashboard
- Customers
- Products
- Orders
- Payments
- Subscriptions
- Nodes
- Instances
- Provisioning
- Resource profiles
- Logs
- Tickets
- Announcements
- System settings
- Audit logs

## 5. Resource Isolation

Resource isolation is a first-class feature.

Every managed service may reference a Resource Profile.

A Resource Profile can define:

- CPU limit
- Memory limit
- Memory/swap policy
- Disk limit
- PID limit
- Optional network limits
- Optional process limits

Example:

### Starter

- 1 vCPU
- 1 GB RAM
- 5 GB storage
- 256 PID limit

### Pro

- 2 vCPU
- 2 GB RAM
- 10 GB storage
- 512 PID limit

### Power

- 4 vCPU
- 8 GB RAM
- 30 GB storage
- 1024 PID limit

These are examples only. Production pricing and limits are configurable
by administrators.

Resource limits must be enforced by the runtime, not merely displayed in
the UI.

Docker/cgroups may be used for containerized services.

## 6. Node Architecture

RuangNode uses a Control Plane + Node Agent architecture.

### Control Plane

Responsible for: - Users - Products - Orders - Payments -
Subscriptions - Resource profiles - Node inventory - Instance records -
Provisioning orchestration - Customer UI - Admin UI - API

### Node Agent

Installed on each infrastructure node.

Responsible for: - Creating containers - Removing containers -
Starting/stopping/restarting containers - Applying resource limits -
Collecting metrics - Reading logs - Health checks - Controlled file
operations - Controlled console operations - Reporting node
capacity/status

The public internet must never receive unrestricted Docker socket
access.

## 7. Multi-Node Scheduling

The platform must support multiple nodes.

Each node stores: - Provider - Region - Hostname - Public/private
network information - CPU capacity - RAM capacity - Storage capacity -
Allocated resources - Available resources - Agent version - Agent
status - Health status

A provisioning scheduler should select a suitable node based on: -
Product requirements - Resource availability - Node status - Region -
Product compatibility - Optional administrator rules

Adding a new node must not require changes to the customer-facing
application.

## 8. Hermes Agent Hosting

Hermes is one managed-service implementation, not the entire platform.

A Hermes product may define: - Hermes version - Container image/build -
CPU/RAM/storage profile - Environment configuration - Supported AI
provider configuration - Gateway configuration - Persistent workspace -
Memory persistence - Skills - Optional integrations

Customer API keys should be treated as secrets and stored encrypted at
rest.

RuangNode should support BYOK (Bring Your Own Key) for model providers.

RuangNode must not expose one customer’s credentials to another
customer.

## 9. Payments

Payment architecture must be provider-agnostic.

Initial integration can use a suitable Indonesian payment provider such
as Midtrans or Xendit. Additional providers can be added later.

Payment lifecycle:

PENDING → PAID → PROVISIONING → ACTIVE

Failure paths:

PENDING → EXPIRED

PAID → PROVISIONING_FAILED

Provisioning failure must not silently lose the customer’s order.

The system must retain payment provider IDs and webhook event records.

## 10. Orders and Subscriptions

An Order represents a commercial purchase.

A Subscription represents an ongoing service entitlement.

An Instance represents the actual deployed service.

These entities must remain separate.

Example:

User → Order → Subscription → Instance

This allows: - Renewals - Upgrades - Downgrades - Re-provisioning -
Cancellation - Suspension - Instance migration

## 11. Digital Product Delivery

Digital products may be delivered through: - Secure download - Signed
temporary URL - Customer dashboard - Library access

Downloads must require authorization.

A customer must not be able to guess another customer’s private asset
URL.

## 12. Customer Configuration

Configuration UI should expose only supported and safe settings.

Example:

- Instance name
- Timezone
- AI provider
- Model
- API credential
- Gateway settings
- Enabled features
- Resource plan
- Restart policy

Sensitive values should be masked.

## 13. Monitoring

Customer monitoring should show: - CPU - Memory - Disk - Network -
Uptime - Instance status

Admin monitoring should additionally show: - Node capacity - Allocated
resources - Node health - Agent heartbeat - Instance count - Failed
provisioning - Resource pressure

## 14. Security Requirements

Minimum requirements:

- Password hashing
- Secure sessions
- Role-based access control
- CSRF protection where applicable
- Rate limiting
- Input validation
- Authorization checks on every resource
- Encrypted secrets
- Audit logs
- Secure webhook verification
- No public Docker socket
- No arbitrary host shell from the customer panel
- Tenant isolation
- File path traversal protection
- Upload restrictions
- Resource limits
- Instance ownership validation

The customer must never receive host-level privileges.

A console, if provided, must operate inside the customer’s isolated
runtime.

## 15. Design Direction

The visual language is **Neo-Brutalism**.

Characteristics: - Thick black borders - Hard offset shadows - Strong
rectangular components - Bold typography - Bright solid accent colors -
High contrast - Intentional asymmetry - Large whitespace - Tactile
controls - Clear hierarchy

Preferred palette: - Black - White - Electric blue - Purple - Pink -
Yellow - Cyan - Green

Avoid: - Generic SaaS gradients - Excessive glassmorphism - Soft
floating cards everywhere - Tiny unreadable text - Excessive animation

The UI should feel like a real technical product, not a template.

## 16. Responsive Design

Must work on: - Desktop - Laptop - Tablet - Mobile

The admin panel may prioritize desktop, but customer services must
remain usable on mobile.

## 17. Non-Goals

Do not: - Hard-code Azure as the only provider - Hard-code Hermes as the
only service - Expose Docker directly - Make resource limits cosmetic -
Put infrastructure credentials in frontend code - Couple payments
directly to provisioning implementation - Couple the customer UI
directly to Docker - Require rebuilding the website when a new node
provider is added

## 18. Success Criteria

RuangNode is architecturally successful when:

1.  An admin can create a product.
2.  The product can reference a resource profile.
3.  A customer can purchase it.
4.  Payment can be recorded through a provider webhook.
5.  A managed-service order can enter provisioning.
6.  A scheduler can select a suitable node.
7.  The Node Agent can create an isolated instance.
8.  CPU/RAM/PID limits are actually enforced.
9.  The customer can view instance status.
10. The customer can manage allowed settings.
11. The customer cannot access the host.
12. A second node can be added without redesigning the application.
13. A second managed-service type can be added without rewriting the
    store.
14. Digital products and managed services can coexist in one catalog.

## 19. Initial Implementation Principle

Build the final architecture from the beginning.

Do not create a throwaway MVP that must later be replaced.

Implementation can be performed incrementally, but the data model,
service boundaries, security model, and deployment architecture must be
designed for the intended full product.
