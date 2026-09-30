# RuangNode Database Specification

## Database

Use PostgreSQL with Prisma.

The database is the source of truth for business state. Runtime state
from Docker is reconciled into database state rather than replacing the
database model.

## Core entities

``` text
User
Role
Product
ProductVariant
ResourceProfile
Order
OrderItem
Payment
Subscription
Node
NodeHeartbeat
Instance
ProvisioningJob
Credential
InstanceDomain
SupportTicket
SupportMessage
AuditLog
WebhookEvent
Download
```

## Relationships

``` text
User
 ├── Orders
 ├── Subscriptions
 ├── Instances
 ├── Credentials
 ├── Tickets
 └── AuditLogs

Product
 ├── ProductVariants
 └── ResourceProfile reference

Order
 ├── OrderItems
 └── Payments

OrderItem
 └── ProductVariant

Subscription
 └── Instance

Node
 ├── NodeHeartbeats
 └── Instances

Instance
 ├── Credential
 ├── Domains
 ├── ProvisioningJobs
 └── ResourceProfile
```

## User

Fields: - id - email - name - passwordHash or external auth identity -
role - status - createdAt - updatedAt - lastLoginAt

Roles: - CUSTOMER - SUPPORT - ADMIN

Do not trust role values from the client.

## Product

Fields: - id - slug - name - description - type - status - serviceType -
createdAt - updatedAt

Types: - DIGITAL - MANAGED_SERVICE - SUBSCRIPTION

Service type is extensible. Hermes is one service type.

## ProductVariant

A product may have multiple purchasable plans.

Fields: - id - productId - name - sku - price - currency -
billingPeriod - resourceProfileId - storageQuota - configurationSchema -
status

Billing periods: - ONE_TIME - MONTHLY - YEARLY

## ResourceProfile

Fields: - id - name - cpuLimit - memoryLimitBytes - memorySwapBytes -
diskLimitBytes - pidsLimit - networkPolicy - description - active

Resource values must be stored in unambiguous units.

The backend must validate that a profile is compatible with the target
node.

## Order

Fields: - id - userId - status - currency - subtotal - discount -
total - createdAt - updatedAt

Order status: - PENDING - PAID - FAILED - CANCELLED - EXPIRED - REFUNDED

## OrderItem

Fields: - id - orderId - productVariantId - quantity - unitPrice -
totalPrice - metadataSnapshot

Store a snapshot of commercial information so historical orders remain
correct even if a product changes later.

## Payment

Fields: - id - orderId - provider - providerPaymentId - status -
amount - currency - paidAt - rawReference - createdAt - updatedAt

Never trust a client-side success redirect as proof of payment.

## Subscription

Fields: - id - userId - orderItemId - productVariantId - status -
startsAt - currentPeriodStart - currentPeriodEnd - cancelAtPeriodEnd -
cancelledAt - createdAt - updatedAt

Statuses: - PENDING - ACTIVE - PAST_DUE - SUSPENDED - CANCELLED -
EXPIRED

## Node

Fields: - id - name - provider - region - hostname - agentVersion -
status - totalCpuMillicores - totalMemoryBytes - totalStorageBytes -
allocatedCpuMillicores - allocatedMemoryBytes - allocatedStorageBytes -
lastHeartbeatAt - createdAt - updatedAt

Node status: - PROVISIONING - ONLINE - DEGRADED - OFFLINE - DRAINING -
MAINTENANCE

Do not rely only on cached allocation counters. Periodically reconcile
them against actual instance state.

## Instance

Fields: - id - userId - subscriptionId - productVariantId -
resourceProfileId - nodeId - name - slug - runtimeId - status - region -
configuration - createdAt - updatedAt - lastHealthAt

Instance status: - PENDING - PROVISIONING - STARTING - ACTIVE -
STOPPED - RESTARTING - ERROR - SUSPENDED - DELETING - DELETED

The instance record must never grant authorization by itself. Every
read/write must verify ownership or admin permission.

## ProvisioningJob

Fields: - id - instanceId - operation - status - idempotencyKey -
attemptCount - lastError - startedAt - completedAt - createdAt

Operations: - CREATE - DELETE - START - STOP - RESTART -
UPDATE_RESOURCES - UPDATE_CONFIGURATION

## Credential

Fields: - id - userId - instanceId - provider - encryptedSecret -
metadata - createdAt - updatedAt

Encrypt secrets at rest.

Never return the plaintext secret from normal list APIs.

## InstanceDomain

Fields: - id - instanceId - hostname - type - verificationStatus -
tlsStatus - createdAt - updatedAt

Types: - SYSTEM_SUBDOMAIN - CUSTOM_DOMAIN

## SupportTicket

Fields: - id - userId - subject - status - priority - createdAt -
updatedAt

Messages should be stored separately.

## AuditLog

Fields: - id - actorUserId - action - resourceType - resourceId -
metadata - ipAddress - userAgent - createdAt

Never store secrets in metadata.

## WebhookEvent

Fields: - id - provider - externalEventId - eventType -
signatureVerified - payloadHash - processedAt - createdAt

Unique constraint on provider + externalEventId.

This is required for webhook idempotency.

## Download

For digital products: - id - userId - productId - assetId -
downloadCount - lastDownloadedAt - createdAt

Private assets must be served through authorization-controlled
downloads.

## Database principles

- Use UUIDs or secure opaque identifiers.
- Add indexes to ownership and lookup fields.
- Use foreign keys.
- Use unique constraints for business invariants.
- Use transactions for payment/order state changes.
- Do not store arbitrary secrets in JSON without encryption.
- Do not put authentication state in client-controlled JSON.
