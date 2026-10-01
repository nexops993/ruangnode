import { infrastructureError, INFRASTRUCTURE_MESSAGES } from './errors.js';
import type { InstanceRepository, NodeAgentPort } from './ports.js';
import type { InstanceRecord, InstanceStatus } from './types.js';

const transitions: Readonly<Record<InstanceStatus, readonly InstanceStatus[]>> = {
  PENDING: ['PROVISIONING', 'DELETING'], PROVISIONING: ['STARTING', 'ERROR', 'DELETING'], STARTING: ['ACTIVE', 'ERROR'], ACTIVE: ['STOPPED', 'RESTARTING', 'DELETING', 'ERROR'], STOPPED: ['STARTING', 'DELETING'], RESTARTING: ['ACTIVE', 'ERROR'], ERROR: ['PROVISIONING', 'DELETING'], SUSPENDED: ['STARTING', 'DELETING'], DELETING: ['DELETED', 'ERROR'], DELETED: [],
};

export function canTransition(from: InstanceStatus, to: InstanceStatus): boolean { return (transitions[from] ?? []).includes(to); }

export class InstanceService {
  constructor(private readonly instances: InstanceRepository, private readonly agent: NodeAgentPort) {}

  async listForUser(userId: string): Promise<InstanceRecord[]> { return this.instances.listForUser(userId); }
  async getForUser(userId: string, id: string): Promise<InstanceRecord> { const instance = await this.instances.findByIdForUser(userId, id); if (instance === null) throw infrastructureError('NOT_FOUND', INFRASTRUCTURE_MESSAGES.instanceNotFound); return instance; }

  async start(userId: string, id: string): Promise<InstanceRecord> { return this.run(userId, id, ['STOPPED', 'SUSPENDED'], 'STARTING', (value) => this.agent.startInstance(value)); }
  async stop(userId: string, id: string): Promise<InstanceRecord> { return this.run(userId, id, ['ACTIVE'], 'STOPPED', (value) => this.agent.stopInstance(value)); }
  async restart(userId: string, id: string): Promise<InstanceRecord> { return this.run(userId, id, ['ACTIVE', 'STOPPED'], 'RESTARTING', (value) => this.agent.restartInstance(value)); }
  async destroy(userId: string, id: string): Promise<InstanceRecord> {
    const instance = await this.getForUser(userId, id);
    if (!canTransition(instance.status, 'DELETING')) throw infrastructureError('CONFLICT', INFRASTRUCTURE_MESSAGES.invalidTransition);
    if (!(await this.instances.transition(id, [instance.status], 'DELETING'))) throw infrastructureError('CONFLICT', INFRASTRUCTURE_MESSAGES.invalidTransition);
    await this.agent.removeInstance(id);
    const updated = await this.instances.updateRuntime(id, null, 'DELETED');
    if (updated === null) throw infrastructureError('NOT_FOUND', INFRASTRUCTURE_MESSAGES.instanceNotFound);
    return updated;
  }

  async metrics(userId: string, id: string): Promise<unknown> {
    await this.getForUser(userId, id);
    return this.agent.collectMetrics(id);
  }

  async logs(userId: string, id: string, options?: { tail?: number; cursor?: string }): Promise<unknown> {
    await this.getForUser(userId, id);
    return this.agent.retrieveLogs(id, options);
  }

  private async run(userId: string, id: string, allowed: readonly InstanceStatus[], target: InstanceStatus, operation: (id: string) => Promise<{ runtimeId: string }>): Promise<InstanceRecord> {
    const instance = await this.getForUser(userId, id);
    if (!allowed.includes(instance.status) || !canTransition(instance.status, target)) throw infrastructureError('CONFLICT', INFRASTRUCTURE_MESSAGES.invalidTransition);
    if (!(await this.instances.transition(id, [instance.status], target))) throw infrastructureError('CONFLICT', INFRASTRUCTURE_MESSAGES.invalidTransition);
    try { const result = await operation(id); const finalStatus = target === 'STARTING' || target === 'RESTARTING' ? 'ACTIVE' : target; const updated = await this.instances.updateRuntime(id, result.runtimeId, finalStatus); if (updated === null) throw infrastructureError('NOT_FOUND', INFRASTRUCTURE_MESSAGES.instanceNotFound); return updated; } catch (error) { await this.instances.updateRuntime(id, instance.runtimeId, 'ERROR'); throw error; }
  }
}