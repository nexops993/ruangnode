import { Prisma, type PrismaClient } from '@ruangnode/database';
import type { InstanceRepository, NodeRepository, PaidOrderReader, ProvisioningJobRepository } from '../infrastructure/ports.js';
import { nodeTokenMatches, type NodeCredentialStore } from '../infrastructure/node-registry.js';
import type { InstanceRecord, NodeRecord, ProvisioningJobRecord } from '../infrastructure/types.js';
import type { ResourceProfileRecord } from '../resources/types.js';

type Client = PrismaClient | Prisma.TransactionClient;

function jsonValue(value: Record<string, unknown> | null): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  return value === null ? Prisma.DbNull : value as Prisma.InputJsonValue;
}

function profile(row: { id: string; name: string; cpuLimit: number; memoryLimitBytes: bigint; memorySwapPolicy: ResourceProfileRecord['memorySwapPolicy']; memorySwapBytes: bigint | null; diskLimitBytes: bigint; diskPolicy: ResourceProfileRecord['diskPolicy']; pidsLimit: number; networkPolicy: string | null; description: string | null; active: boolean; createdAt: Date; updatedAt: Date }): ResourceProfileRecord {
  return { id: row.id, name: row.name, cpuLimitMillicores: row.cpuLimit, memoryLimitBytes: row.memoryLimitBytes, memorySwapPolicy: row.memorySwapPolicy, memorySwapBytes: row.memorySwapBytes, diskLimitBytes: row.diskLimitBytes, diskPolicy: row.diskPolicy, pidsLimit: row.pidsLimit, networkPolicy: row.networkPolicy, description: row.description, active: row.active, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function node(row: { id: string; name: string; provider: string | null; region: string | null; hostname: string; agentVersion: string | null; status: NodeRecord['status']; totalCpuMillicores: number; totalMemoryBytes: bigint; totalStorageBytes: bigint; reservedCpuMillicores: number; reservedMemoryBytes: bigint; reservedStorageBytes: bigint; allocatedCpuMillicores: number; allocatedMemoryBytes: bigint; allocatedStorageBytes: bigint; lastHeartbeatAt: Date | null }): NodeRecord {
  return row;
}

function instance(row: { id: string; userId: string; productVariantId: string; resourceProfileId: string; nodeId: string | null; name: string; slug: string; runtimeId: string | null; status: InstanceRecord['status']; region: string | null; configuration: unknown; lastHealthAt: Date | null }): InstanceRecord {
  return { ...row, configuration: row.configuration === null || typeof row.configuration !== 'object' ? null : row.configuration as Record<string, unknown> };
}

function job(row: { id: string; instanceId: string; nodeId: string | null; operation: ProvisioningJobRecord['operation']; status: ProvisioningJobRecord['status']; idempotencyKey: string; attemptCount: number; errorCategory: string | null; lastError: string | null }): ProvisioningJobRecord { return row; }

export interface PrismaInfrastructureStore {
  nodes: NodeRepository;
  instances: InstanceRepository;
  jobs: ProvisioningJobRepository;
  credentials: NodeCredentialStore;
  paidOrders: PaidOrderReader;
}

export function createPrismaInfrastructureStore(prisma: PrismaClient): PrismaInfrastructureStore {
  return build(prisma);
}

function build(client: Client): PrismaInfrastructureStore {
  const nodes: NodeRepository = {
    async register(input) { return node(await client.node.create({ data: { ...input, allocatedCpuMillicores: 0, allocatedMemoryBytes: 0n, allocatedStorageBytes: 0n } })); },
    async findById(id) { const row = await client.node.findUnique({ where: { id } }); return row === null ? null : node(row); },
    async list() { return (await client.node.findMany({ orderBy: { id: 'asc' } })).map(node); },
    async heartbeat(nodeId, input) {
      const updated = await client.node.updateMany({ where: { id: nodeId }, data: { agentVersion: input.agentVersion, totalCpuMillicores: input.totalCpuMillicores, totalMemoryBytes: input.totalMemoryBytes, totalStorageBytes: input.totalStorageBytes, allocatedCpuMillicores: input.allocatedCpuMillicores, allocatedMemoryBytes: input.allocatedMemoryBytes, allocatedStorageBytes: input.allocatedStorageBytes, lastHeartbeatAt: input.observedAt, status: input.dockerHealthy ? 'ONLINE' : 'DEGRADED' } });
      if (updated.count === 0) return null;
      await client.nodeHeartbeat.create({ data: { nodeId, agentVersion: input.agentVersion, uptimeSeconds: input.uptimeSeconds, totalCpuMillicores: input.totalCpuMillicores, totalMemoryBytes: input.totalMemoryBytes, totalStorageBytes: input.totalStorageBytes, allocatedCpuMillicores: input.allocatedCpuMillicores, allocatedMemoryBytes: input.allocatedMemoryBytes, allocatedStorageBytes: input.allocatedStorageBytes, dockerHealthy: input.dockerHealthy, reportedStatus: input.reportedStatus, createdAt: input.observedAt } });
      const row = await client.node.findUnique({ where: { id: nodeId } });
      return row === null ? null : node(row);
    },
    async setEnabled(nodeId, enabled) { const row = await client.node.updateMany({ where: { id: nodeId }, data: { status: enabled ? 'ONLINE' : 'MAINTENANCE' } }); if (row.count === 0) return null; const result = await client.node.findUnique({ where: { id: nodeId } }); return result === null ? null : node(result); },
  };

  const instances: InstanceRepository = {
    async create(input) { return instance(await client.instance.create({ data: { ...input, configuration: jsonValue(input.configuration) } })); },
    async findById(id) { const row = await client.instance.findUnique({ where: { id } }); return row === null ? null : instance(row); },
    async findByIdForUser(userId, id) { const row = await client.instance.findFirst({ where: { id, userId } }); return row === null ? null : instance(row); },
    async findOwnerUserId(id) { const row = await client.instance.findUnique({ where: { id }, select: { userId: true } }); return row?.userId ?? null; },
    async listForUser(userId) { return (await client.instance.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })).map(instance); },
    async listByStatuses(statuses) { return (await client.instance.findMany({ where: { status: { in: [...statuses] } }, orderBy: { createdAt: 'asc' } })).map(instance); },
    async transition(id, from, to) { const result = await client.instance.updateMany({ where: { id, status: { in: [...from] } }, data: { status: to } }); return result.count === 1; },
    async updateRuntime(id, runtimeId, status) { const row = await client.instance.update({ where: { id }, data: { runtimeId, status, ...(status === 'ACTIVE' ? { lastHealthAt: new Date() } : {}) } }); return instance(row); },
  };

  const jobs: ProvisioningJobRepository = {
    async findByIdempotencyKey(idempotencyKey) { const row = await client.provisioningJob.findUnique({ where: { idempotencyKey } }); return row === null ? null : job(row); },
    async listByStatuses(statuses) { return (await client.provisioningJob.findMany({ where: { status: { in: [...statuses] } }, orderBy: { createdAt: 'asc' } })).map(job); },
    async create(input) { return job(await client.provisioningJob.create({ data: input })); },
    async markRunning(id) { const row = await client.provisioningJob.update({ where: { id }, data: { status: 'RUNNING', attemptCount: { increment: 1 }, startedAt: new Date() } }); return job(row); },
    async markSucceeded(id) { const row = await client.provisioningJob.update({ where: { id }, data: { status: 'SUCCEEDED', completedAt: new Date() } }); return job(row); },
    async markFailed(id, category, message) { const row = await client.provisioningJob.update({ where: { id }, data: { status: 'FAILED', errorCategory: category, lastError: message, completedAt: new Date() } }); return job(row); },
  };

  const credentials: NodeCredentialStore = {
    async saveHash(nodeId: string, tokenHash: string) { await client.node.update({ where: { id: nodeId }, data: { agentTokenHash: tokenHash } }); },
    async matches(nodeId: string, tokenHash: string) { const row = await client.node.findUnique({ where: { id: nodeId }, select: { agentTokenHash: true } }); return row?.agentTokenHash === null || row?.agentTokenHash === undefined ? false : nodeTokenMatches(row.agentTokenHash, tokenHash); },
  };

  const paidOrders: PaidOrderReader = {
    async getPaidOrder(input) {
      const order = await client.order.findFirst({ where: { id: input.orderId, userId: input.userId, status: 'PAID', items: { some: { productVariantId: input.productVariantId } } }, include: { items: { where: { productVariantId: input.productVariantId }, take: 1, include: { productVariant: { include: { product: true, resourceProfile: true } } } } } });
      const item = order?.items[0];
      const resource = item?.productVariant.resourceProfile;
      if (order === null || item === undefined || resource === null || resource === undefined) return null;
      return { orderId: order.id, userId: order.userId, productVariantId: item.productVariantId, resourceProfile: profile(resource), serviceType: item.productVariant.product.serviceType ?? 'managed', image: 'ruangnode/service:latest', configuration: {}, name: `instance-${order.id.slice(0, 8)}`, slug: `${order.id.slice(0, 8)}-${item.id.slice(0, 8)}`, region: null };
    },
  };

  return { nodes, instances, jobs, credentials, paidOrders };
}