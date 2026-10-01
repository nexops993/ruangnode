import {
  TEST_EMAIL,
  TEST_PASSWORD,
  TEST_SESSION_SECRET,
  TEST_START,
  createTestServer,
  loginUser,
  registerUser,
  sessionCookieHeader,
  type TestServer,
  type TestServerOptions,
} from '../auth/test-harness.js';
import type { CommerceServices, InMemoryCommerceStore } from '@ruangnode/services/testing';

export type { CommerceServices, InMemoryCommerceStore };
export { TEST_EMAIL, TEST_PASSWORD, TEST_SESSION_SECRET, TEST_START };
export { createTestServer as createCommerceTestServer, loginUser, registerUser, sessionCookieHeader };
export type { TestServer as CommerceTestServer, TestServerOptions };

/**
 * Commerce services on the extended auth test server (`TestServer` already
 * wires `commerceServices` over the in-memory commerce store).
 */
export function commerceServicesOf(server: TestServer): CommerceServices {
  return server.commerceServices;
}

