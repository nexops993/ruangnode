import { describe, expect, it, vi } from 'vitest';
import {
  cpuQuotaFromMillicores,
  createDockerNodeAgent,
  createDockerRuntime,
  dockerContainerConfig,
  memorySwapLimit,
} from './docker.js';
import type { DockerRuntime } from './types.js';

const profile = { cpuLimitMillicores: 500, memoryLimitBytes: 128n * 1024n * 1024n, memorySwapPolicy: 'DISABLED' as const, memorySwapBytes: null, diskLimitBytes: 1n, diskPolicy: 'ALLOCATED' as const, pidsLimit: 64 };

describe('Docker resource enforcement', () => {
  it('converts CPU and swap policies to runtime values', () => {
    expect(cpuQuotaFromMillicores(500)).toBe(50_000);
    expect(memorySwapLimit(profile)).toBe(profile.memoryLimitBytes);
    expect(dockerContainerConfig({ instanceId: 'abc', image: 'service:1', profile, configuration: {} })).toMatchObject({ cpuQuota: 50_000, memoryBytes: profile.memoryLimitBytes, pidsLimit: 64, restartPolicy: 'unless-stopped', network: 'ruangnode-instance-abc' });
  });

  it('does not create twice for a repeated idempotency key', async () => {
    const runtime: DockerRuntime = { findContainer: vi.fn(async () => null), createContainer: vi.fn(async () => 'runtime-1'), startContainer: vi.fn(async () => undefined), stopContainer: vi.fn(async () => undefined), restartContainer: vi.fn(async () => undefined), removeContainer: vi.fn(async () => undefined), inspectContainer: vi.fn(async () => ({ instanceId: 'abc', runtimeId: 'runtime-1', status: 'RUNNING' as const, health: 'HEALTHY' as const, startedAt: null })), statsContainer: vi.fn(), logsContainer: vi.fn() };
    const agent = createDockerNodeAgent(runtime);
    const request = { instanceId: 'abc', serviceType: 'managed', image: 'service:1', profile, configuration: {}, idempotencyKey: 'job-1' };
    await agent.createInstance(request);
    await agent.createInstance(request);
    expect(runtime.createContainer).toHaveBeenCalledTimes(1);
  });

  it('does not create twice for concurrent requests with one idempotency key', async () => {
    let release: (() => void) | undefined;
    const runtime: DockerRuntime = { findContainer: vi.fn(async () => null), createContainer: vi.fn(async () => { await new Promise<void>((resolve) => { release = resolve; }); return 'runtime-1'; }), startContainer: vi.fn(async () => undefined), stopContainer: vi.fn(async () => undefined), restartContainer: vi.fn(async () => undefined), removeContainer: vi.fn(async () => undefined), inspectContainer: vi.fn(async () => ({ instanceId: 'abc', runtimeId: 'runtime-1', status: 'RUNNING' as const, health: 'HEALTHY' as const, startedAt: null })), statsContainer: vi.fn(), logsContainer: vi.fn() };
    const agent = createDockerNodeAgent(runtime);
    const request = { instanceId: 'abc', serviceType: 'managed', image: 'service:1', profile, configuration: {}, idempotencyKey: 'job-concurrent' };
    const first = agent.createInstance(request);
    const second = agent.createInstance(request);
    release?.();
    await Promise.all([first, second]);
    expect(runtime.createContainer).toHaveBeenCalledTimes(1);
  });

  it('creates a secure isolated Docker container configuration', async () => {
    const createContainer = vi.fn(async () => ({ id: 'runtime-1' }));
    const createNetwork = vi.fn(async () => undefined);
    const getNetwork = vi.fn(() => ({
      inspect: vi.fn(async () => {
        throw new Error('missing');
      }),
    }));
    const inspect = vi.fn(async () => ({
      Id: 'runtime-1',
      Name: '/ruangnode-abc',
      Config: { Image: 'service:1', Labels: { 'ruangnode.instanceId': 'abc' } },
      State: { Status: 'running', Running: true, StartedAt: '2026-01-01T00:00:00Z' },
    }));
    const stats = vi.fn(async () => ({
      read: '2026-01-01T00:00:00Z',
      memory_stats: { usage: 123, limit: 456 },
      pids_stats: { current: 12 },
      cpu_stats: { cpu_usage: { total_usage: 6000 }, system_cpu_usage: 10_000 },
      precpu_stats: { cpu_usage: { total_usage: 5000 }, system_cpu_usage: 9_000 },
      networks: { eth0: { rx_bytes: 10, tx_bytes: 20 } },
    }));
    const logs = vi.fn(async () => Buffer.from('hello\n'));
    const getContainer = vi.fn(() => ({
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      restart: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      inspect,
      stats,
      logs,
    }));

    const runtime = createDockerRuntime({
      createNetwork,
      createContainer,
      getContainer,
      getNetwork,
    } as Parameters<typeof createDockerRuntime>[0]);

    const id = await runtime.createContainer(
      dockerContainerConfig({ instanceId: 'abc', image: 'service:1', profile, configuration: { FOO: 'bar' } }),
    );

    expect(id).toBe('runtime-1');
    expect(createNetwork).toHaveBeenCalledWith(
      expect.objectContaining({ Name: 'ruangnode-instance-abc', Internal: true, Driver: 'bridge' }),
    );
    expect(createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          Privileged: false,
          NetworkMode: 'ruangnode-instance-abc',
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges:true'],
          PidsLimit: 64,
        }),
      }),
    );
  });

  it('discovers labelled containers after the agent process restarts', async () => {
    const runtime: DockerRuntime = { findContainer: vi.fn(async () => 'runtime-after-restart'), createContainer: vi.fn(), startContainer: vi.fn(async () => undefined), stopContainer: vi.fn(async () => undefined), restartContainer: vi.fn(async () => undefined), removeContainer: vi.fn(async () => undefined), inspectContainer: vi.fn(async () => ({ instanceId: 'abc', runtimeId: 'runtime-after-restart', status: 'RUNNING' as const, health: 'HEALTHY' as const, startedAt: null })), statsContainer: vi.fn(), logsContainer: vi.fn() };
    const agent = createDockerNodeAgent(runtime);

    await expect(agent.inspectInstance('abc')).resolves.toMatchObject({ runtimeId: 'runtime-after-restart' });
    expect(runtime.findContainer).toHaveBeenCalledWith('abc');
  });
});