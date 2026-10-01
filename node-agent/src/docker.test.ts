import { describe, expect, it, vi } from 'vitest';
import { cpuQuotaFromMillicores, createDockerNodeAgent, dockerContainerConfig, memorySwapLimit } from './docker.js';
import type { DockerRuntime } from './types.js';

const profile = { cpuLimitMillicores: 500, memoryLimitBytes: 128n * 1024n * 1024n, memorySwapPolicy: 'DISABLED' as const, memorySwapBytes: null, diskLimitBytes: 1n, diskPolicy: 'ALLOCATED' as const, pidsLimit: 64 };

describe('Docker resource enforcement', () => {
  it('converts CPU and swap policies to runtime values', () => {
    expect(cpuQuotaFromMillicores(500)).toBe(50_000);
    expect(memorySwapLimit(profile)).toBe(profile.memoryLimitBytes);
    expect(dockerContainerConfig({ instanceId: 'abc', image: 'service:1', profile, configuration: {} })).toMatchObject({ cpuQuota: 50_000, memoryBytes: profile.memoryLimitBytes, pidsLimit: 64, restartPolicy: 'unless-stopped', network: 'ruangnode-instance-abc' });
  });

  it('does not create twice for a repeated idempotency key', async () => {
    const runtime: DockerRuntime = { createContainer: vi.fn(async () => 'runtime-1'), startContainer: vi.fn(async () => undefined), stopContainer: vi.fn(async () => undefined), restartContainer: vi.fn(async () => undefined), removeContainer: vi.fn(async () => undefined), inspectContainer: vi.fn(async () => ({ instanceId: 'abc', runtimeId: 'runtime-1', status: 'RUNNING' as const, health: 'HEALTHY' as const, startedAt: null })), statsContainer: vi.fn(), logsContainer: vi.fn() };
    const agent = createDockerNodeAgent(runtime);
    const request = { instanceId: 'abc', serviceType: 'managed', image: 'service:1', profile, configuration: {}, idempotencyKey: 'job-1' };
    await agent.createInstance(request);
    await agent.createInstance(request);
    expect(runtime.createContainer).toHaveBeenCalledTimes(1);
  });
});