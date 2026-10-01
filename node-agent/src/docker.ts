import type { AgentResourceProfile, DockerContainerConfig, DockerRuntime, NodeAgent } from './types.js';

export const DOCKER_CPU_PERIOD_MICROSECONDS = 100_000;

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

export function createDockerNodeAgent(runtime: DockerRuntime): NodeAgent {
  const runtimes = new Map<string, string>();
  const requests = new Map<string, string>();

  async function runtimeFor(instanceId: string): Promise<string> {
    const runtimeId = runtimes.get(instanceId);
    if (runtimeId === undefined) throw new Error('Instance runtime was not found.');
    return runtimeId;
  }

  return {
    async createInstance(request) {
      const existing = requests.get(request.idempotencyKey);
      if (existing !== undefined) return runtime.inspectContainer(existing);
      const runtimeId = await runtime.createContainer(dockerContainerConfig(request));
      runtimes.set(request.instanceId, runtimeId);
      requests.set(request.idempotencyKey, runtimeId);
      await runtime.startContainer(runtimeId);
      return runtime.inspectContainer(runtimeId);
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