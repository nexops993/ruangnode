import { OrderStatus } from '@ruangnode/database';
import { AppError } from '@ruangnode/shared';
import { describe, expect, it } from 'vitest';

import {
  assertOrderTransitionAllowed,
  assertPaymentPhaseAllows,
  canCustomerCancel,
  canTransitionOrderStatus,
  INITIAL_ORDER_STATUS,
  isPaymentDrivenTransition,
  ORDER_STATUS_TRANSITIONS,
  PAYMENT_DRIVEN_ORDER_TARGETS,
} from './state.js';

function expectConflict(fn: () => unknown): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('CONFLICT');
    expect((error as AppError).httpStatus).toBe(409);

    return;
  }

  throw new Error('Expected the transition to be refused.');
}

describe('order state machine', () => {
  it('models every status of the OrderStatus enum exactly once', () => {
    expect(Object.keys(ORDER_STATUS_TRANSITIONS).sort()).toEqual([...Object.values(OrderStatus)].sort());
    expect(INITIAL_ORDER_STATUS).toBe('PENDING');
  });

  it('allows only the transitions the documentation defines', () => {
    expect(canTransitionOrderStatus('PENDING', 'CANCELLED')).toBe(true);
    expect(canTransitionOrderStatus('PENDING', 'FAILED')).toBe(true);
    expect(canTransitionOrderStatus('PENDING', 'EXPIRED')).toBe(true);
    expect(canTransitionOrderStatus('PENDING', 'PAID')).toBe(true);
    expect(canTransitionOrderStatus('PAID', 'REFUNDED')).toBe(true);

    // Terminal states never move again.
    expect(canTransitionOrderStatus('CANCELLED', 'PENDING')).toBe(false);
    expect(canTransitionOrderStatus('CANCELLED', 'PAID')).toBe(false);
    expect(canTransitionOrderStatus('FAILED', 'PAID')).toBe(false);
    expect(canTransitionOrderStatus('EXPIRED', 'PAID')).toBe(false);
    expect(canTransitionOrderStatus('REFUNDED', 'PAID')).toBe(false);
    // A paid order can never be cancelled: that is what refunds are for.
    expect(canTransitionOrderStatus('PAID', 'CANCELLED')).toBe(false);
  });

  it('reports a refused transition as a structured conflict', () => {
    expectConflict(() => assertOrderTransitionAllowed('CANCELLED', 'PENDING'));
    expect(() => assertOrderTransitionAllowed('PENDING', 'CANCELLED')).not.toThrow();
  });

  it('keeps payment-driven targets unavailable until the payment phase', () => {
    for (const target of PAYMENT_DRIVEN_ORDER_TARGETS) {
      expect(isPaymentDrivenTransition(target)).toBe(true);

      try {
        assertPaymentPhaseAllows(target);
        throw new Error(`Expected ${target} to be gated by the payment phase.`);
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe('SERVICE_UNAVAILABLE');
        expect((error as AppError).httpStatus).toBe(503);
        expect((error as AppError).message).toBe('Payment processing is not available yet.');
      }
    }

    expect(isPaymentDrivenTransition('CANCELLED')).toBe(false);
    expect(() => assertPaymentPhaseAllows('CANCELLED')).not.toThrow();
  });

  it('lets a customer cancel only an unpaid order', () => {
    expect(canCustomerCancel('PENDING')).toBe(true);
    expect(canCustomerCancel('PAID')).toBe(false);
    expect(canCustomerCancel('CANCELLED')).toBe(false);
    expect(canCustomerCancel('FAILED')).toBe(false);
    expect(canCustomerCancel('EXPIRED')).toBe(false);
    expect(canCustomerCancel('REFUNDED')).toBe(false);
  });
});
