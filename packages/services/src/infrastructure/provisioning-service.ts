import type { Clock } from '../clock.js';
import { infrastructureError, INFRASTRUCTURE_MESSAGES } from './errors.js';
import type { InstanceRepository, NodeAgentPort, PaidOrderReader, ProvisioningJobRepository } from './ports.js';
import type { NodeScheduler } from './scheduler.js';
import type { ProvisioningJobRecord, ProvisioningOperation } from './types.js';

export class ProvisioningService {
  constructor(private readonly dependencies: { jobs: ProvisioningJobRepository; instances: InstanceRepository; nodes: NodeScheduler; agent: NodeAgentPort; orders: PaidOrderReader; clock?: Clock }) {}

  async provision(input: { orderId: string; userId: string; productVariantId: string; idempotencyKey: string }): Promise<ProvisioningJobRecord> {
    const existing = await this.dependencies.jobs.findByIdempotencyKey(input.idempotencyKey);
    if (existing !== null) return existing;
    const order = await this.dependencies.orders.getPaidOrder(input);
    if (order === null) throw infrastructureError('CONFLICT', INFRASTRUCTURE_MESSAGES.provisioningNotEligible);
    const node = await this.dependencies.nodes.select({ cpuMillicores: order.resourceProfile.cpuLimitMillicores, memoryBytes: order.resourceProfile.memoryLimitBytes, storageBytes: order.resourceProfile.diskLimitBytes, region: order.region });
    const instance = await this.dependencies.instances.create({ id: crypto.randomUUID(), userId: order.userId, productVariantId: order.productVariantId, resourceProfileId: order.resourceProfile.id, nodeId: node.id, name: order.name, slug: order.slug, status: 'PENDING', region: order.region, configuration: Object.fromEntries(Object.entries(order.configuration)) });
    const job = await this.dependencies.jobs.create({ instanceId: instance.id, nodeId: node.id, operation: 'CREATE' as ProvisioningOperation, status: 'PENDING', idempotencyKey: input.idempotencyKey });
    await this.dependencies.jobs.markRunning(job.id);
    await this.dependencies.instances.transition(instance.id, ['PENDING'], 'PROVISIONING');
    try { const result = await this.dependencies.agent.createInstance({ instanceId: instance.id, serviceType: order.serviceType, image: order.image, profile: order.resourceProfile, configuration: order.configuration, idempotencyKey: input.idempotencyKey }); await this.dependencies.instances.updateRuntime(instance.id, result.runtimeId, result.status === 'RUNNING' ? 'ACTIVE' : 'ERROR'); const completed = await this.dependencies.jobs.markSucceeded(job.id); if (completed === null) throw new Error('Provisioning job disappeared.'); return completed; } catch (error) { await this.dependencies.instances.updateRuntime(instance.id, null, 'ERROR'); const failed = await this.dependencies.jobs.markFailed(job.id, 'PROVISIONING_FAILURE', INFRASTRUCTURE_MESSAGES.provisioningFailed); if (failed === null) throw error; return failed; }
  }
}