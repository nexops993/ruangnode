import { describe, expect, it } from 'vitest';

import { registerUser } from '../auth/test-harness.js';
import { createCommerceTestServer } from './test-harness.js';

function uuid(): string {
  return crypto.randomUUID();
}

type CommerceServer = ReturnType<typeof createCommerceTestServer>;

async function seedPurchasable(server: CommerceServer): Promise<{
  profileId: string;
  productId: string;
  variantId: string;
}> {
  const profile = await server.commerceServices.resourceProfiles.create({
    name: `profile-${uuid().slice(0, 8)}`,
    cpuLimitMillicores: 1000,
    memoryLimitBytes: '536870912',
    diskLimitBytes: '10737418240',
    pidsLimit: 256,
  });
  const product = await server.commerceServices.products.create({
    slug: `product-${uuid().slice(0, 8)}`,
    name: 'Hermes Agent (Managed)',
    type: 'MANAGED_SERVICE',
    serviceType: 'hermes',
  });
  const variant = await server.commerceServices.variants.create(product.id, {
    name: 'Starter',
    sku: `SKU-${uuid().slice(0, 8).toUpperCase()}`,
    priceMinor: '40000',
    currency: 'IDR',
    billingPeriod: 'MONTHLY',
    resourceProfileId: profile.id,
  });

  await server.commerceServices.variants.changeStatus(variant.id, { status: 'ACTIVE' });
  await server.commerceServices.products.changeStatus(product.id, { status: 'ACTIVE' });

  return { profileId: profile.id, productId: product.id, variantId: variant.id };
}

async function adminCookie(server: CommerceServer): Promise<string> {
  const registered = await registerUser(server, `admin-${uuid()}@example.com`);

  server.store.setUserRole(registered.userId, 'ADMIN');

  return registered.cookie;
}

describe('commerce API', () => {
  it('hides inactive products from the public catalog', async () => {
    const server = createCommerceTestServer();
    const seeded = await seedPurchasable(server);
    const profile = await server.commerceServices.resourceProfiles.create({
      name: `hidden-${uuid().slice(0, 8)}`,
      cpuLimitMillicores: 500,
      memoryLimitBytes: '268435456',
      diskLimitBytes: '5368709120',
      pidsLimit: 128,
    });
    const hidden = await server.commerceServices.products.create({
      slug: `hidden-${uuid().slice(0, 8)}`,
      name: 'Hidden',
      type: 'MANAGED_SERVICE',
      serviceType: 'hermes',
    });
    await server.commerceServices.variants.create(hidden.id, {
      name: 'Hidden plan',
      sku: `HID-${uuid().slice(0, 8).toUpperCase()}`,
      priceMinor: '10000',
      currency: 'IDR',
      billingPeriod: 'MONTHLY',
      resourceProfileId: profile.id,
    });

    const listed = await server.app.inject({ method: 'GET', url: '/api/v1/products' });
    expect(listed.statusCode).toBe(200);
    const ids = listed
      .json<{ data: { products: Array<{ id: string }> } }>()
      .data.products.map((item) => item.id);
    expect(ids).toContain(seeded.productId);
    expect(ids).not.toContain(hidden.id);

    const missing = await server.app.inject({
      method: 'GET',
      url: `/api/v1/products/${hidden.slug}`,
    });
    expect(missing.statusCode).toBe(404);

    await server.close();
  });

  it('lets an admin create a product and blocks customers from doing so', async () => {
    const server = createCommerceTestServer();
    const admin = await adminCookie(server);
    const customer = await registerUser(server, `customer-${uuid()}@example.com`);

    const created = await server.app.inject({
      method: 'POST',
      url: '/api/v1/admin/products',
      headers: { cookie: admin },
      payload: { slug: `slug-${uuid().slice(0, 8)}`, name: 'Managed', type: 'MANAGED_SERVICE' },
    });
    expect(created.statusCode).toBe(201);

    const forbidden = await server.app.inject({
      method: 'POST',
      url: '/api/v1/admin/products',
      headers: { cookie: customer.cookie },
      payload: { slug: `slug-${uuid().slice(0, 8)}`, name: 'Managed', type: 'MANAGED_SERVICE' },
    });
    expect(forbidden.statusCode).toBe(403);

    const anonymous = await server.app.inject({
      method: 'POST',
      url: '/api/v1/admin/products',
      payload: { slug: `slug-${uuid().slice(0, 8)}`, name: 'Managed', type: 'MANAGED_SERVICE' },
    });
    expect(anonymous.statusCode).toBe(401);

    await server.close();
  });

  it('creates an order with server-side pricing and isolates customers', async () => {
    const server = createCommerceTestServer();
    const seeded = await seedPurchasable(server);
    const customer = await registerUser(server, `buyer-${uuid()}@example.com`);
    const other = await registerUser(server, `other-${uuid()}@example.com`);

    const created = await server.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { cookie: customer.cookie },
      payload: {
        productId: seeded.productId,
        variantId: seeded.variantId,
        quantity: 2,
        total: '1',
        status: 'PAID',
        userId: other.userId,
      },
    });
    expect(created.statusCode).toBe(201);
    const order = created.json<{ data: { order: OrderPayload } }>().data.order;
    expect(order.userId).toBe(customer.userId);
    expect(order.status).toBe('PENDING');
    expect(order.currency).toBe('IDR');
    expect(order.total.amount).toBe('80000');
    expect(order.items).toHaveLength(1);
    expect(order.items[0]?.snapshot).toMatchObject({ snapshotVersion: 1 });

    const mine = await server.app.inject({
      method: 'GET',
      url: '/api/v1/orders',
      headers: { cookie: customer.cookie },
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json<{ data: { orders: unknown[] } }>().data.orders).toHaveLength(1);

    const theirs = await server.app.inject({
      method: 'GET',
      url: `/api/v1/orders/${order.id}`,
      headers: { cookie: other.cookie },
    });
    expect(theirs.statusCode).toBe(404);

    const anonymous = await server.app.inject({ method: 'GET', url: '/api/v1/orders' });
    expect(anonymous.statusCode).toBe(401);

    await server.close();
  });

  it('rejects a mismatched variant and a deactivated profile', async () => {
    const server = createCommerceTestServer();
    const seeded = await seedPurchasable(server);
    const customer = await registerUser(server, `mismatch-${uuid()}@example.com`);
    const otherProduct = await server.commerceServices.products.create({
      slug: `other-${uuid().slice(0, 8)}`,
      name: 'Other',
      type: 'DIGITAL',
    });
    const otherVariant = await server.commerceServices.variants.create(otherProduct.id, {
      name: 'Download',
      sku: `DL-${uuid().slice(0, 8).toUpperCase()}`,
      priceMinor: '5000',
      currency: 'IDR',
      billingPeriod: 'ONE_TIME',
    });
    await server.commerceServices.variants.changeStatus(otherVariant.id, { status: 'ACTIVE' });
    await server.commerceServices.products.changeStatus(otherProduct.id, { status: 'ACTIVE' });

    const mismatch = await server.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { cookie: customer.cookie },
      payload: { productId: seeded.productId, variantId: otherVariant.id },
    });
    expect(mismatch.statusCode).toBe(409);

    await server.commerceServices.variants.changeStatus(seeded.variantId, { status: 'DRAFT' });
    await server.commerceServices.resourceProfiles.setActive(seeded.profileId, false);
    const unavailable = await server.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { cookie: customer.cookie },
      payload: { productId: seeded.productId, variantId: seeded.variantId },
    });
    expect(unavailable.statusCode).toBe(409);

    await server.close();
  });

  it('blocks customers from the admin resource-profile surface', async () => {
    const server = createCommerceTestServer();
    const customer = await registerUser(server, `profile-${uuid()}@example.com`);

    const response = await server.app.inject({
      method: 'GET',
      url: '/api/v1/admin/resource-profiles',
      headers: { cookie: customer.cookie },
    });
    expect(response.statusCode).toBe(403);

    await server.close();
  });

  it('guards profile deactivation through PATCH and DELETE', async () => {
    const server = createCommerceTestServer();
    const admin = await adminCookie(server);
    const seeded = await seedPurchasable(server);

    const patch = await server.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/resource-profiles/${seeded.profileId}`,
      headers: { cookie: admin },
      payload: { active: false },
    });
    expect(patch.statusCode).toBe(409);

    const deletion = await server.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/resource-profiles/${seeded.profileId}`,
      headers: { cookie: admin },
    });
    expect(deletion.statusCode).toBe(409);

    await server.commerceServices.variants.changeStatus(seeded.variantId, { status: 'DRAFT' });

    const deactivated = await server.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/resource-profiles/${seeded.profileId}`,
      headers: { cookie: admin },
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json<{ data: { profile: { active: boolean } } }>().data.profile.active).toBe(
      false,
    );

    const customer = await registerUser(server, `profile-delete-${uuid()}@example.com`);
    const forbidden = await server.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/resource-profiles/${seeded.profileId}`,
      headers: { cookie: customer.cookie },
    });
    expect(forbidden.statusCode).toBe(403);

    await server.close();
  });

  it('hides active products that no longer have sellable variants', async () => {
    const server = createCommerceTestServer();
    const product = await server.commerceServices.products.create({
      slug: `empty-${uuid().slice(0, 8)}`,
      name: 'Empty catalog product',
      type: 'DIGITAL',
    });
    const variant = await server.commerceServices.variants.create(product.id, {
      name: 'Download',
      sku: `EMPTY-${uuid().slice(0, 8).toUpperCase()}`,
      priceMinor: '1000',
      currency: 'IDR',
      billingPeriod: 'ONE_TIME',
    });
    await server.commerceServices.variants.changeStatus(variant.id, { status: 'ACTIVE' });
    await server.commerceServices.products.changeStatus(product.id, { status: 'ACTIVE' });
    await server.commerceServices.variants.changeStatus(variant.id, { status: 'DRAFT' });

    const listed = await server.app.inject({ method: 'GET', url: '/api/v1/products' });
    expect(listed.statusCode).toBe(200);
    expect(
      listed.json<{ data: { products: Array<{ id: string }> } }>().data.products.some(
        (entry) => entry.id === product.id,
      ),
    ).toBe(false);

    const detail = await server.app.inject({
      method: 'GET',
      url: `/api/v1/products/${product.slug}`,
    });
    expect(detail.statusCode).toBe(404);

    await server.close();
  });
});

interface OrderPayload {
  id: string;
  userId: string;
  status: string;
  currency: string;
  total: { amount: string; currency: string };
  items: Array<{ snapshot: Record<string, unknown> }>;
}
