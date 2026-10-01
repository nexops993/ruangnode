/**
 * Request and response schemas for the commerce endpoints.
 *
 * Two jobs, exactly like the authentication schemas:
 *
 *   1. **validate the boundary**: a body that is not shaped as the domain expects
 *      fails with `422 VALIDATION_FAILED` before any service runs, and unknown
 *      fields are removed (never forwarded to the domain)
 *   2. **bound the response**: `additionalProperties: false` means fast-json-stringify
 *      only ever emits the listed fields. A projection that accidentally carried a
 *      password hash or an internal column would be trimmed here, so the response
 *      contract cannot silently widen
 *
 * Money and byte quantities are strings on the wire: `BigInt` must never reach
 * `JSON.stringify`. The shape is documented in docs/API.md:
 *
 *     { "amount": "40000", "currency": "IDR" }
 *
 * Enum members are read from the schema enums (`@ruangnode/database`) so a new
 * value cannot be missing here.
 */
import {
  BillingPeriod,
  DiskPolicy,
  MemorySwapPolicy,
  OrderStatus,
  PaymentStatus,
  ProductStatus,
  ProductType,
} from '@ruangnode/database';
import type { FastifySchema } from 'fastify';

export const COMMERCE_ROUTE_PREFIX = '/api/v1';

/** Same envelope as the authentication endpoints (docs/API.md → Standard response). */
export const errorResponseSchema = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        retryable: { type: 'boolean' },
      },
    },
  },
} as const;

/** JSON-safe money: integer minor units as a decimal string. */
const moneySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['amount', 'currency'],
  properties: {
    amount: { type: 'string', pattern: '^(?:0|[1-9][0-9]*)$' },
    currency: { type: 'string', minLength: 3, maxLength: 3 },
  },
} as const;

/** `{ data: <value> }`, the success envelope used by this API. */
function dataResponse(value: object): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['data'],
    properties: { data: value },
  };
}

const idParamSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

const resourceProfileProperties = {
  id: { type: 'string' },
  name: { type: 'string' },
  cpuLimitMillicores: { type: 'integer' },
  memoryLimitBytes: { type: 'string' },
  memorySwapBytes: { type: ['string', 'null'] },
  memorySwapPolicy: { type: 'string', enum: [...Object.values(MemorySwapPolicy)] },
  diskLimitBytes: { type: 'string' },
  diskPolicy: { type: 'string', enum: [...Object.values(DiskPolicy)] },
  pidsLimit: { type: 'integer' },
  networkPolicy: { type: ['string', 'null'] },
  description: { type: ['string', 'null'] },
} as const;

const publicResourceProfileSchema = {
  type: 'object',
  additionalProperties: false,
  required: Object.keys(resourceProfileProperties),
  properties: resourceProfileProperties,
} as const;

const adminResourceProfileSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...Object.keys(resourceProfileProperties), 'active', 'createdAt', 'updatedAt'],
  properties: {
    ...resourceProfileProperties,
    active: { type: 'boolean' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const;

const publicVariantProperties = {
  id: { type: 'string' },
  name: { type: 'string' },
  sku: { type: 'string' },
  billingPeriod: { type: 'string', enum: [...Object.values(BillingPeriod)] },
  price: moneySchema,
  storageQuotaBytes: { type: ['string', 'null'] },
  // A variant without a resource class (digital product) serialises as null.
  resourceProfile: { ...publicResourceProfileSchema, nullable: true },
  // A JSON Schema object, or null when the variant takes no configuration.
  configurationSchema: { type: ['object', 'null'] },
} as const;

const publicVariantSchema = {
  type: 'object',
  additionalProperties: false,
  required: Object.keys(publicVariantProperties),
  properties: publicVariantProperties,
} as const;

const publicProductSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'slug', 'name', 'description', 'type', 'serviceType', 'priceFrom', 'variants'],
  properties: {
    id: { type: 'string' },
    slug: { type: 'string' },
    name: { type: 'string' },
    description: { type: ['string', 'null'] },
    type: { type: 'string', enum: [...Object.values(ProductType)] },
    serviceType: { type: ['string', 'null'] },
    priceFrom: { ...moneySchema, nullable: true },
    variants: { type: 'array', items: publicVariantSchema },
  },
} as const;

const adminVariantProperties = {
  id: { type: 'string' },
  productId: { type: 'string' },
  name: { type: 'string' },
  sku: { type: 'string' },
  price: moneySchema,
  currency: { type: 'string' },
  billingPeriod: { type: 'string', enum: [...Object.values(BillingPeriod)] },
  resourceProfileId: { type: ['string', 'null'] },
  // A variant without a resource class (digital product) serialises as null.
  resourceProfile: { ...publicResourceProfileSchema, nullable: true },
  storageQuotaBytes: { type: ['string', 'null'] },
  // A JSON Schema object, or null when the variant takes no configuration.
  configurationSchema: { type: ['object', 'null'] },
  status: { type: 'string', enum: [...Object.values(ProductStatus)] },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
} as const;

const adminVariantSchema = {
  type: 'object',
  additionalProperties: false,
  required: Object.keys(adminVariantProperties),
  properties: adminVariantProperties,
} as const;

const adminProductSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'slug', 'name', 'description', 'type', 'status', 'serviceType', 'createdAt', 'updatedAt', 'variants'],
  properties: {
    id: { type: 'string' },
    slug: { type: 'string' },
    name: { type: 'string' },
    description: { type: ['string', 'null'] },
    type: { type: 'string', enum: [...Object.values(ProductType)] },
    status: { type: 'string', enum: [...Object.values(ProductStatus)] },
    serviceType: { type: ['string', 'null'] },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    variants: { type: 'array', items: adminVariantSchema },
  },
} as const;

// ---------------------------------------------------------------------------
// Request shapes
// ---------------------------------------------------------------------------

/** Public catalog listing (`type` and `serviceType` are optional filters). */
const listProductsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: [...Object.values(ProductType)] },
    serviceType: { type: 'string', minLength: 1, maxLength: 64 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    offset: { type: 'integer', minimum: 0, maximum: 10_000 },
  },
} as const;

const listAdminProductsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    includeArchived: { type: 'boolean' },
    type: { type: 'string', enum: [...Object.values(ProductType)] },
    serviceType: { type: 'string', minLength: 1, maxLength: 64 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    offset: { type: 'integer', minimum: 0, maximum: 10_000 },
  },
} as const;

const listProfilesQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { includeInactive: { type: 'boolean' } },
} as const;

const listOrdersQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    offset: { type: 'integer', minimum: 0, maximum: 10_000 },
  },
} as const;

const slugParamSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['slug'],
  properties: { slug: { type: 'string', minLength: 3, maxLength: 80 } },
} as const;

/** A price is an integer number of minor units: a decimal string or an integer. */
const priceMinorProperty = {
  anyOf: [
    { type: 'string', pattern: '^[0-9]{1,19}$', minLength: 1, maxLength: 19 },
    { type: 'integer', minimum: 1 },
  ],
} as const;

const createProductBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['slug', 'name', 'type'],
  properties: {
    slug: { type: 'string', minLength: 3, maxLength: 80, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },
    name: { type: 'string', minLength: 1, maxLength: 160 },
    description: { type: ['string', 'null'], maxLength: 4_000 },
    type: { type: 'string', enum: [...Object.values(ProductType)] },
    serviceType: { type: ['string', 'null'], maxLength: 64 },
  },
} as const;

const updateProductBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    slug: { type: 'string', minLength: 3, maxLength: 80, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },
    name: { type: 'string', minLength: 1, maxLength: 160 },
    description: { type: ['string', 'null'], maxLength: 4_000 },
    type: { type: 'string', enum: [...Object.values(ProductType)] },
    serviceType: { type: ['string', 'null'], maxLength: 64 },
  },
} as const;

/**
 * Lifecycle target.
 *
 * The client only ever names the status it wants; the service decides whether
 * the guarded state machine allows the transition.
 */
const productStatusBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: { status: { type: 'string', enum: [...Object.values(ProductStatus)] } },
} as const;

const createVariantBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'sku', 'priceMinor', 'currency', 'billingPeriod'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 160 },
    sku: {
      type: 'string',
      minLength: 3,
      maxLength: 64,
      pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$',
    },
    priceMinor: priceMinorProperty,
    currency: { type: 'string', minLength: 3, maxLength: 3, pattern: '^[A-Z]{3}$' },
    billingPeriod: { type: 'string', enum: [...Object.values(BillingPeriod)] },
    resourceProfileId: { type: ['string', 'null'], format: 'uuid' },
    storageQuotaBytes: {
      anyOf: [
        { type: 'string', pattern: '^[0-9]{1,20}$' },
        { type: 'integer', minimum: 0 },
        { type: 'null' },
      ],
    },
    configurationSchema: { type: ['object', 'null'] },
  },
} as const;

const updateVariantBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: createVariantBodySchema.properties,
} as const;

const byteQuantityProperty = {
  anyOf: [
    { type: 'string', pattern: '^[0-9]{1,20}$' },
    { type: 'integer', minimum: 1 },
  ],
} as const;

const createProfileBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'cpuLimitMillicores', 'memoryLimitBytes', 'diskLimitBytes', 'pidsLimit'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    cpuLimitMillicores: { type: 'integer', minimum: 100, maximum: 64_000 },
    memoryLimitBytes: byteQuantityProperty,
    memorySwapPolicy: { type: 'string', enum: [...Object.values(MemorySwapPolicy)] },
    memorySwapBytes: {
      anyOf: [
        { type: 'string', pattern: '^[0-9]{1,20}$' },
        { type: 'integer', minimum: 1 },
        { type: 'null' },
      ],
    },
    diskLimitBytes: byteQuantityProperty,
    diskPolicy: { type: 'string', enum: [...Object.values(DiskPolicy)] },
    pidsLimit: { type: 'integer', minimum: 32, maximum: 32_768 },
    networkPolicy: { type: ['string', 'null'], maxLength: 64 },
    description: { type: ['string', 'null'], maxLength: 1_000 },
    active: { type: 'boolean' },
  },
} as const;

const updateProfileBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: createProfileBodySchema.properties,
} as const;

const profileStatusBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['active'],
  properties: { active: { type: 'boolean' } },
} as const;

/**
 * Order creation: only *what* to buy.
 *
 * There is deliberately no property for price, currency, discount, total,
 * status, payment/provisioning state or owner — the server computes and owns all
 * of them (docs/API.md → Orders). Unknown fields are removed by AJV before the
 * handler runs, so a tampered `total` or `status` never reaches the service.
 */
const placeOrderBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['productId', 'variantId'],
  properties: {
    productId: { type: 'string', format: 'uuid' },
    variantId: { type: 'string', format: 'uuid' },
    quantity: { type: 'integer', minimum: 1, maximum: 10 },
  },
} as const;

// ---------------------------------------------------------------------------
// Route schemas
// ---------------------------------------------------------------------------

const publicResponses = { 404: errorResponseSchema, 422: errorResponseSchema } as const;

const adminWriteResponses = {
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  422: errorResponseSchema,
} as const;

const authenticatedResponses = {
  401: errorResponseSchema,
  404: errorResponseSchema,
  422: errorResponseSchema,
} as const;

/**
 * An order as its owner sees it.
 *
 * `snapshot` is the commercial snapshot stored with the line (docs/DATABASE.md →
 * OrderItem): product, variant and resource-class values captured at purchase
 * time, and nothing else.
 */
const orderProperties = {
  id: { type: 'string' },
  userId: { type: 'string' },
  status: { type: 'string', enum: [...Object.values(OrderStatus)] },
  currency: { type: 'string' },
  subtotal: moneySchema,
  discount: moneySchema,
  total: moneySchema,
  expiresAt: { type: ['string', 'null'] },
  createdAt: { type: 'string' },
  updatedAt: { type: 'string' },
  items: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'productVariantId', 'quantity', 'unitPrice', 'totalPrice', 'snapshot'],
      properties: {
        id: { type: 'string' },
        productVariantId: { type: 'string' },
        quantity: { type: 'integer' },
        unitPrice: moneySchema,
        totalPrice: moneySchema,
        snapshot: { type: 'object' },
      },
    },
  },
} as const;

const orderSchema = {
  type: 'object',
  additionalProperties: false,
  required: Object.keys(orderProperties),
  properties: orderProperties,
} as const;

const paymentSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'orderId', 'provider', 'providerPaymentId', 'status', 'amount', 'paidAt', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string' },
    orderId: { type: 'string' },
    provider: { type: 'string' },
    providerPaymentId: { type: 'string' },
    status: { type: 'string', enum: [...Object.values(PaymentStatus)] },
    amount: moneySchema,
    paidAt: { type: ['string', 'null'] },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const;

const createPaymentBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['orderId', 'provider'],
  properties: {
    orderId: { type: 'string', format: 'uuid' },
    provider: { type: 'string', minLength: 1, maxLength: 64 },
  },
} as const;

const paymentWebhookBodySchema = { type: 'object', additionalProperties: true } as const;

/** `GET /api/v1/products` — public catalog. */
export const listProductsRouteSchema = {
  querystring: listProductsQuerySchema,
  response: {
    200: dataResponse({ products: { type: 'array', items: publicProductSchema } }),
    ...publicResponses,
  },
} satisfies FastifySchema;

/** `GET /api/v1/products/:slug` — public product detail. */
export const publicProductRouteSchema = {
  params: slugParamSchema,
  response: {
    200: dataResponse({ product: publicProductSchema }),
    ...publicResponses,
  },
} satisfies FastifySchema;

/** `GET /api/v1/products/:id/variants` — public variants of a published product. */
export const publicVariantsRouteSchema = {
  params: idParamSchema,
  response: {
    200: dataResponse({ variants: { type: 'array', items: publicVariantSchema } }),
    ...publicResponses,
  },
} satisfies FastifySchema;

/** `GET /api/v1/admin/products` — admin listing, drafts included. */
export const adminListProductsRouteSchema = {
  querystring: listAdminProductsQuerySchema,
  response: {
    200: dataResponse({ products: { type: 'array', items: adminProductSchema } }),
    401: errorResponseSchema,
    403: errorResponseSchema,
    422: errorResponseSchema,
  },
} satisfies FastifySchema;

/** `POST /api/v1/admin/products` — always creates a `DRAFT`. */
export const adminCreateProductRouteSchema = {
  body: createProductBodySchema,
  response: {
    201: dataResponse({ product: adminProductSchema }),
    ...adminWriteResponses,
  },
} satisfies FastifySchema;

/** `GET /api/v1/admin/products/:id` — admin detail with every variant. */
export const adminGetProductRouteSchema = {
  params: idParamSchema,
  response: {
    200: dataResponse({ product: adminProductSchema }),
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    422: errorResponseSchema,
  },
} satisfies FastifySchema;

/** `PATCH /api/v1/admin/products/:id`. */
export const adminUpdateProductRouteSchema = {
  params: idParamSchema,
  body: updateProductBodySchema,
  response: {
    200: dataResponse({ product: adminProductSchema }),
    ...adminWriteResponses,
  },
} satisfies FastifySchema;

/** `POST /api/v1/admin/products/:id/status` — guarded publish/unpublish/archive. */
export const adminProductStatusRouteSchema = {
  params: idParamSchema,
  body: productStatusBodySchema,
  response: {
    200: dataResponse({ product: adminProductSchema }),
    ...adminWriteResponses,
  },
} satisfies FastifySchema;

/** `DELETE /api/v1/admin/products/:id` — archives (never hard-deletes). */
export const adminArchiveProductRouteSchema = {
  params: idParamSchema,
  response: {
    200: dataResponse({ product: adminProductSchema }),
    ...adminWriteResponses,
  },
} satisfies FastifySchema;

/** `POST /api/v1/admin/products/:id/variants` — always creates a `DRAFT`. */
export const adminCreateVariantRouteSchema = {
  params: idParamSchema,
  body: createVariantBodySchema,
  response: {
    201: dataResponse({ variant: adminVariantSchema }),
    ...adminWriteResponses,
  },
} satisfies FastifySchema;

/** `GET /api/v1/admin/products/:id/variants` — every variant of a product. */
export const adminListVariantsRouteSchema = {
  params: idParamSchema,
  response: {
    200: dataResponse({ variants: { type: 'array', items: adminVariantSchema } }),
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    422: errorResponseSchema,
  },
} satisfies FastifySchema;

/** `GET /api/v1/admin/product-variants/:id`. */
export const adminGetVariantRouteSchema = {
  params: idParamSchema,
  response: {
    200: dataResponse({ variant: adminVariantSchema }),
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    422: errorResponseSchema,
  },
} satisfies FastifySchema;

/** `PATCH /api/v1/admin/product-variants/:id`. */
export const adminUpdateVariantRouteSchema = {
  params: idParamSchema,
  body: updateVariantBodySchema,
  response: {
    200: dataResponse({ variant: adminVariantSchema }),
    ...adminWriteResponses,
  },
} satisfies FastifySchema;

/** `POST /api/v1/admin/product-variants/:id/status` — guarded activation. */
export const adminVariantStatusRouteSchema = {
  params: idParamSchema,
  body: productStatusBodySchema,
  response: {
    200: dataResponse({ variant: adminVariantSchema }),
    ...adminWriteResponses,
  },
} satisfies FastifySchema;

/** `DELETE /api/v1/admin/product-variants/:id` — deactivates, never deletes. */
export const adminArchiveVariantRouteSchema = {
  params: idParamSchema,
  response: {
    200: dataResponse({ variant: adminVariantSchema }),
    ...adminWriteResponses,
  },
} satisfies FastifySchema;

/** `GET /api/v1/admin/resource-profiles` (also mounted at `/api/v1/resource-profiles`). */
export const adminListProfilesRouteSchema = {
  querystring: listProfilesQuerySchema,
  response: {
    200: dataResponse({ profiles: { type: 'array', items: adminResourceProfileSchema } }),
    401: errorResponseSchema,
    403: errorResponseSchema,
    422: errorResponseSchema,
  },
} satisfies FastifySchema;

/** `GET /api/v1/admin/resource-profiles/:id`. */
export const adminGetProfileRouteSchema = {
  params: idParamSchema,
  response: {
    200: dataResponse({ profile: adminResourceProfileSchema }),
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    422: errorResponseSchema,
  },
} satisfies FastifySchema;

/** `POST /api/v1/admin/resource-profiles`. */
export const adminCreateProfileRouteSchema = {
  body: createProfileBodySchema,
  response: {
    201: dataResponse({ profile: adminResourceProfileSchema }),
    ...adminWriteResponses,
  },
} satisfies FastifySchema;

/** `PATCH /api/v1/admin/resource-profiles/:id`. */
export const adminUpdateProfileRouteSchema = {
  params: idParamSchema,
  body: updateProfileBodySchema,
  response: {
    200: dataResponse({ profile: adminResourceProfileSchema }),
    ...adminWriteResponses,
  },
} satisfies FastifySchema;

/** `DELETE /api/v1/admin/resource-profiles/:id` — deactivates, never deletes. */
export const adminArchiveProfileRouteSchema = {
  params: idParamSchema,
  response: {
    200: dataResponse({ profile: adminResourceProfileSchema }),
    ...adminWriteResponses,
  },
} satisfies FastifySchema;

/** `POST /api/v1/admin/resource-profiles/:id/status` — activate/deactivate. */
export const adminProfileStatusRouteSchema = {
  params: idParamSchema,
  body: profileStatusBodySchema,
  response: {
    200: dataResponse({ profile: adminResourceProfileSchema }),
    ...adminWriteResponses,
  },
} satisfies FastifySchema;

/** `POST /api/v1/orders` — the authenticated customer only. */
export const placeOrderRouteSchema = {
  body: placeOrderBodySchema,
  response: {
    201: dataResponse({ order: orderSchema }),
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    422: errorResponseSchema,
  },
} satisfies FastifySchema;

/** `GET /api/v1/orders` — the caller's own orders. */
export const listOrdersRouteSchema = {
  querystring: listOrdersQuerySchema,
  response: {
    200: dataResponse({ orders: { type: 'array', items: orderSchema } }),
    401: errorResponseSchema,
    422: errorResponseSchema,
  },
} satisfies FastifySchema;

/** `GET /api/v1/orders/:id` — the caller's own order; another tenant's is 404. */
export const getOrderRouteSchema = {
  params: idParamSchema,
  response: {
    200: dataResponse({ order: orderSchema }),
    ...authenticatedResponses,
  },
} satisfies FastifySchema;

/** `POST /api/v1/orders/:id/cancel` — only a `PENDING` order of the caller. */
export const cancelOrderRouteSchema = {
  params: idParamSchema,
  response: {
    200: dataResponse({ order: orderSchema }),
    401: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    422: errorResponseSchema,
  },
} satisfies FastifySchema;

export const createPaymentRouteSchema = {
  body: createPaymentBodySchema,
  response: { 201: dataResponse({ payment: paymentSchema }), 401: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema, 503: errorResponseSchema, 422: errorResponseSchema },
} satisfies FastifySchema;

export const getPaymentRouteSchema = {
  params: idParamSchema,
  response: { 200: dataResponse({ payment: paymentSchema }), 401: errorResponseSchema, 404: errorResponseSchema, 422: errorResponseSchema },
} satisfies FastifySchema;

export const paymentWebhookRouteSchema = {
  params: { type: 'object', additionalProperties: false, required: ['provider'], properties: { provider: { type: 'string', minLength: 1, maxLength: 64 } } },
  headers: { type: 'object', properties: { 'x-payment-signature': { type: 'string' } } },
  body: paymentWebhookBodySchema,
  response: { 200: dataResponse({ duplicate: { type: 'boolean' } }), 400: errorResponseSchema, 404: errorResponseSchema, 503: errorResponseSchema, 422: errorResponseSchema },
} satisfies FastifySchema;







