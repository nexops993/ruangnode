/**
 * Order state machine.
 *
 * The commercial state of an order is `OrderStatus` (docs/DATABASE.md). It is
 * deliberately separate from `PaymentStatus` and from the provisioning state, and
 * it is *never* taken from a request: a caller asks for a target status and this
 * module decides whether the graph allows it.
 *
 *     PENDING ──paid──▶ PAID ──refunded──▶ REFUNDED
 *        │  ├──failed──▶ FAILED      (payment phase)
 *        │  ├──expired─▶ EXPIRED     (payment deadline, payment phase)
 *        │  └──cancelled▶ CANCELLED  (customer or admin, this phase)
 *
 * Payment-driven targets are **gated**: no payment provider, checkout or webhook
 * exists yet, so any attempt to reach them is refused with
 * `SERVICE_UNAVAILABLE` instead of pretending an order was paid (`.clinerules` →
 * Payments). The gate is the only thing that has to be replaced when the payment
 * phase lands; the graph itself is already correct.
 */
import { invalidStateTransitionError, paymentsUnavailableError } from '../errors.js';
import type { OrderStatus } from './types.js';

/** Who is driving a transition. */
export type OrderTransitionSource = 'CUSTOMER' | 'SYSTEM' | 'PAYMENT';

/**
 * A transition request.
 *
 * A customer-sourced transition carries the authenticated user id, so ownership
 * is part of the request type instead of an optional extra.
 */
export type OrderTransitionRequest =
  | { source: 'CUSTOMER'; ownerUserId: string }
  | { source: 'SYSTEM'; ownerUserId?: string }
  | { source: 'PAYMENT'; ownerUserId?: string };

export const ORDER_STATUS_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING: ['PAID', 'FAILED', 'CANCELLED', 'EXPIRED'],
  PAID: ['REFUNDED'],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
  REFUNDED: [],
};

/** Terminal states: nothing may be written to them again. */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  'CANCELLED',
  'EXPIRED',
  'REFUNDED',
];

/**
 * Targets that require a verified payment or a payment-deadline job.
 * Unreachable until the payment phase (see the module comment).
 */
export const PAYMENT_DRIVEN_ORDER_TARGETS: readonly OrderStatus[] = [
  'PAID',
  'FAILED',
  'EXPIRED',
  'REFUNDED',
];

/** The status a fresh order always starts in. Server-owned. */
export const INITIAL_ORDER_STATUS: OrderStatus = 'PENDING';

export function isPaymentDrivenTransition(to: OrderStatus): boolean {
  return PAYMENT_DRIVEN_ORDER_TARGETS.includes(to);
}

export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

/** Throws `CONFLICT` when the graph does not allow `from → to`. */
export function assertOrderTransitionAllowed(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrderStatus(from, to)) {
    throw invalidStateTransitionError(`This order status change is not allowed (${from} → ${to}).`);
  }
}

/** True when a customer is still allowed to cancel the order themselves. */
export function canCustomerCancel(status: OrderStatus): boolean {
  return status === 'PENDING';
}

/**
 * Refuses payment-driven transitions while the payment phase is not implemented.
 * Kept in one function so the gate is trivial to lift later.
 */
export function assertPaymentPhaseAllows(to: OrderStatus): void {
  if (isPaymentDrivenTransition(to)) {
    throw paymentsUnavailableError();
  }
}
