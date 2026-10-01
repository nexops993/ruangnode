import { createInMemoryCommerceStore } from '../testing/in-memory-commerce-store-orders.js';
import type { PaymentProviderAdapter } from './types.js';
import { PaymentService } from './payment-service.js';
import { assertPaymentTransitionAllowed } from './state.js';
import { describe, expect, it } from 'vitest';

const OWNER = '00000000-0000-7000-8000-000000000001';
const OTHER_OWNER = '00000000-0000-7000-8000-000000000002';

function provider(): PaymentProviderAdapter {
  return {
    provider: 'test',
    async createPayment(input) {
      return { providerPaymentId: `provider-${input.orderId}`, rawReference: 'checkout-reference' };
    },
    async verifyWebhook(input) {
      if (input.signature !== 'valid-signature' || typeof input.payload !== 'object' || input.payload === null) return null;
      const payload = input.payload as Record<string, unknown>;
      if (
        typeof payload.eventId !== 'string' ||
        typeof payload.providerPaymentId !== 'string' ||
        typeof payload.status !== 'string' ||
        typeof payload.amountMinor !== 'string' ||
        typeof payload.currency !== 'string'
      ) return null;
      return {
        externalEventId: payload.eventId,
        eventType: 'payment.updated',
        providerPaymentId: payload.providerPaymentId,
        status: payload.status as 'PAID' | 'FAILED',
        amountMinor: BigInt(payload.amountMinor),
        currency: payload.currency,
        rawReference: null,
      };
    },
  };
}

async function orderFor(store: ReturnType<typeof createInMemoryCommerceStore>, userId = OWNER): Promise<string> {
  const order = await store.orders.create({
    userId,
    status: 'PENDING',
    currency: 'USD',
    subtotalMinor: 1250n,
    discountMinor: 0n,
    totalMinor: 1250n,
    expiresAt: null,
    items: [],
  });
  return order.id;
}

function service(store: ReturnType<typeof createInMemoryCommerceStore>): PaymentService {
  return new PaymentService({ store, providers: new Map([['test', provider()]]) });
}

describe('PaymentService', () => {
  it('creates a payment using the persisted order total', async () => {
    const store = createInMemoryCommerceStore();
    const orderId = await orderFor(store);
    const payment = await service(store).createPayment(OWNER, orderId, 'test');

    expect(payment.amount).toEqual({ amount: '1250', currency: 'USD' });
    expect(payment.status).toBe('PENDING');
  });

  it('hides another customer order and ignores client amount input by API design', async () => {
    const store = createInMemoryCommerceStore();
    const orderId = await orderFor(store, OTHER_OWNER);

    await expect(service(store).createPayment(OWNER, orderId, 'test')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('processes a verified webhook once and marks the order paid', async () => {
    const store = createInMemoryCommerceStore();
    const orderId = await orderFor(store);
    const payment = await service(store).createPayment(OWNER, orderId, 'test');
    const payload = {
      eventId: 'evt-1',
      providerPaymentId: payment.providerPaymentId,
      amountMinor: '1250',
      currency: 'USD',
      status: 'PAID',
    };

    const first = await service(store).processWebhook('test', payload, 'valid-signature');
    const second = await service(store).processWebhook('test', payload, 'valid-signature');

    expect(first.duplicate).toBe(false);
    expect(first.payment?.status).toBe('PAID');
    expect(second.duplicate).toBe(true);
    expect((await store.orders.findById(orderId))?.status).toBe('PAID');
  });

  it('rejects an unverified webhook and unknown payment without changing an order', async () => {
    const store = createInMemoryCommerceStore();
    await expect(service(store).processWebhook('test', {}, 'bad-signature')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const result = await service(store).processWebhook('test', {
      eventId: 'evt-unknown',
      providerPaymentId: 'missing',
      amountMinor: '1250',
      currency: 'USD',
      status: 'PAID',
    }, 'valid-signature');
    expect(result.payment).toBeNull();
    expect(result.duplicate).toBe(false);
  });

  it('keeps payment state transitions strict', () => {
    expect(() => assertPaymentTransitionAllowed('PAID', 'FAILED')).toThrow(/not allowed/);
    expect(() => assertPaymentTransitionAllowed('PENDING', 'PROCESSING')).not.toThrow();
  });
});