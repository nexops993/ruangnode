import { describe, expect, it } from 'vitest';
import { canTransition } from './instance-service.js';
import { NodeScheduler, availableNodeResources, isNodeEligible } from './scheduler.js';
import { instanceStorageKey } from './storage.js';
import type { NodeRecord } from './types.js';

const node: NodeRecord = { id: 'node-a', name: 'node-a', provider: null, region: 'eu', hostname: 'host', agentVersion: '1', status: 'ONLINE', totalCpuMillicores: 4000, totalMemoryBytes: 8n, totalStorageBytes: 100n, reservedCpuMillicores: 500, reservedMemoryBytes: 1n, reservedStorageBytes: 10n, allocatedCpuMillicores: 1000, allocatedMemoryBytes: 2n, allocatedStorageBytes: 20n, lastHeartbeatAt: new Date('2026-01-01T00:00:00Z') };

describe('infrastructure policies', () => {
  it('calculates available capacity and rejects stale nodes', () => {
    expect(availableNodeResources(node)).toEqual({ cpuMillicores: 2500, memoryBytes: 5n, storageBytes: 70n });
    expect(isNodeEligible(node, { cpuMillicores: 1000, memoryBytes: 1n, storageBytes: 1n, now: new Date('2026-01-01T00:00:30Z') })).toBe(true);
    expect(isNodeEligible(node, { cpuMillicores: 1000, memoryBytes: 1n, storageBytes: 1n, now: new Date('2026-01-01T00:03:00Z') })).toBe(false);
  });

  it('selects deterministically and enforces lifecycle transitions', async () => {
    const repository = { list: async () => [node], findById: async () => node, register: async () => node, heartbeat: async () => node, setEnabled: async () => node };
    expect((await new NodeScheduler(repository).select({ cpuMillicores: 1000, memoryBytes: 1n, storageBytes: 1n, now: new Date('2026-01-01T00:00:30Z') })).id).toBe('node-a');
    expect(canTransition('PENDING', 'PROVISIONING')).toBe(true);
    expect(canTransition('ACTIVE', 'PROVISIONING')).toBe(false);
  });

  it('keeps storage keys instance-owned', () => {
    expect(instanceStorageKey('12345678-1234-1234-1234-123456789012')).toContain('instances/');
    expect(() => instanceStorageKey('../escape')).toThrow();
  });
});