# RuangNode Provisioning

## Goal

Turn a paid managed-service order into a working isolated instance.

## Lifecycle

``` text
ORDER CREATED
      |
PAYMENT CONFIRMED
      |
PROVISIONING JOB CREATED
      |
NODE SELECTED
      |
INSTANCE CREATED
      |
CONFIGURED
      |
STARTED
      |
HEALTH CHECK
      |
ACTIVE
```

## Step 1 — Order

Customer creates an order for a ProductVariant.

Store: - product snapshot - price snapshot - resource profile
reference - customer - billing information

## Step 2 — Payment

Payment provider confirms payment through a verified webhook.

Do not provision solely because a browser is redirected to a success
page.

## Step 3 — Provisioning Job

Create an idempotent ProvisioningJob.

Example:

``` text
jobId
instanceId
operation=CREATE
idempotencyKey
status=PENDING
```

## Step 4 — Scheduler

Scheduler finds nodes that: - are ONLINE - have healthy agents - support
the service - have sufficient resources - satisfy region/placement rules

Select a suitable node.

## Step 5 — Agent Command

Control Plane sends:

``` text
CREATE_INSTANCE
```

with: - instance ID - service type - resource profile - safe
configuration - provisioning token - idempotency key

Never send unnecessary customer secrets in logs.

## Step 6 — Node Agent

Agent:

1.  validates request
2.  reserves local resources
3.  creates storage
4.  creates runtime
5.  applies limits
6.  starts service
7.  checks health
8.  reports result

## Step 7 — Health Check

The system must verify that the service is actually operational.

Examples: - process exists - container running - HTTP health endpoint -
gateway connection - service-specific check

## Failure handling

If provisioning fails:

``` text
PROVISIONING_FAILED
```

Store: - error category - safe error message - attempt count -
timestamp - node - job ID

Support retry.

Do not create duplicate instances on retry.

## Idempotency

A repeated CREATE request with the same idempotency key must return the
existing operation/result.

Payment webhooks must also be idempotent.

## Deprovisioning

On cancellation/expiration:

1.  Apply service policy.
2.  Stop service.
3.  Archive data if product policy requires it.
4.  Delete runtime.
5.  Release resources.
6.  Update instance state.
7.  Record audit event.

Never immediately destroy data when a billing grace period is required.

## Renewal

Renewal should extend subscription dates without recreating an instance
unless the product explicitly requires recreation.

## Upgrade

Upgrade: - validate payment - validate target profile - validate
capacity - apply new profile - restart if necessary - update
subscription - audit

## Migration

Future migration workflow:

``` text
Source Node
    |
snapshot/backup
    |
Target Node
    |
restore
    |
health check
    |
switch routing
    |
release source
```

Migration must not be implemented until persistent-data semantics are
well-defined.

## Reconciliation

A periodic reconciler should detect: - instance exists in DB but not
runtime - runtime exists but not DB - wrong resource limits - wrong
node - stale provisioning jobs - unhealthy services

Admin should be able to inspect and retry reconciliation.

## Concurrency

Prevent duplicate provisioning using: - database unique constraints -
idempotency keys - transactional state changes - job locks/leases

## Customer visibility

Customer should see:

``` text
Payment received
Provisioning
Starting
Health check
Online
```

Do not expose raw infrastructure errors.

## Audit

Record: - who initiated operation - what changed - when - instance -
node - result
