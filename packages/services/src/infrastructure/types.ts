export type NodeStatus = 'PROVISIONING' | 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'DRAINING' | 'MAINTENANCE';
export type InstanceStatus = 'PENDING' | 'PROVISIONING' | 'STARTING' | 'ACTIVE' | 'STOPPED' | 'RESTARTING' | 'ERROR' | 'SUSPENDED' | 'DELETING' | 'DELETED';
export type ProvisioningJobStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export type ProvisioningOperation = 'CREATE' | 'DELETE' | 'START' | 'STOP' | 'RESTART' | 'UPDATE_RESOURCES' | 'UPDATE_CONFIGURATION';

export interface NodeRecord {
  id: string;
  name: string;
  provider: string | null;
  region: string | null;
  hostname: string;
  agentVersion: string | null;
  status: NodeStatus;
  totalCpuMillicores: number;
  totalMemoryBytes: bigint;
  totalStorageBytes: bigint;
  reservedCpuMillicores: number;
  reservedMemoryBytes: bigint;
  reservedStorageBytes: bigint;
  allocatedCpuMillicores: number;
  allocatedMemoryBytes: bigint;
  allocatedStorageBytes: bigint;
  lastHeartbeatAt: Date | null;
}

export interface NodeHeartbeatInput {
  agentVersion: string;
  uptimeSeconds: bigint;
  totalCpuMillicores: number;
  totalMemoryBytes: bigint;
  totalStorageBytes: bigint;
  allocatedCpuMillicores: number;
  allocatedMemoryBytes: bigint;
  allocatedStorageBytes: bigint;
  dockerHealthy: boolean;
  reportedStatus: NodeStatus;
  observedAt: Date;
}

export interface InstanceRecord {
  id: string;
  userId: string;
  productVariantId: string;
  resourceProfileId: string;
  nodeId: string | null;
  name: string;
  slug: string;
  runtimeId: string | null;
  status: InstanceStatus;
  region: string | null;
  configuration: Record<string, unknown> | null;
  lastHealthAt: Date | null;
}

export interface ProvisioningJobRecord {
  id: string;
  instanceId: string;
  nodeId: string | null;
  operation: ProvisioningOperation;
  status: ProvisioningJobStatus;
  idempotencyKey: string;
  attemptCount: number;
  errorCategory: string | null;
  lastError: string | null;
}