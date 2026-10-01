import { systemClock, type Clock } from '../clock.js';
import {
  invalidPaymentWebhookError,
  orderNotFoundError,
  paymentNotFoundError,
  paymentProviderUnavailableError,
} from '../errors.js';
import type { CommerceStore } from '../ports.js';
import { assertOrderTransitionAllowed } from '../orders/state.js';
import { toPaymentView } from './serialization.js';
import { assertPaymentTransitionAllowed } from './state.js';
import type { PaymentProviderAdapter, PaymentView, VerifiedPaymentWebhook } from './types.js';

export interface PaymentServiceOptions {
  store: CommerceStore;
  providers: ReadonlyMap<string, PaymentProviderAdapter>;
  clock?: Clock;
}

export interface WebhookResult {
  duplicate: boolean;
  payment: PaymentView | null;
}

export class PaymentService {
  private readonly store: CommerceStore;
  private readonly providers: ReadonlyMap<string, PaymentProviderAdapter>;
  private readonly clock: Clock;

  constructor(options: PaymentServiceOptions) {
    this.store = options.store;
    this.providers = options.providers;
    this.clock = options.clock ?? systemClock;
  }

  async createPayment(userId: string, orderId: string, provider: string): Promise<PaymentView> {
    const adapter = this.providers.get(provider);
    if (adapter === undefined) throw paymentProviderUnavailableError();

    const order = await this.store.orders.findByIdForUser(userId, orderId);
    if (order === null) throw orderNotFoundError();

    const providerPayment = await adapter.createPayment({
      orderId: order.id,
      amountMinor: order.totalMinor,
      currency: order.currency,
    });

    const payment = await this.store.transaction(async (store) => {
      const existing = await store.payments.findByProviderPaymentId(
        provider,
        providerPayment.providerPaymentId,
      );
      if (existing !== null) return existing;

      const created = await store.payments.create({
        orderId: order.id,
        provider,
        providerPaymentId: providerPayment.providerPaymentId,
        status: 'PENDING',
        amountMinor: order.totalMinor,
        currency: order.currency,
        rawReference: providerPayment.rawReference,
      });
      await store.audit.record({
        actorUserId: userId,
        action: 'payment.created',
        resourceType: 'Payment',
        resourceId: created.id,
        metadata: { provider, orderId: order.id },
      });
      return created;
    });

    return toPaymentView(payment);
  }

  async getPaymentForUser(userId: string, paymentId: string): Promise<PaymentView> {
    const payment = await this.store.payments.findById(paymentId);
    if (payment === null) throw paymentNotFoundError();
    const order = await this.store.orders.findByIdForUser(userId, payment.orderId);
    if (order === null) throw paymentNotFoundError();
    return toPaymentView(payment);
  }

  async findOwnerUserId(paymentId: string): Promise<string | null> {
    const payment = await this.store.payments.findById(paymentId);
    if (payment === null) return null;
    const order = await this.store.orders.findById(payment.orderId);
    return order?.userId ?? null;
  }

  async processWebhook(provider: string, payload: unknown, signature: string | undefined): Promise<WebhookResult> {
    const adapter = this.providers.get(provider);
    if (adapter === undefined) throw paymentProviderUnavailableError();
    const verified = await adapter.verifyWebhook({ payload, signature });
    if (verified === null) throw invalidPaymentWebhookError();

    return this.store.transaction(async (store) => {
      const existingEvent = await store.webhooks.find(provider, verified.externalEventId);
      if (existingEvent !== null) {
        const existingPayment = await store.payments.findByProviderPaymentId(
          provider,
          verified.providerPaymentId,
        );
        return { duplicate: true, payment: existingPayment === null ? null : toPaymentView(existingPayment) };
      }

      const event = await store.webhooks.create({
        provider,
        externalEventId: verified.externalEventId,
        eventType: verified.eventType,
        signatureVerified: true,
        payloadHash: verified.externalEventId,
      });
      const payment = await store.payments.findByProviderPaymentId(provider, verified.providerPaymentId);
      if (payment === null) {
        await store.webhooks.markFailed(event.id, 'PAYMENT_NOT_FOUND');
        await store.audit.record({ action: 'payment.webhook.failed', resourceType: 'WebhookEvent', resourceId: event.id, metadata: { provider, reason: 'PAYMENT_NOT_FOUND' } });
        return { duplicate: false, payment: null };
      }
      const order = await store.orders.findById(payment.orderId);
      if (order === null) {
        await store.webhooks.markFailed(event.id, 'ORDER_NOT_FOUND');
        return { duplicate: false, payment: null };
      }
      if (verified.amountMinor !== order.totalMinor || verified.amountMinor !== payment.amountMinor) {
        await store.webhooks.markFailed(event.id, 'AMOUNT_MISMATCH');
        await store.audit.record({ action: 'payment.webhook.failed', resourceType: 'WebhookEvent', resourceId: event.id, metadata: { provider, reason: 'AMOUNT_MISMATCH' } });
        return { duplicate: false, payment: null };
      }
      if (verified.currency !== order.currency || verified.currency !== payment.currency) {
        await store.webhooks.markFailed(event.id, 'CURRENCY_MISMATCH');
        await store.audit.record({ action: 'payment.webhook.failed', resourceType: 'WebhookEvent', resourceId: event.id, metadata: { provider, reason: 'CURRENCY_MISMATCH' } });
        return { duplicate: false, payment: null };
      }

      try {
        assertPaymentTransitionAllowed(payment.status, verified.status);
      } catch {
        await store.webhooks.markFailed(event.id, 'INVALID_PAYMENT_TRANSITION');
        await store.audit.record({ action: 'payment.webhook.failed', resourceType: 'WebhookEvent', resourceId: event.id, metadata: { provider, reason: 'INVALID_PAYMENT_TRANSITION' } });
        return { duplicate: false, payment: null };
      }
      const changed = await store.payments.updateStatus(
        payment.id,
        payment.status,
        verified.status,
        verified.status === 'PAID' ? this.clock.now() : null,
        verified.rawReference,
      );
      if (!changed) return { duplicate: true, payment: toPaymentView(payment) };

      if (verified.status === 'PAID' || verified.status === 'FAILED') {
        const target = verified.status === 'PAID' ? 'PAID' : 'FAILED';
        try {
          assertOrderTransitionAllowed(order.status, target);
        } catch {
          await store.webhooks.markFailed(event.id, 'INVALID_ORDER_TRANSITION');
          return { duplicate: false, payment: null };
        }
        const orderChanged = await store.orders.updateStatus(order.id, order.status, target);
        if (!orderChanged) {
          await store.webhooks.markFailed(event.id, 'ORDER_STATE_CHANGED');
          return { duplicate: false, payment: null };
        }
      }
      await store.webhooks.markProcessed(event.id, this.clock.now());
      await store.audit.record({ action: 'payment.webhook.processed', resourceType: 'Payment', resourceId: payment.id, metadata: { provider, status: verified.status, orderId: order.id } });
      const updated = await store.payments.findById(payment.id);
      return { duplicate: false, payment: updated === null ? null : toPaymentView(updated) };
    });
  }
}

export function deterministicPaymentAdapter(provider = 'test'): PaymentProviderAdapter {
  return {
    provider,
    async createPayment(input) {
      return { providerPaymentId: `pay_${input.orderId}`, rawReference: null };
    },
    async verifyWebhook(input) {
      if (input.signature !== 'test-signature' || typeof input.payload !== 'object' || input.payload === null) {
        return null;
      }
      const payload = input.payload as Record<string, unknown>;
      if (
        typeof payload.eventId !== 'string' ||
        typeof payload.providerPaymentId !== 'string' ||
        typeof payload.amountMinor !== 'string' ||
        typeof payload.currency !== 'string' ||
        typeof payload.status !== 'string'
      ) return null;
      return {
        externalEventId: payload.eventId,
        eventType: typeof payload.eventType === 'string' ? payload.eventType : 'payment.updated',
        providerPaymentId: payload.providerPaymentId,
        status: payload.status as VerifiedPaymentWebhook['status'],
        amountMinor: BigInt(payload.amountMinor),
        currency: payload.currency,
        rawReference: null,
      };
    },
  };
}