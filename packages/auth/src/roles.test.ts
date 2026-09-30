import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ACCOUNT_STATUSES, ROLES } from './roles.js';

/**
 * The role and status values are declared in this package (so authorization code
 * has no runtime dependency on the database client) and in the Prisma schema (so
 * PostgreSQL enforces them). This test is the contract between the two: it parses
 * the schema and fails if they ever drift apart.
 */
const schema = readFileSync(
  fileURLToPath(new URL('../../database/prisma/schema.prisma', import.meta.url)),
  'utf8',
);

function enumValues(name: string): string[] {
  const match = new RegExp(`^enum ${name} \\{([\\s\\S]*?)^\\}`, 'm').exec(schema);
  const body = match?.[1];

  if (body === undefined) {
    throw new Error(`enum ${name} is not defined in packages/database/prisma/schema.prisma`);
  }

  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//'));
}

describe('role definitions', () => {
  it('matches the UserRole enum in the database schema', () => {
    expect(enumValues('UserRole')).toEqual([...ROLES]);
  });

  it('matches the UserStatus enum in the database schema', () => {
    expect(enumValues('UserStatus')).toEqual([...ACCOUNT_STATUSES]);
  });

  it('contains exactly the three documented roles', () => {
    expect([...ROLES]).toEqual(['CUSTOMER', 'SUPPORT', 'ADMIN']);
  });
});
