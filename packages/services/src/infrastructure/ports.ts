import type { ResourceProfileRecord } from '../resources/types.js';
import type { InstanceRecord, NodeHeartbeatInput, NodeRecord, ProvisioningJobRecord } from './types.js';

export interface NodeRepository {
  register(input: Omit<NodeRecord, 'id' | 'lastHeartbeatAt' | 'allocatedCpuMillicores' | 'allocatedMemoryBytes' | 'allocatedStorageBytes'>): Promise<NodeRecord>;
  findById(id: string): Promise<NodeRecord | null>;
  list(): Promise<NodeRecord[]>;
  heartbeat(nodeId: string, input: NodeHeartbeatInput): Promise<NodeRecord | null>;
  setEnabled(nodeId: string, enabled: boolean): Promise<NodeRecord | null>;
}

export interface InstanceRepository {
  create(input: Omit<InstanceRecord, 'runtimeId' | 'lastHealthAt'>): Promise<InstanceRecord>;
  findById(id: string): Promise<InstanceRecord | null>;
  findByIdForUser(userId: string, id: string): Promise<InstanceRecord | null>;
  findOwnerUserId(id: string): Promise<string | null>;
  listForUser(userId: string): Promise<InstanceRecord[]>;
  transition(id: string, from: readonly InstanceRecord['status'][], to: InstanceRecord['status']): Promise<boolean>;
  updateRuntime(id: string, runtimeId: string | null, status: InstanceRecord['status']): Promise<InstanceRecord | null>;
}

export interface ProvisioningJobRepository {
  findByIdempotencyKey(key: string): Promise<ProvisioningJobRecord | null>;
  create(input: Omit<ProvisioningJobRecord, 'id' | 'attemptCount' | 'errorCategory' | 'lastError'>): Promise<ProvisioningJobRecord>;
  markRunning(id: string): Promise<ProvisioningJobRecord | null>;
  markSucceeded(id: string): Promise<ProvisioningJobRecord | null>;
  markFailed(id: string, category: string, message: string): Promise<ProvisioningJobRecord | null>;
}

export interface NodeAgentPort {
  createInstance(input: {
    instanceId: string;
    serviceType: string;
    image: string;
    profile: ResourceProfileRecord;
    configuration: Readonly<Record<string, string>>;
    idempotencyKey: string;
  }): Promise<{ runtimeId: string; status: 'RUNNING' | 'STOPPED' | 'ERROR' | 'UNKNOWN' }>;
  startInstance(id: string): Promise<{ runtimeId: string }>;
  stopInstance(id: string): Promise<{ runtimeId: string }>;
  restartInstance(id: string): Promise<{ runtimeId: string }>;
  removeInstance(id: string): Promise<void>;
  inspectInstance(id: string): Promise<unknown>;
  collectMetrics(id: string): Promise<unknown>;
  retrieveLogs(id: string, options?: { tail?: number; cursor?: string }): Promise<unknown>;
}

export interface PaidOrderProvisioningInput {
  orderId: string;
  userId: string;
  productVariantId: string;
  resourceProfile: ResourceProfileRecord;
  serviceType: string;
  image: string;
  configuration: Readonly<Record<string, string>>;
  name: string;
  slug: string;
  region: string | null;
}

export interface PaidOrderReader {
  getPaidOrder(input: { orderId: string; userId: string; productVariantId: string }): Promise<PaidOrderProvisioningInput | null>;
}