import type { AuthService } from '@ruangnode/auth';
import type { InstanceService, NodeRecord, NodeRegistryService, NodeRepository } from '@ruangnode/services';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { SessionCookieConfig } from '../auth/config.js';
import { authContextOf, requireAuth, requireRole, requireOwnership } from '../auth/guards.js';

export interface InfrastructureRoutesOptions {
  instances: InstanceService;
  nodes: NodeRepository;
  nodeRegistry: NodeRegistryService;
}

const idSchema = { type: 'string', minLength: 1 } as const;
const idParams = { type: 'object', required: ['id'], properties: { id: idSchema }, additionalProperties: false } as const;

function data(value: Record<string, unknown>): { data: Record<string, unknown> } { return { data: value }; }
function idOf(request: FastifyRequest): string { return (request.params as { id: string }).id; }

export function registerInfrastructureRoutes(app: FastifyInstance, options: InfrastructureRoutesOptions, auth: AuthService, cookie: SessionCookieConfig): void {
  const authenticate = requireAuth({ auth, cookie });
  const admin = requireRole('ADMIN');
  const ownership = requireOwnership((request) => options.instances.getForUser('__owner_probe__', idOf(request)).then((instance) => instance.userId).catch(() => null));
  void ownership;

  app.register((scope) => {
    scope.get('/instances', { preHandler: authenticate }, async (request) => data({ instances: await options.instances.listForUser(authContextOf(request).user.id) }));
    scope.get('/instances/:id', { schema: { params: idParams }, preHandler: authenticate }, async (request) => data({ instance: await options.instances.getForUser(authContextOf(request).user.id, idOf(request)) }));
    scope.post('/instances/:id/start', { schema: { params: idParams }, preHandler: authenticate }, async (request) => data({ instance: await options.instances.start(authContextOf(request).user.id, idOf(request)) }));
    scope.post('/instances/:id/stop', { schema: { params: idParams }, preHandler: authenticate }, async (request) => data({ instance: await options.instances.stop(authContextOf(request).user.id, idOf(request)) }));
    scope.post('/instances/:id/restart', { schema: { params: idParams }, preHandler: authenticate }, async (request) => data({ instance: await options.instances.restart(authContextOf(request).user.id, idOf(request)) }));
    scope.delete('/instances/:id', { schema: { params: idParams }, preHandler: authenticate }, async (request) => data({ instance: await options.instances.destroy(authContextOf(request).user.id, idOf(request)) }));
    scope.get('/instances/:id/metrics', { schema: { params: idParams }, preHandler: authenticate }, async (request) => data({ metrics: await options.instances.metrics(authContextOf(request).user.id, idOf(request)) }));
    scope.get('/instances/:id/logs', { schema: { params: idParams }, preHandler: authenticate }, async (request) => data({ logs: await options.instances.logs(authContextOf(request).user.id, idOf(request)) }));

    scope.register((adminScope) => {
      const guard = [authenticate, admin] as preHandlerHookHandler[];
      adminScope.get('/nodes', { preHandler: guard }, async () => data({ nodes: await options.nodes.list() }));
      adminScope.get('/nodes/:id', { schema: { params: idParams }, preHandler: guard }, async (request) => {
        const node = await options.nodes.findById(idOf(request));
        return data({ node: node as NodeRecord | null });
      });
      adminScope.post('/nodes', { preHandler: guard }, async (request, reply) => {
        const result = await options.nodeRegistry.register(request.body as never);
        return reply.status(201).send(data({ node: result.node, token: result.token }));
      });
      adminScope.patch('/nodes/:id', { schema: { params: idParams }, preHandler: guard }, async (request) => data({ node: await options.nodeRegistry.setEnabled(idOf(request), (request.body as { enabled: boolean }).enabled) }));
    }, { prefix: '/admin' });
  }, { prefix: '/api/v1' });
}