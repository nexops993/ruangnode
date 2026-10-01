import { toMoneyJson } from '../money.js';
import type { PaymentRecord, PaymentView } from './types.js';

export function toPaymentView(record: PaymentRecord): PaymentView {
  return {
    id: record.id,
    orderId: record.orderId,
    provider: record.provider,
    providerPaymentId: record.providerPaymentId,
    status: record.status,
    amount: toMoneyJson(record.amountMinor, record.currency),
    paidAt: record.paidAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}