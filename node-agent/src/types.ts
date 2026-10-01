export type MemorySwapPolicy = 'DISABLED' | 'EQUAL_TO_MEMORY' | 'BOUNDED';
export type DiskPolicy = 'ENFORCED_QUOTA' | 'ALLOCATED' | 'MONITORED';

export interface AgentResourceProfile {
  cpuLimitMillicores: number;
  memoryLimitBytes: bigint;
  memorySwapPolicy: MemorySwapPolicy;
  memorySwapBytes: bigint | null;
  diskLimitBytes: bigint;
  diskPolicy: DiskPolicy;
  pidsLimit: number;
}

export interface CreateInstanceRequest {
  instanceId: string;
  serviceType: string;
  image: string;
  profile: AgentResourceProfile;
  configuration: Readonly<Record<string, string>>;
  idempotencyKey: string;
}

export interface InstanceInspection {
  instanceId: string;
  runtimeId: string;
  status: 'RUNNING' | 'STOPPED' | 'ERROR' | 'UNKNOWN';
  health: 'HEALTHY' | 'UNHEALTHY' | 'UNKNOWN';
  startedAt: Date | null;
}

export interface InstanceMetrics {
  instanceId: string;
  cpuUsageMillicores: number;
  memoryUsageBytes: bigint;
  memoryLimitBytes: bigint;
  pidCount: number;
  uptimeSeconds: number;
  status: InstanceInspection['status'];
}

export interface InstanceLogs {
  instanceId: string;
  lines: readonly string[];
  nextCursor: string | null;
}

export interface NodeAgent {
  createInstance(request: CreateInstanceRequest): Promise<InstanceInspection>;
  startInstance(instanceId: string): Promise<InstanceInspection>;
  stopInstance(instanceId: string): Promise<InstanceInspection>;
  restartInstance(instanceId: string): Promise<InstanceInspection>;
  removeInstance(instanceId: string): Promise<void>;
  inspectInstance(instanceId: string): Promise<InstanceInspection>;
  collectMetrics(instanceId: string): Promise<InstanceMetrics>;
  retrieveLogs(instanceId: string, options?: { tail?: number; cursor?: string }): Promise<InstanceLogs>;
}

export interface DockerContainerConfig {
  name: string;
  image: string;
  env: Readonly<Record<string, string>>;
  labels: Readonly<Record<string, string>>;
  cpuQuota: number;
  cpuPeriod: number;
  memoryBytes: bigint;
  memorySwapBytes: bigint;
  pidsLimit: number;
  restartPolicy: 'unless-stopped';
  network: string;
  storageKey: string;
  diskPolicy: DiskPolicy;
  diskLimitBytes: bigint;
}

export interface DockerRuntime {
  createContainer(config: DockerContainerConfig): Promise<string>;
  startContainer(runtimeId: string): Promise<void>;
  stopContainer(runtimeId: string): Promise<void>;
  restartContainer(runtimeId: string): Promise<void>;
  removeContainer(runtimeId: string): Promise<void>;
  inspectContainer(runtimeId: string): Promise<InstanceInspection>;
  statsContainer(runtimeId: string): Promise<InstanceMetrics>;
  logsContainer(runtimeId: string, options: { tail: number; cursor?: string }): Promise<InstanceLogs>;
}