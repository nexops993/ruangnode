# RuangNode Architecture

## 1. System Overview

RuangNode is a control-plane platform with multiple infrastructure
nodes.

``` text
Browser
  |
  v
Cloudflare
  |
  v
RuangNode Web
  |
  v
RuangNode API
  |
  +---- PostgreSQL
  |
  +---- Payment Providers
  |
  +---- Provisioning Engine
  |
  +---- Node Scheduler
             |
             +---- Node Agent #01
             |       |
             |       +---- Docker
             |
             +---- Node Agent #02
             |       |
             |       +---- Docker
             |
             +---- Node Agent #03
                     |
                     +---- Docker
```

## 2. Control Plane

The control plane contains:

- Web application
- API
- Authentication
- Authorization
- Product catalog
- Orders
- Payments
- Subscriptions
- Resource profiles
- Provisioning jobs
- Node registry
- Instance registry
- Audit logs

It must not require direct unrestricted access to every Docker daemon.

## 3. Node Agent

The Node Agent is a small service installed on each node.

Responsibilities:

- register with control plane
- heartbeat
- report capacity
- report health
- create instances
- delete instances
- start
- stop
- restart
- update limits
- collect metrics
- retrieve logs
- perform controlled file operations
- perform controlled console operations

The agent must authenticate all control-plane requests.

## 4. Docker

Docker is the initial runtime for managed container services.

An instance should receive a dedicated container or controlled container
group.

Example:

``` text
Instance
  |
  +-- CPU limit
  +-- memory limit
  +-- swap policy
  +-- PID limit
  +-- storage
  +-- network
```

## 5. Resource Model

Resource profiles define product capacity.

``` text
Product
  |
  +-- ResourceProfile
          |
          +-- cpuLimit
          +-- memoryLimit
          +-- memorySwap
          +-- diskLimit
          +-- pidsLimit
```

The runtime must enforce these values.

## 6. Scheduling

Before provisioning:

1.  Validate product.
2.  Validate payment/subscription.
3.  Find compatible nodes.
4.  Filter unhealthy nodes.
5.  Check available CPU.
6.  Check available RAM.
7.  Check available storage.
8.  Apply placement rules.
9.  Create provisioning job.
10. Ask Node Agent to provision.

The scheduler must avoid overcommitting hard resource limits unless an
explicit overcommit policy exists.

## 7. Instance Lifecycle

``` text
ORDER_CREATED
      |
PAYMENT_PENDING
      |
PAYMENT_CONFIRMED
      |
PROVISIONING
      |
CONFIGURING
      |
HEALTH_CHECK
      |
ACTIVE
```

Failure:

``` text
PROVISIONING
      |
PROVISIONING_FAILED
      |
RETRY / MANUAL_REVIEW
```

## 8. Idempotency

Every provisioning operation must have an idempotency key.

Repeated payment webhook delivery must not create duplicate services.

Repeated provisioning requests must resolve to the same intended
instance/job.

## 9. Product Abstraction

The platform should define a service adapter concept.

Example:

``` text
ManagedServiceAdapter
  create()
  delete()
  start()
  stop()
  restart()
  configure()
  health()
  logs()
  metrics()
```

Hermes implements one managed-service adapter.

Other applications can implement additional adapters later.

## 10. Provider Abstraction

Infrastructure provider must also be abstracted.

``` text
InfrastructureProvider
  createNode()
  destroyNode()
  getNode()
  getCapacity()
```

The initial system may only manage manually-created VPS nodes.

Automatic VPS purchasing/provisioning can be added later.

## 11. Network Architecture

Public traffic should enter through: - Cloudflare - reverse proxy -
application gateway where appropriate

Node Agent communication should use authenticated secure communication.

Do not expose: - Docker daemon - PostgreSQL - Redis - internal control
ports

directly to the public internet unless explicitly secured and required.

## 12. Storage

Persistent service data must survive container recreation.

Use per-instance storage volumes or controlled directories.

A customer’s persistent data must not be stored in another customer’s
directory.

## 13. Domain Routing

Managed services can receive subdomains such as:

``` text
agent-abc.ruangnode.me
```

Custom domains can later map through a gateway/reverse proxy.

Cloudflare can be used for DNS and edge TLS.

## 14. Observability

The system should track:

Control Plane: - API latency - errors - jobs - payments - provisioning
failures

Node: - CPU - RAM - disk - network - Docker status - agent heartbeat

Instance: - CPU - RAM - disk - network - status - uptime

## 15. Initial Infrastructure

The current small VPS is a development/test node.

It is not assumed to be production capacity.

The architecture must allow additional production nodes to be attached
later.
