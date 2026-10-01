import { describe, expect, it, vi } from 'vitest';
import { InfrastructureReconciler } from './reconciler.js';
import type { InstanceRepository, NodeAgentPort, ProvisioningJobRepository } from './ports.js';
import type { InstanceRecord, ProvisioningJobRecord } from './types.js';

const instance: InstanceRecord = { id: 'instance-1', userId: 'user-1', productVariantId: 'variant-1', resourceProfileId: 'profile-1', nodeId: 'node-1', name: 'demo', slug: 'demo', runtimeId: null, status: 'PROVISIONING', region: null, configuration: {}, lastHealthAt: null };
const job: ProvisioningJobRecord = { id: 'job-1', instanceId: instance.id, nodeId: 'node-1', operation: 'CREATE', status: 'RUNNING', idempotencyKey: 'key-1', attemptCount: 1, errorCategory: null, lastError: null };

function repositories(currentJob = job, currentInstance = instance) {
  const updated: Array<{ runtimeId: string | null; status: InstanceRecord['status'] }> = [];
  const instances: InstanceRepository = { create: vi.fn(), findById: vi.fn(async () => currentInstance), findByIdForUser: vi.fn(), findOwnerUserId: vi.fn(), listForUser: vi.fn(), listByStatuses: vi.fn(async () => []), transition: vi.fn(), updateRuntime: vi.fn(async (_id, runtimeId, status) => { updated.push({ runtimeId, status }); return { ...currentInstance, runtimeId, status }; }) };
  const jobs: ProvisioningJobRepository = { findByIdempotencyKey: vi.fn(), listByStatuses: vi.fn(async () => [currentJob]), create: vi.fn(), markRunning: vi.fn(), markSucceeded: vi.fn(async () => currentJob), markFailed: vi.fn(async () => currentJob) };
  return { instances, jobs, updated };
}

describe('infrastructure reconciliation', () => {
  it('recovers a running job from the agent inspection', async () => {
    const agent = { inspectInstance: vi.fn(async () => ({ runtimeId: 'runtime-1', status: 'RUNNING' } )) } as unknown as NodeAgentPort;
    const repositories = repositoriesFor(agent);
    const result = await new InfrastructureReconciler(repositories).reconcile();
    expect(result).toMatchObject({ inspected: 1, recovered: 1, failed: 0 });
    expect(repositories.updated).toEqual([{ runtimeId: 'runtime-1', status: 'ACTIVE' }]);
    expect(repositories.jobs.markSucceeded).toHaveBeenCalledWith('job-1');
  });

  it('marks the job and instance failed when the agent cannot inspect it', async () => {
    const agent = { inspectInstance: vi.fn(async () => { throw new Error('offline'); }) } as unknown as NodeAgentPort;
    const repositories = repositoriesFor(agent);
    const result = await new InfrastructureReconciler(repositories).reconcile();
    expect(result.failed).toBe(1);
    expect(repositories.updated).toEqual([{ runtimeId: null, status: 'ERROR' }]);
    expect(repositories.jobs.markFailed).toHaveBeenCalledWith('job-1', 'RUNTIME_ERROR', expect.any(String));
  });
});

function repositoriesFor(agent: NodeAgentPort) {
  const values = repositories();
  return { jobs: values.jobs, instances: values.instances, agent, updated: values.updated };
}