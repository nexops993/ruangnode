import { infrastructureError, INFRASTRUCTURE_MESSAGES } from './errors.js';
import type { NodeRepository } from './ports.js';
import type { NodeRecord } from './types.js';

export interface ScheduleRequirements {
  cpuMillicores: number;
  memoryBytes: bigint;
  storageBytes: bigint;
  region?: string | null;
  now?: Date;
  heartbeatTtlMs?: number;
}

export function availableNodeResources(node: NodeRecord): { cpuMillicores: number; memoryBytes: bigint; storageBytes: bigint } {
  return {
    cpuMillicores: node.totalCpuMillicores - node.reservedCpuMillicores - node.allocatedCpuMillicores,
    memoryBytes: node.totalMemoryBytes - node.reservedMemoryBytes - node.allocatedMemoryBytes,
    storageBytes: node.totalStorageBytes - node.reservedStorageBytes - node.allocatedStorageBytes,
  };
}

export function isNodeEligible(node: NodeRecord, requirements: ScheduleRequirements): boolean {
  const now = requirements.now ?? new Date();
  const ttl = requirements.heartbeatTtlMs ?? 120_000;
  if (node.status !== 'ONLINE' || node.lastHeartbeatAt === null || now.getTime() - node.lastHeartbeatAt.getTime() > ttl) return false;
  if (requirements.region !== undefined && requirements.region !== node.region) return false;
  const available = availableNodeResources(node);
  return available.cpuMillicores >= requirements.cpuMillicores && available.memoryBytes >= requirements.memoryBytes && available.storageBytes >= requirements.storageBytes;
}

export class NodeScheduler {
  constructor(private readonly nodes: NodeRepository) {}

  async select(requirements: ScheduleRequirements): Promise<NodeRecord> {
    const candidates = (await this.nodes.list()).filter((node) => isNodeEligible(node, requirements));
    candidates.sort((left, right) => left.id.localeCompare(right.id));
    const selected = candidates[0];
    if (selected === undefined) {
      const all = await this.nodes.list();
      const hasOnline = all.some((node) => node.status === 'ONLINE');
      throw infrastructureError(hasOnline ? 'CONFLICT' : 'SERVICE_UNAVAILABLE', hasOnline ? INFRASTRUCTURE_MESSAGES.insufficientCapacity : INFRASTRUCTURE_MESSAGES.nodeUnavailable);
    }
    return selected;
  }
}