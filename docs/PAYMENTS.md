# RuangNode Payments

## Goal

Support commercial sales without coupling the platform to one payment
provider.

## Provider adapter

Use an abstraction:

``` text
PaymentProvider
  createPayment()
  getPayment()
  verifyWebhook()
  parseWebhook()
  refund()
```

A provider adapter may implement Midtrans, Xendit, Stripe, or another
compliant provider.

## Order flow

``` text
Customer
  |
Create Order
  |
Payment Pending
  |
Checkout
  |
Provider
  |
Webhook
  |
Verify signature
  |
Mark Payment PAID
  |
Mark Order PAID
  |
Create provisioning/subscription action
```

## Webhook security

Every provider webhook must: - verify signature/authenticity - validate
event schema - check amount/currency/order reference - enforce
idempotency - store event ID - process in a transaction where possible

Never trust: - client redirect - client-supplied payment status -
client-supplied amount

## Pricing

Store monetary values safely.

Do not use floating-point arithmetic for money.

Use integer minor units where appropriate.

Example:

``` text
IDR 40,000
```

Store:

``` text
40000
```

with currency:

``` text
IDR
```

## Order states

``` text
PENDING
PAID
FAILED
EXPIRED
CANCELLED
REFUNDED
```

State transitions must be explicit.

## Subscription billing

For recurring products: - current period - next renewal - cancellation -
suspension - grace period

must be stored.

## Wallet

If a wallet/balance system is implemented:

Use a ledger, not only a mutable balance.

Example:

``` text
Wallet
WalletTransaction
```

Transactions: - CREDIT - DEBIT - REFUND - ADJUSTMENT

Balance can be derived/reconciled from ledger entries.

## Refunds

Refund flow must: - create refund record - update payment - update
order - handle service consequences according to product policy - audit
the action

## Digital product delivery

Only paid/authorized orders may access protected downloads.

Use temporary signed links where possible.

## Managed service payment

Provision only after verified payment.

For recurring subscriptions: - define grace period - define suspension
behavior - define deletion retention period

Do not delete immediately unless policy explicitly says so.

## Admin controls

Admin may: - view payment - retry webhook processing - issue permitted
refunds - adjust orders through audited actions

Manual adjustments must be logged.

## Financial auditability

Keep: - provider payment ID - order ID - user - amount - currency -
status - timestamps - webhook event ID

Do not modify historical paid order amounts when a product price
changes.
