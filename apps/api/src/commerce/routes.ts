/**
 * Commerce routes: public catalog, administrator catalog and customer orders.
 *
 * Every protected handler follows the same pipeline
 * (`.clinerules` → API: authenticate → authorize → validate → service → respond):
 *
 *   - **authenticate** `requireAuth` resolves the session cookie
 *   - **authorize**    `requireRole('ADMIN')` for administration,
 *                      `requireOwnership` for a customer's own order
 *   - **validate**     the JSON schemas in `./schemas.ts` (Fastify/AJV) run before
 *                      the handler, and the service parses its input again
 *   - **service**      handlers only call a service and shape the `{ data }`
 *                      envelope — no database access, no business rule
 *   - **respond**      the declared response schema serialises the payload, so a
 *                      field that is not part of the contract cannot leak
 *
 * Route paths are documented in docs/API.md. Public and customer routes live
 * under `/api/v1/...`; administration lives under `/api/v1/admin/...` and is
 * never reachable without the ADMIN role.
 */
import type { AuthService } from '@ruangnode/auth';
import type { CommerceServices, ProductType } from '@ruangnode/services';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';

import type { SessionCookieConfig } from '../auth/config.js';
import { authContextOf, requireAuth, requireOwnership, requireRole } from '../auth/guards.js';
import {
  adminArchiveProductRouteSchema,
  adminArchiveVariantRouteSchema,
  adminCreateProductRouteSchema,
  adminCreateProfileRouteSchema,
  adminCreateVariantRouteSchema,
  adminArchiveProfileRouteSchema,
  adminGetProductRouteSchema,
  adminGetProfileRouteSchema,
  adminGetVariantRouteSchema,
  adminListProductsRouteSchema,
  adminListProfilesRouteSchema,
  adminListVariantsRouteSchema,
  adminProductStatusRouteSchema,
  adminProfileStatusRouteSchema,
  adminUpdateProductRouteSchema,
  adminUpdateProfileRouteSchema,
  adminUpdateVariantRouteSchema,
  adminVariantStatusRouteSchema,
  cancelOrderRouteSchema,
  createPaymentRouteSchema,
  getPaymentRouteSchema,
  paymentWebhookRouteSchema,
  getOrderRouteSchema,
  listOrdersRouteSchema,
  listProductsRouteSchema,
  placeOrderRouteSchema,
  publicProductRouteSchema,
  publicVariantsRouteSchema,
} from './schemas.js';

export interface CommerceRoutesOptions {
  services: CommerceServices;
  auth: AuthService;
  cookie: SessionCookieConfig;
}

/** Prefix of the administration routes, relative to the documented `/api/v1`. */
export const ADMIN_ROUTE_PREFIX = '/admin';

/** `{ data: <value> }`. The envelope is the only success shape this API returns. */
function data(value: Record<string, unknown>): { data: Record<string, unknown> } {
  return { data: value };
}

function idParam(request: FastifyRequest): string {
  const { id } = request.params as { id: string };

  return id;
}

function slugParam(request: FastifyRequest): string {
  const { slug } = request.params as { slug: string };

  return slug;
}

/**
 * Registers every commerce route under `/api/v1`.
 *
 * The module needs the authentication service (for the guards) and the composed
 * domain services; it never receives a database client.
 */
export function registerCommerceRoutes(
  app: FastifyInstance,
  options: CommerceRoutesOptions,
): void {
  const { services, auth, cookie } = options;
  const authenticate = requireAuth({ auth, cookie });
  const authorizeAdmin = requireRole('ADMIN');
  /** Ownership of a customer's order, resolved from the URL (never the body). */
  const authorizeOrderOwner = requireOwnership(async (request) =>
    services.orders.findOwnerUserId(idParam(request)),
  );

  app.register(
    (scope) => {
      registerPublicCatalogRoutes(scope, services);

      scope.register(
        (admin) => {
          registerAdminProductRoutes(admin, services, authenticate, authorizeAdmin);
          registerAdminProfileRoutes(admin, services, authenticate, authorizeAdmin, '');
        },
        { prefix: ADMIN_ROUTE_PREFIX },
      );

      // The phase-2 route contract also names `/api/v1/resource-profiles`; the
      // same guarded handlers are mounted there (docs/API.md → Resource profiles).
      registerAdminProfileRoutes(scope, services, authenticate, authorizeAdmin, '');

      registerOrderRoutes(scope, services, authenticate, authorizeOrderOwner);
      registerPaymentRoutes(scope, services, authenticate);
    },
    { prefix: '/api/v1' },
  );
}

function registerPaymentRoutes(
  app: FastifyInstance,
  services: CommerceServices,
  authenticate: preHandlerHookHandler,
): void {
  const authorizePaymentOwner = requireOwnership(async (request) =>
    services.payments.findOwnerUserId(idParam(request)),
  );

  app.post('/payments/create', { schema: createPaymentRouteSchema, preHandler: authenticate }, async (request, reply) => {
    const { user } = authContextOf(request);
    const body = request.body as { orderId: string; provider: string };
    const payment = await services.payments.createPayment(user.id, body.orderId, body.provider);
    return reply.status(201).send(data({ payment }));
  });

  app.get('/payments/:id', { schema: getPaymentRouteSchema, preHandler: [authenticate, authorizePaymentOwner] }, async (request) => {
    const { user } = authContextOf(request);
    return data({ payment: await services.payments.getPaymentForUser(user.id, idParam(request)) });
  });

  app.post('/webhooks/payments/:provider', { schema: paymentWebhookRouteSchema }, async (request) => {
    const { provider } = request.params as { provider: string };
    const signature = request.headers['x-payment-signature'] as string | undefined;
    const result = await services.payments.processWebhook(provider, request.body, signature);
    return data({ duplicate: result.duplicate });
  });
}

/** Public catalog: no authentication, publicly available entries only. */
function registerPublicCatalogRoutes(app: FastifyInstance, services: CommerceServices): void {
  app.get('/products', { schema: listProductsRouteSchema }, async (request) => {
    const query = request.query as {
      type?: ProductType;
      serviceType?: string;
      limit?: number;
      offset?: number;
    };

    return data({
      products: await services.catalog.listProducts({
        ...(query.type === undefined ? {} : { type: query.type }),
        ...(query.serviceType === undefined ? {} : { serviceType: query.serviceType }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      }),
    });
  });

  app.get('/products/:slug', { schema: publicProductRouteSchema }, async (request) =>
    data({ product: await services.catalog.getProductBySlug(slugParam(request)) }),
  );

  app.get('/products/:id/variants', { schema: publicVariantsRouteSchema }, async (request) =>
    data({ variants: await services.catalog.listVariantsForProduct(idParam(request)) }),
  );
}

/** Administrator product and variant operations. Every handler requires ADMIN. */
function registerAdminProductRoutes(
  app: FastifyInstance,
  services: CommerceServices,
  authenticate: preHandlerHookHandler,
  authorizeAdmin: preHandlerHookHandler,
): void {
  const guard = [authenticate, authorizeAdmin];

  app.get(
    '/products',
    { schema: adminListProductsRouteSchema, preHandler: guard },
    async (request) => {
      const query = request.query as {
        includeArchived?: boolean;
        type?: ProductType;
        serviceType?: string;
        limit?: number;
        offset?: number;
      };

      return data({
        products: await services.products.list({
          ...(query.includeArchived === true ? { includeArchived: true } : {}),
          ...(query.type === undefined ? {} : { type: query.type }),
          ...(query.serviceType === undefined ? {} : { serviceType: query.serviceType }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
          ...(query.offset === undefined ? {} : { offset: query.offset }),
        }),
      });
    },
  );

  app.post(
    '/products',
    { schema: adminCreateProductRouteSchema, preHandler: guard },
    async (request, reply) => {
      const product = await services.products.create(request.body);

      return reply.status(201).send(data({ product }));
    },
  );

  app.get(
    '/products/:id',
    { schema: adminGetProductRouteSchema, preHandler: guard },
    async (request) => data({ product: await services.products.getById(idParam(request)) }),
  );

  app.patch(
    '/products/:id',
    { schema: adminUpdateProductRouteSchema, preHandler: guard },
    async (request) =>
      data({ product: await services.products.update(idParam(request), request.body) }),
  );

  app.post(
    '/products/:id/status',
    { schema: adminProductStatusRouteSchema, preHandler: guard },
    async (request) =>
      data({ product: await services.products.changeStatus(idParam(request), request.body) }),
  );

  // Retiring a product archives it: order items must keep referencing it.
  app.delete(
    '/products/:id',
    { schema: adminArchiveProductRouteSchema, preHandler: guard },
    async (request) => data({ product: await services.products.archive(idParam(request)) }),
  );

  app.get(
    '/products/:id/variants',
    { schema: adminListVariantsRouteSchema, preHandler: guard },
    async (request) => data({ variants: await services.variants.listForAdmin(idParam(request)) }),
  );

  app.post(
    '/products/:id/variants',
    { schema: adminCreateVariantRouteSchema, preHandler: guard },
    async (request, reply) => {
      const variant = await services.variants.create(idParam(request), request.body);

      return reply.status(201).send(data({ variant }));
    },
  );

  app.get(
    '/product-variants/:id',
    { schema: adminGetVariantRouteSchema, preHandler: guard },
    async (request) => data({ variant: await services.variants.getById(idParam(request)) }),
  );

  app.patch(
    '/product-variants/:id',
    { schema: adminUpdateVariantRouteSchema, preHandler: guard },
    async (request) =>
      data({ variant: await services.variants.update(idParam(request), request.body) }),
  );

  app.post(
    '/product-variants/:id/status',
    { schema: adminVariantStatusRouteSchema, preHandler: guard },
    async (request) =>
      data({ variant: await services.variants.changeStatus(idParam(request), request.body) }),
  );

  // Taking a plan off sale deactivates it; a variant that was bought must not vanish.
  app.delete(
    '/product-variants/:id',
    { schema: adminArchiveVariantRouteSchema, preHandler: guard },
    async (request) => data({ variant: await services.variants.deactivate(idParam(request)) }),
  );
}

/**
 * Administrator resource-profile operations.
 *
 * A profile is configuration data: it describes the resource class a product
 * offers. It never claims enforcement (docs/RESOURCE_ISOLATION.md); applying
 * limits belongs to the runtime phase.
 *
 * Registered twice — under `/admin/resource-profiles` (the documented admin
 * surface) and under `/resource-profiles` (the route contract of this phase).
 * Both mounts carry the same ADMIN guard.
 */
function registerAdminProfileRoutes(
  app: FastifyInstance,
  services: CommerceServices,
  authenticate: preHandlerHookHandler,
  authorizeAdmin: preHandlerHookHandler,
  base: string,
): void {
  const guard = [authenticate, authorizeAdmin];

  app.get(
    `${base}/resource-profiles`,
    { schema: adminListProfilesRouteSchema, preHandler: guard },
    async (request) => {
      const { includeInactive } = request.query as { includeInactive?: boolean };

      return data({
        profiles: await services.resourceProfiles.list({
          includeInactive: includeInactive === true,
        }),
      });
    },
  );

  app.get(
    `${base}/resource-profiles/:id`,
    { schema: adminGetProfileRouteSchema, preHandler: guard },
    async (request) => data({ profile: await services.resourceProfiles.getById(idParam(request)) }),
  );

  app.post(
    `${base}/resource-profiles`,
    { schema: adminCreateProfileRouteSchema, preHandler: guard },
    async (request, reply) => {
      const profile = await services.resourceProfiles.create(request.body);

      return reply.status(201).send(data({ profile }));
    },
  );

  app.patch(
    `${base}/resource-profiles/:id`,
    { schema: adminUpdateProfileRouteSchema, preHandler: guard },
    async (request) =>
      data({ profile: await services.resourceProfiles.update(idParam(request), request.body) }),
  );

  app.delete(
    `${base}/resource-profiles/:id`,
    { schema: adminArchiveProfileRouteSchema, preHandler: guard },
    async (request) =>
      data({ profile: await services.resourceProfiles.setActive(idParam(request), false) }),
  );

  app.post(
    `${base}/resource-profiles/:id/status`,
    { schema: adminProfileStatusRouteSchema, preHandler: guard },
    async (request) => {
      const { active } = request.body as { active: boolean };

      return data({ profile: await services.resourceProfiles.setActive(idParam(request), active) });
    },
  );
}

/**
 * Customer order routes.
 *
 * The owner is always the authenticated caller; `authorizeOrderOwner` resolves
 * ownership from the URL id so another tenant's order is reported as 404
 * (docs/API.md → Orders, `.clinerules` → hidden-resource behaviour).
 */
function registerOrderRoutes(
  app: FastifyInstance,
  services: CommerceServices,
  authenticate: preHandlerHookHandler,
  authorizeOrderOwner: preHandlerHookHandler,
): void {
  app.post(
    '/orders',
    { schema: placeOrderRouteSchema, preHandler: authenticate },
    async (request, reply) => {
      const { user } = authContextOf(request);
      const order = await services.orders.placeOrder(user.id, request.body);

      return reply.status(201).send(data({ order }));
    },
  );

  app.get(
    '/orders',
    { schema: listOrdersRouteSchema, preHandler: authenticate },
    async (request) => {
      const { user } = authContextOf(request);
      const { limit, offset } = request.query as { limit?: number; offset?: number };

      return data({
        orders: await services.orders.listForUser(user.id, {
          ...(limit === undefined ? {} : { limit }),
          ...(offset === undefined ? {} : { offset }),
        }),
      });
    },
  );

  const ownerGuard = [authenticate, authorizeOrderOwner];

  app.get(
    '/orders/:id',
    { schema: getOrderRouteSchema, preHandler: ownerGuard },
    async (request) => {
      const { user } = authContextOf(request);

      return data({ order: await services.orders.getForUser(user.id, idParam(request)) });
    },
  );

  app.post(
    '/orders/:id/cancel',
    { schema: cancelOrderRouteSchema, preHandler: ownerGuard },
    async (request) => {
      const { user } = authContextOf(request);

      return data({ order: await services.orders.cancel(user.id, idParam(request)) });
    },
  );
}



