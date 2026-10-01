import { describe, expect, it, vi } from 'vitest';
import { createNodeAgentServer, listenNodeAgentServer } from './http.js';
import type { NodeAgent } from './types.js';

const token = 'a'.repeat(32);
const inspection = { instanceId: 'instance-1', runtimeId: 'runtime-1', status: 'RUNNING' as const, health: 'HEALTHY' as const, startedAt: null };

function fakeAgent(): NodeAgent {
  return {
    createInstance: vi.fn(async () => inspection),
    startInstance: vi.fn(async () => inspection),
    stopInstance: vi.fn(async () => ({ ...inspection, status: 'STOPPED' as const })),
    restartInstance: vi.fn(async () => inspection),
    removeInstance: vi.fn(async () => undefined),
    inspectInstance: vi.fn(async () => inspection),
    collectMetrics: vi.fn(async () => ({ instanceId: 'instance-1', cpuUsageMillicores: 0, memoryUsageBytes: 0n, memoryLimitBytes: 1n, pidCount: 0, uptimeSeconds: 1, status: 'RUNNING' as const })),
    retrieveLogs: vi.fn(async () => ({ instanceId: 'instance-1', lines: [], nextCursor: null })),
  };
}

describe('authenticated Node Agent HTTP transport', () => {
  it('keeps health public and protects runtime operations', async () => {
    const server = createNodeAgentServer({ token, agent: fakeAgent() });
    await listenNodeAgentServer(server, '127.0.0.1', 0);
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Server did not bind.');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      await expect(fetch(`${baseUrl}/health`)).resolves.toMatchObject({ status: 200 });
      await expect(fetch(`${baseUrl}/v1/instances/instance-1`)).resolves.toMatchObject({ status: 401 });
      const response = await fetch(`${baseUrl}/v1/instances/instance-1`, { headers: { authorization: `Bearer ${token}` } });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ data: { runtimeId: 'runtime-1' } });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('returns an empty 204 response for deletion', async () => {
    const server = createNodeAgentServer({ token, agent: fakeAgent() });
    await listenNodeAgentServer(server, '127.0.0.1', 0);
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Server did not bind.');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/instances/instance-1`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});