import Docker from 'dockerode';
import type {
  AgentResourceProfile,
  DockerContainerConfig,
  DockerRuntime,
  InstanceInspection,
  InstanceLogs,
  InstanceMetrics,
  NodeAgent,
} from './types.js';

export const DOCKER_CPU_PERIOD_MICROSECONDS = 100_000;

type ContainerInspectInfo = {
  Id?: string;
  Config?: { Labels?: Record<string, string> };
  State?: {
    Status?: string;
    Running?: boolean;
    StartedAt?: string;
    Health?: { Status?: string };
  };
};

type DockerStats = {
  memory_stats?: {
    usage?: number | bigint | string;
    limit?: number | bigint | string;
  };
  pids_stats?: {
    current?: number;
  };
};

type DockerRuntimeClient = {
  listContainers?(options?: { all?: boolean; filters?: Record<string, string[]> }): Promise<Array<{ Id?: string; Labels?: Record<string, string> }>>;
  createContainer(options: Record<string, unknown>): Promise<{ id: string }>;
  createNetwork?(options: Record<string, unknown>): Promise<unknown>;
  getContainer(id: string): {
    start(): Promise<unknown>;
    stop(): Promise<unknown>;
    restart(): Promise<unknown>;
    remove(options?: { force?: boolean; v?: boolean }): Promise<unknown>;
    inspect(): Promise<ContainerInspectInfo>;
    stats(options?: { stream?: boolean }): Promise<Record<string, unknown>>;
    logs(options: {
      stdout?: boolean;
      stderr?: boolean;
      tail?: number;
      timestamps?: boolean;
      follow?: boolean;
    }): Promise<string | Buffer | Uint8Array | unknown>;
  };
  getNetwork?(name: string): { inspect(): Promise<unknown> };
};

export function cpuQuotaFromMillicores(cpuLimitMillicores: number): number {
  if (!Number.isInteger(cpuLimitMillicores) || cpuLimitMillicores <= 0) {
    throw new Error('CPU limit must be a positive integer in millicores.');
  }

  return Math.max(1, Math.floor((cpuLimitMillicores * DOCKER_CPU_PERIOD_MICROSECONDS) / 1000));
}

export function memorySwapLimit(profile: AgentResourceProfile): bigint {
  switch (profile.memorySwapPolicy) {
    case 'DISABLED':
      return profile.memoryLimitBytes;
    case 'EQUAL_TO_MEMORY':
      return profile.memoryLimitBytes * 2n;
    case 'BOUNDED':
      if (profile.memorySwapBytes === null || profile.memorySwapBytes < profile.memoryLimitBytes) {
        throw new Error('Bounded swap must be at least the memory limit.');
      }
      return profile.memorySwapBytes;
  }

  throw new Error('Unsupported memory swap policy.');
}

export function dockerContainerConfig(request: {
  instanceId: string;
  image: string;
  profile: AgentResourceProfile;
  configuration: Readonly<Record<string, string>>;
}): DockerContainerConfig {
  return {
    name: `ruangnode-${request.instanceId}`,
    image: request.image,
    env: request.configuration,
    labels: { 'ruangnode.instanceId': request.instanceId },
    cpuQuota: cpuQuotaFromMillicores(request.profile.cpuLimitMillicores),
    cpuPeriod: DOCKER_CPU_PERIOD_MICROSECONDS,
    memoryBytes: request.profile.memoryLimitBytes,
    memorySwapBytes: memorySwapLimit(request.profile),
    pidsLimit: request.profile.pidsLimit,
    restartPolicy: 'unless-stopped',
    network: `ruangnode-instance-${request.instanceId}`,
    storageKey: request.instanceId,
    diskPolicy: request.profile.diskPolicy,
    diskLimitBytes: request.profile.diskLimitBytes,
  };
}

export function dockerCreateOptions(config: DockerContainerConfig): Record<string, unknown> {
  const env = Object.entries(config.env).map(([key, value]) => `${key}=${value}`);

  return {
    name: config.name,
    Image: config.image,
    Env: env,
    Labels: {
      ...config.labels,
      'ruangnode.storageKey': config.storageKey,
      'ruangnode.network': config.network,
      'ruangnode.diskPolicy': config.diskPolicy,
    },
    HostConfig: {
      Privileged: false,
      NetworkMode: config.network,
      Memory: Number(config.memoryBytes),
      MemorySwap: Number(config.memorySwapBytes),
      CpuQuota: config.cpuQuota,
      CpuPeriod: config.cpuPeriod,
      PidsLimit: config.pidsLimit,
      RestartPolicy: { Name: config.restartPolicy },
      AutoRemove: false,
      CapDrop: ['ALL'],
      CapAdd: [],
      SecurityOpt: ['no-new-privileges:true'],
      ReadonlyRootfs: true,
      Binds: [],
      Mounts: [],
      Devices: [],
      OomKillDisable: false,
      VolumesFrom: [],
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [config.network]: {},
      },
    },
  };
}

function asStatus(status: string | undefined, running: boolean | undefined): InstanceInspection['status'] {
  if (status === 'running' || running === true) return 'RUNNING';
  if (status === 'exited' || status === 'created') return 'STOPPED';
  if (status === 'restarting' || status === 'removing') return 'UNKNOWN';
  if (status?.includes('error')) return 'ERROR';
  return 'UNKNOWN';
}

function asHealth(status: string | undefined): InstanceInspection['health'] {
  if (status === undefined) return 'UNKNOWN';
  if (status === 'healthy') return 'HEALTHY';
  if (status === 'unhealthy') return 'UNHEALTHY';
  return 'UNKNOWN';
}

function readInstanceId(info: ContainerInspectInfo | undefined, fallback: string): string {
  const labels = info?.Config?.Labels ?? {};
  return labels['ruangnode.instanceId'] ?? fallback;
}

function readRuntimeId(info: ContainerInspectInfo | undefined, fallback: string): string {
  return info?.Id ?? fallback;
}

export function createDockerRuntime(
  docker: DockerRuntimeClient = new Docker() as unknown as DockerRuntimeClient,
): DockerRuntime {
  async function ensureNetwork(networkName: string): Promise<void> {
    if (docker.getNetwork === undefined) return;

    try {
      await docker.getNetwork(networkName).inspect();
    } catch {
      await docker.createNetwork?.({
        Name: networkName,
        Driver: 'bridge',
        Internal: true,
        CheckDuplicate: true,
        Labels: { 'ruangnode.network': networkName },
      });
    }
  }

  return {
    async findContainer(instanceId) {
      if (docker.listContainers === undefined) return null;
      const containers = await docker.listContainers({ all: true, filters: { label: [`ruangnode.instanceId=${instanceId}`] } });
      return containers[0]?.Id ?? null;
    },
    async createContainer(config) {
      await ensureNetwork(config.network);
      const created = await docker.createContainer(dockerCreateOptions(config));
      return created.id;
    },
    async startContainer(runtimeId) {
      await docker.getContainer(runtimeId).start();
    },
    async stopContainer(runtimeId) {
      await docker.getContainer(runtimeId).stop();
    },
    async restartContainer(runtimeId) {
      await docker.getContainer(runtimeId).restart();
    },
    async removeContainer(runtimeId) {
      await docker.getContainer(runtimeId).remove({ force: true, v: true });
    },
    async inspectContainer(runtimeId) {
      const container = docker.getContainer(runtimeId);
      const info = await container.inspect();
      return {
        instanceId: readInstanceId(info, runtimeId),
        runtimeId: readRuntimeId(info, runtimeId),
        status: asStatus(info.State?.Status, info.State?.Running),
        health: asHealth(info.State?.Health?.Status),
        startedAt: info.State?.StartedAt === undefined ? null : new Date(info.State.StartedAt),
      };
    },
    async statsContainer(runtimeId) {
      const container = docker.getContainer(runtimeId);
      const info = await container.inspect();
      const metrics = (await container.stats({ stream: false })) as DockerStats;
      const memoryUsageBytes = BigInt(metrics.memory_stats?.usage ?? 0);
      const memoryLimitBytes = BigInt(metrics.memory_stats?.limit ?? 0);
      const pidCount = Number(metrics.pids_stats?.current ?? 0);
      const uptimeSeconds = Math.max(
        0,
        Math.round((Date.now() - new Date(info.State?.StartedAt ?? Date.now()).getTime()) / 1000),
      );

      return {
        instanceId: readInstanceId(info, runtimeId),
        cpuUsageMillicores: 0,
        memoryUsageBytes,
        memoryLimitBytes,
        pidCount,
        uptimeSeconds,
        status: asStatus(info.State?.Status, info.State?.Running),
      } satisfies InstanceMetrics;
    },
    async logsContainer(runtimeId, options) {
      const container = docker.getContainer(runtimeId);
      const info = await container.inspect();
      const raw = await container.logs({
        stdout: true,
        stderr: true,
        timestamps: true,
        tail: options.tail ?? 100,
        follow: false,
      });

      const text = Buffer.isBuffer(raw)
        ? raw.toString('utf8')
        : typeof raw === 'string'
          ? raw
          : String(raw ?? '');

      const lines = text
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .slice(-Math.max(1, options.tail ?? 100));

      return {
        instanceId: readInstanceId(info, runtimeId),
        lines,
        nextCursor: null,
      } satisfies InstanceLogs;
    },
  };
}

export function createDockerNodeAgent(runtime: DockerRuntime): NodeAgent {
  const runtimes = new Map<string, string>();
  const requests = new Map<string, Promise<InstanceInspection>>();

  async function runtimeFor(instanceId: string): Promise<string> {
    const runtimeId = runtimes.get(instanceId);
    if (runtimeId !== undefined) return runtimeId;
    const discovered = await runtime.findContainer(instanceId);
    if (discovered === null) throw new Error('Instance runtime was not found.');
    runtimes.set(instanceId, discovered);
    return discovered;
  }

  return {
    async createInstance(request) {
      const existing = requests.get(request.idempotencyKey);
      if (existing !== undefined) return existing;
      const creation = (async () => {
        const runtimeId = await runtime.createContainer(dockerContainerConfig(request));
        runtimes.set(request.instanceId, runtimeId);
        await runtime.startContainer(runtimeId);
        return runtime.inspectContainer(runtimeId);
      })();
      requests.set(request.idempotencyKey, creation);
      return creation;
    },
    async startInstance(instanceId) {
      const runtimeId = await runtimeFor(instanceId);
      await runtime.startContainer(runtimeId);
      return runtime.inspectContainer(runtimeId);
    },
    async stopInstance(instanceId) {
      const runtimeId = await runtimeFor(instanceId);
      await runtime.stopContainer(runtimeId);
      return runtime.inspectContainer(runtimeId);
    },
    async restartInstance(instanceId) {
      const runtimeId = await runtimeFor(instanceId);
      await runtime.restartContainer(runtimeId);
      return runtime.inspectContainer(runtimeId);
    },
    async removeInstance(instanceId) {
      const runtimeId = await runtimeFor(instanceId);
      await runtime.removeContainer(runtimeId);
      runtimes.delete(instanceId);
    },
    async inspectInstance(instanceId) {
      return runtime.inspectContainer(await runtimeFor(instanceId));
    },
    async collectMetrics(instanceId) {
      return runtime.statsContainer(await runtimeFor(instanceId));
    },
    async retrieveLogs(instanceId, options) {
      return runtime.logsContainer(await runtimeFor(instanceId), {
        tail: options?.tail ?? 100,
        ...(options?.cursor === undefined ? {} : { cursor: options.cursor }),
      });
    },
  };
}