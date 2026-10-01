import type { PaymentStatus } from '@ruangnode/database';

import type { MoneyJson } from '../money.js';

export type { PaymentStatus };

export interface PaymentRecord {
  id: string;
  orderId: string;
  provider: string;
  providerPaymentId: string;
  status: PaymentStatus;
  amountMinor: bigint;
  currency: string;
  paidAt: Date | null;
  rawReference: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentView {
  id: string;
  orderId: string;
  provider: string;
  providerPaymentId: string;
  status: PaymentStatus;
  amount: MoneyJson;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookEventRecord {
  id: string;
  provider: string;
  externalEventId: string;
  eventType: string | null;
  signatureVerified: boolean;
  payloadHash: string;
  processedAt: Date | null;
  processingError: string | null;
  createdAt: Date;
}

export interface AuditEvent {
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
  createdAt?: Date;
}

export type VerifiedPaymentWebhook = {
  externalEventId: string;
  eventType: string;
  providerPaymentId: string;
  status: PaymentStatus;
  amountMinor: bigint;
  currency: string;
  rawReference: string | null;
};

export interface PaymentProviderAdapter {
  readonly provider: string;
  createPayment(input: {
    orderId: string;
    amountMinor: bigint;
    currency: string;
  }): Promise<{ providerPaymentId: string; rawReference: string | null }>;
  verifyWebhook(input: { payload: unknown; signature: string | undefined }): Promise<VerifiedPaymentWebhook | null>;
}