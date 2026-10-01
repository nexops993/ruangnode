import { describe, expect, it, vi } from 'vitest';
import { InstanceService } from './instance-service.js';
import { ProvisioningService } from './provisioning-service.js';
import type { InstanceRepository, NodeAgentPort, ProvisioningJobRepository } from './ports.js';
import type { InstanceRecord, ProvisioningJobRecord } from './types.js';

const instance: InstanceRecord = { id: 'instance-1', userId: 'user-1', productVariantId: 'variant-1', resourceProfileId: 'profile-1', nodeId: 'node-1', name: 'demo', slug: 'demo', runtimeId: 'runtime-1', status: 'ACTIVE', region: null, configuration: {}, lastHealthAt: null };

function instanceRepository(): InstanceRepository & { updated: Array<{ runtimeId: string | null; status: InstanceRecord['status'] }> } {
  const updated: Array<{ runtimeId: string | null; status: InstanceRecord['status'] }> = [];
  return { updated, create: vi.fn(), findById: vi.fn(async () => instance), findByIdForUser: vi.fn(async () => instance), findOwnerUserId: vi.fn(), listForUser: vi.fn(), listByStatuses: vi.fn(), transition: vi.fn(async () => true), updateRuntime: vi.fn(async (_id, runtimeId, status) => { updated.push({ runtimeId, status }); return { ...instance, runtimeId, status }; }) };
}

describe('infrastructure lifecycle services', () => {
  it('returns the existing provisioning job for a repeated idempotency key', async () => {
    const existing: ProvisioningJobRecord = { id: 'job-1', instanceId: instance.id, nodeId: instance.nodeId, operation: 'CREATE', status: 'SUCCEEDED', idempotencyKey: 'key-1', attemptCount: 1, errorCategory: null, lastError: null };
    const jobs = { findByIdempotencyKey: vi.fn(async () => existing) } as unknown as ProvisioningJobRepository;
    const service = new ProvisioningService({ jobs, instances: {} as InstanceRepository, nodes: {} as never, agent: {} as NodeAgentPort, orders: {} as never });
    await expect(service.provision({ orderId: 'order-1', userId: 'user-1', productVariantId: 'variant-1', idempotencyKey: 'key-1' })).resolves.toBe(existing);
  });

  it('moves an active instance to error when a stop operation fails', async () => {
    const repository = instanceRepository();
    const agent = { stopInstance: vi.fn(async () => { throw new Error('agent offline'); }) } as unknown as NodeAgentPort;
    await expect(new InstanceService(repository, agent).stop('user-1', instance.id)).rejects.toThrow('agent offline');
    expect(repository.updated).toEqual([{ runtimeId: 'runtime-1', status: 'ERROR' }]);
  });
});
