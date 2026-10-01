import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { infrastructureError, INFRASTRUCTURE_MESSAGES } from './errors.js';
import type { NodeRepository } from './ports.js';
import type { NodeHeartbeatInput, NodeRecord } from './types.js';

export interface NodeCredentialStore {
  saveHash(nodeId: string, tokenHash: string): Promise<void>;
  matches(nodeId: string, tokenHash: string): Promise<boolean>;
}

export interface NodeRegistrationInput {
  name: string;
  provider: string | null;
  region: string | null;
  hostname: string;
  totalCpuMillicores: number;
  totalMemoryBytes: bigint;
  totalStorageBytes: bigint;
  reservedCpuMillicores: number;
  reservedMemoryBytes: bigint;
  reservedStorageBytes: bigint;
}

export class NodeRegistryService {
  constructor(private readonly nodes: NodeRepository, private readonly credentials: NodeCredentialStore) {}

  async register(input: NodeRegistrationInput): Promise<{ node: NodeRecord; token: string }> {
    const node = await this.nodes.register({ ...input, agentVersion: null, status: 'PROVISIONING' });
    const token = randomBytes(32).toString('base64url');
    await this.credentials.saveHash(node.id, hashNodeToken(token));
    return { node, token };
  }

  async heartbeat(nodeId: string, token: string, input: NodeHeartbeatInput): Promise<NodeRecord> {
    if (!(await this.credentials.matches(nodeId, hashNodeToken(token)))) throw infrastructureError('NOT_FOUND', INFRASTRUCTURE_MESSAGES.nodeNotFound);
    const node = await this.nodes.heartbeat(nodeId, input);
    if (node === null) throw infrastructureError('NOT_FOUND', INFRASTRUCTURE_MESSAGES.nodeNotFound);
    return node;
  }

  async setEnabled(nodeId: string, enabled: boolean): Promise<NodeRecord> {
    const node = await this.nodes.setEnabled(nodeId, enabled);
    if (node === null) throw infrastructureError('NOT_FOUND', INFRASTRUCTURE_MESSAGES.nodeNotFound);
    return node;
  }
}

export function hashNodeToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function nodeTokenMatches(expectedHash: string, actualHash: string): boolean {
  const expected = Buffer.from(expectedHash, 'hex');
  const actual = Buffer.from(actualHash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}