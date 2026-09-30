# RuangNode

RuangNode is a commercial digital-product marketplace and managed
application hosting platform.

**Domain:** https://ruangnode.me

## What RuangNode does

RuangNode combines two products in one platform:

1.  A digital-product store
2.  Managed hosting for containerized applications

Examples of managed products include Hermes Agent, n8n, bots, automation
services, and other applications that can safely run in isolated
containers.

## Architecture

``` text
                         RUANGNODE
                            |
              +-------------+-------------+
              |                           |
        Public Website              Customer Panel
              |                           |
              +-------------+-------------+
                            |
                       Control Plane
                            |
              +-------------+-------------+
              |             |             |
           Database      Payments     Provisioner
                            |
                       Node Scheduler
                            |
             +--------------+--------------+
             |              |              |
           Node 01        Node 02        Node 03
             |              |              |
         Node Agent     Node Agent     Node Agent
             |              |              |
          Docker         Docker         Docker
             |              |              |
        Instances      Instances      Instances
```

## Core principle

The Control Plane manages the platform.

Node Agents manage infrastructure.

Customers never receive direct host-level access.

## Repository direction

``` text
ruangnode/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   ├── database/
│   ├── auth/
│   ├── shared/
│   └── ui/
├── node-agent/
├── infra/
├── docs/
└── tests/
```

The Prisma schema, migrations and seed are owned by `packages/database/prisma/`
(see `docs/DECISIONS.md`, D-015); there is no root-level `prisma/` directory.

The exact implementation structure may be adjusted by the engineering
agent if it preserves the architecture and boundaries documented in
`docs/`.

## Main concepts

### Product

Something that can be sold.

### Resource Profile

The compute/storage limits assigned to a managed service.

### Order

A customer’s commercial purchase.

### Subscription

An ongoing entitlement for a recurring service.

### Instance

The actual deployed service.

### Node

A physical/virtual server capable of running instances.

### Node Agent

The trusted service running on a node and performing approved
infrastructure operations.

## Development rules

- TypeScript-first
- Strong validation at boundaries
- No secrets in source control
- No direct Docker socket exposure
- No host shell exposed to customers
- Tenant isolation is mandatory
- Resource limits must be enforced by infrastructure
- Infrastructure providers must be abstracted
- Payment providers must be abstracted
- Hermes must be implemented as a product/service integration, not the
  entire platform

## Current development node

The initial test node is a small Ubuntu VPS and is intended for
development/testing. It must not be treated as production capacity.

Production nodes can be added later through the Node Agent architecture.

## Documentation

- `docs/PRD.md` — product requirements
- `docs/ARCHITECTURE.md` — system architecture
- `docs/DESIGN.md` — visual design system
- `docs/SECURITY.md` — security requirements
- `docs/NODE_AGENT.md` — node agent architecture
- `docs/RESOURCE_ISOLATION.md` — resource enforcement

## Important

Do not simplify the product into a landing page-only project.

The public website is one part of RuangNode. The intended platform
includes store, customer panel, admin panel, payments, provisioning,
nodes, and isolated managed services.
