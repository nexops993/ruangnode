import { invalidStateTransitionError } from '../errors.js';
import type { PaymentStatus } from './types.js';

export const PAYMENT_STATUS_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  PENDING: ['PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED'],
  PROCESSING: ['PAID', 'FAILED', 'CANCELLED', 'EXPIRED'],
  PAID: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
  REFUNDED: [],
};

export function assertPaymentTransitionAllowed(from: PaymentStatus, to: PaymentStatus): void {
  if (!(PAYMENT_STATUS_TRANSITIONS[from] ?? []).includes(to)) {
    throw invalidStateTransitionError(`This payment status change is not allowed (${from} → ${to}).`);
  }
}