import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createDockerNodeAgent, createDockerRuntime } from './docker.js';
import type { AgentResourceProfile, InstanceInspection, InstanceLogs, InstanceMetrics, NodeAgent } from './types.js';

export interface NodeAgentHttpOptions {
  token: string;
  agent?: NodeAgent;
}

type JsonRequest = { method: string; path: string; body: Record<string, unknown> };

function json(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? item.toString() : item));
}

function write(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(json(value));
}

async function requestOf(request: IncomingMessage): Promise<JsonRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return { method: request.method ?? 'GET', path: request.url?.split('?')[0] ?? '/', body: raw === '' ? {} : JSON.parse(raw) as Record<string, unknown> };
}

function profileOf(value: unknown): AgentResourceProfile {
  const profile = value as Record<string, unknown>;
  return {
    cpuLimitMillicores: Number(profile.cpuLimitMillicores),
    memoryLimitBytes: BigInt(String(profile.memoryLimitBytes)),
    memorySwapPolicy: profile.memorySwapPolicy as AgentResourceProfile['memorySwapPolicy'],
    memorySwapBytes: profile.memorySwapBytes === null ? null : BigInt(String(profile.memorySwapBytes)),
    diskLimitBytes: BigInt(String(profile.diskLimitBytes)),
    diskPolicy: profile.diskPolicy as AgentResourceProfile['diskPolicy'],
    pidsLimit: Number(profile.pidsLimit),
  };
}

function instanceId(path: string): string {
  const match = /^\/v1\/instances\/([^/]+)(?:\/([^/]+))?$/.exec(path);
  if (match?.[1] === undefined) throw new Error('Invalid instance path.');
  return match[1];
}

export function createNodeAgentServer(options: NodeAgentHttpOptions): Server {
  const agent = options.agent ?? createDockerNodeAgent(createDockerRuntime());
  return createServer(async (request, response) => {
    try {
      if (request.url === '/health' && request.method === 'GET') return write(response, 200, { data: { status: 'ok' } });
      if (request.headers.authorization !== `Bearer ${options.token}`) return write(response, 401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } });
      const input = await requestOf(request);
      if (input.path === '/v1/instances' && input.method === 'POST') {
        const body = input.body;
        const result = await agent.createInstance({ instanceId: String(body.instanceId), serviceType: String(body.serviceType), image: String(body.image), profile: profileOf(body.profile), configuration: (body.configuration ?? {}) as Record<string, string>, idempotencyKey: String(body.idempotencyKey) });
        return write(response, 200, { data: result });
      }
      const id = instanceId(input.path);
      const operation = input.path.split('/').at(-1);
      if (input.method === 'GET' && operation === id) return write(response, 200, { data: await agent.inspectInstance(id) });
      if (input.method === 'GET' && operation === 'metrics') return write(response, 200, { data: await agent.collectMetrics(id) });
      if ((input.method === 'GET' || input.method === 'POST') && operation === 'logs') return write(response, 200, { data: await agent.retrieveLogs(id, input.body as { tail?: number; cursor?: string }) });
      if (input.method === 'POST' && operation === 'start') return write(response, 200, { data: await agent.startInstance(id) });
      if (input.method === 'POST' && operation === 'stop') return write(response, 200, { data: await agent.stopInstance(id) });
      if (input.method === 'POST' && operation === 'restart') return write(response, 200, { data: await agent.restartInstance(id) });
      if (input.method === 'DELETE' && operation === id) { await agent.removeInstance(id); response.writeHead(204); response.end(); return; }
      return write(response, 404, { error: { code: 'NOT_FOUND', message: 'The requested endpoint does not exist.' } });
    } catch (error) {
      return write(response, 500, { error: { code: 'RUNTIME_ERROR', message: error instanceof Error ? error.message : 'Runtime operation failed.' } });
    }
  });
}

export async function listenNodeAgentServer(server: Server, host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
}

export interface NodeAgentHttpClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export function createHttpNodeAgent(options: NodeAgentHttpClientOptions): NodeAgent {
  const request = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const timeoutMs = options.timeoutMs ?? 30_000;

  async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await request(`${baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: { authorization: `Bearer ${options.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: json(body) }),
      });
    } finally {
      clearTimeout(timeout);
    }
    const payload = await response.json() as { data?: T; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? `Node Agent request failed with status ${response.status}.`);
    if (payload.data === undefined) throw new Error('Node Agent returned an invalid response.');
    return payload.data;
  }

  return {
    createInstance: (input) => call<InstanceInspection>('/v1/instances', 'POST', input),
    startInstance: (id) => call<InstanceInspection>(`/v1/instances/${encodeURIComponent(id)}/start`, 'POST'),
    stopInstance: (id) => call<InstanceInspection>(`/v1/instances/${encodeURIComponent(id)}/stop`, 'POST'),
    restartInstance: (id) => call<InstanceInspection>(`/v1/instances/${encodeURIComponent(id)}/restart`, 'POST'),
    removeInstance: async (id) => { await call(`/v1/instances/${encodeURIComponent(id)}`, 'DELETE'); },
    inspectInstance: (id) => call<InstanceInspection>(`/v1/instances/${encodeURIComponent(id)}`, 'GET'),
    collectMetrics: (id) => call<InstanceMetrics>(`/v1/instances/${encodeURIComponent(id)}/metrics`, 'GET'),
    retrieveLogs: (id, input) => call<InstanceLogs>(`/v1/instances/${encodeURIComponent(id)}/logs`, 'POST', input ?? {}),
  };
}