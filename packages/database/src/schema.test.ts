import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Schema invariants.
 *
 * These tests guard the rules that the database layer must never silently lose
 * (see `.clinerules`, docs/DATABASE.md and docs/DECISIONS.md). They read the
 * schema file directly, so they run without a database.
 */
const schema = readFileSync(
  fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)),
  'utf8',
);

function block(kind: 'model' | 'enum', name: string): string {
  const match = new RegExp(`^${kind} ${name} \\{([\\s\\S]*?)^\\}`, 'm').exec(schema);
  const body = match?.[1];

  if (body === undefined) {
    throw new Error(`${kind} ${name} is not defined in prisma/schema.prisma`);
  }

  return body;
}

function lines(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line !== '' && !line.startsWith('///') && !line.startsWith('//') && !line.startsWith('@@'),
    );
}

function fields(modelName: string): Map<string, string> {
  const entries = lines(block('model', modelName)).map((line) => {
    const [name = '', ...rest] = line.split(/\s+/);
    return [name, rest.join(' ')] as const;
  });

  return new Map(entries);
}

function enumValues(name: string): string[] {
  return lines(block('enum', name));
}

/** Every entity of docs/DATABASE.md. `Role` is intentionally not a table. */
const ENTITIES = [
  'User',
  'Product',
  'ProductVariant',
  'ResourceProfile',
  'Order',
  'OrderItem',
  'Payment',
  'Subscription',
  'Node',
  'NodeHeartbeat',
  'Instance',
  'ProvisioningJob',
  'Credential',
  'InstanceDomain',
  'SupportTicket',
  'SupportMessage',
  'AuditLog',
  'WebhookEvent',
  'Download',
] as const;

/** Append-only tables: they record what happened and are never updated. */
const APPEND_ONLY: readonly string[] = [
  'NodeHeartbeat',
  'SupportMessage',
  'AuditLog',
  'WebhookEvent',
  'Download',
];

describe('schema entities', () => {
  it('defines every entity of docs/DATABASE.md', () => {
    for (const entity of ENTITIES) {
      expect(() => block('model', entity)).not.toThrow();
    }
  });

  it('uses User.role instead of a Role table', () => {
    expect(schema).not.toMatch(/^model Role \{/m);
    expect(fields('User').get('role')).toContain('UserRole');
    expect(enumValues('UserRole')).toEqual(['CUSTOMER', 'SUPPORT', 'ADMIN']);
  });

  it('gives every entity a UUIDv7 primary key', () => {
    for (const entity of ENTITIES) {
      expect(fields(entity).get('id')).toMatch(
        /^String\s+@id\s+@default\(uuid\(7\)\)\s+@db\.Uuid$/,
      );
    }
  });

  it('adds timestamps and keeps append-only tables append-only', () => {
    for (const entity of ENTITIES) {
      expect(fields(entity).get('createdAt')).toContain('@default(now())');

      if (APPEND_ONLY.includes(entity)) {
        expect(fields(entity).has('updatedAt')).toBe(false);
      } else {
        expect(fields(entity).get('updatedAt')).toContain('@updatedAt');
      }
    }
  });

  it('declares an explicit referential action for every foreign key', () => {
    const relations = schema.match(/@relation\([^)]*\)/g) ?? [];

    expect(relations.length).toBeGreaterThan(20);
    for (const relation of relations) {
      expect(relation).toContain('onDelete:');
    }
  });

  it('indexes ownership columns', () => {
    expect(block('model', 'Order')).toContain('@@index([userId');
    expect(block('model', 'Subscription')).toContain('@@index([userId');
    expect(block('model', 'Instance')).toContain('@@index([userId');
    expect(block('model', 'Credential')).toContain('@@index([userId');
    expect(block('model', 'SupportTicket')).toContain('@@index([userId');
    expect(block('model', 'Download')).toContain('@@index([userId');
    expect(block('model', 'AuditLog')).toContain('@@index([actorUserId');
  });
});

describe('money', () => {
  const MONEY_FIELDS: ReadonlyArray<readonly [string, string]> = [
    ['ProductVariant', 'price'],
    ['Order', 'subtotal'],
    ['Order', 'discount'],
    ['Order', 'total'],
    ['OrderItem', 'unitPrice'],
    ['OrderItem', 'totalPrice'],
    ['Payment', 'amount'],
  ];

  it('never uses floating point or decimal types anywhere in the schema', () => {
    expect(schema).not.toMatch(/\bFloat\b/);
    expect(schema).not.toMatch(/\bDecimal\b/);
  });

  it('stores monetary values as non-null integer minor units', () => {
    for (const [entity, field] of MONEY_FIELDS) {
      expect(fields(entity).get(field)).toMatch(/^BigInt(?!\?)/);
    }
  });

  it('stores byte quantities as BigInt and CPU in millicores', () => {
    for (const field of ['memoryLimitBytes', 'diskLimitBytes']) {
      expect(fields('ResourceProfile').get(field)).toMatch(/^BigInt(?!\?)/);
    }

    for (const field of ['totalMemoryBytes', 'totalStorageBytes']) {
      expect(fields('Node').get(field)).toMatch(/^BigInt(?!\?)/);
    }

    expect(fields('ResourceProfile').get('cpuLimit')).toMatch(/^Int$/);
    expect(fields('Node').get('totalCpuMillicores')).toMatch(/^Int$/);
  });

  it('carries an explicit currency on every monetary aggregate', () => {
    expect(fields('Order').get('currency')).toMatch(/^String(?!\?)/);
    expect(fields('Payment').get('currency')).toMatch(/^String(?!\?)/);
    expect(fields('ProductVariant').get('currency')).toMatch(/^String(?!\?)/);
  });
});

describe('idempotency', () => {
  it('enforces webhook uniqueness on provider + externalEventId', () => {
    expect(block('model', 'WebhookEvent')).toContain('@@unique([provider, externalEventId])');
  });

  it('requires a unique provisioning idempotency key', () => {
    expect(fields('ProvisioningJob').get('idempotencyKey')).toMatch(/@unique/);
  });

  it('keeps provider payments unique per provider reference', () => {
    expect(block('model', 'Payment')).toContain('@@unique([provider, providerPaymentId])');
  });

  it('creates at most one subscription per order item', () => {
    expect(block('model', 'Subscription')).toContain('@@unique([orderItemId])');
  });

  it('maps one runtime object to one instance per node', () => {
    expect(block('model', 'Instance')).toContain('@@unique([nodeId, runtimeId])');
  });
});

describe('state separation', () => {
  const STATES: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    ['Order', 'OrderStatus', ['PENDING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED']],
    ['Payment', 'PaymentStatus', ['PENDING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED']],
    [
      'Subscription',
      'SubscriptionStatus',
      ['PENDING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'],
    ],
    [
      'Instance',
      'InstanceStatus',
      [
        'PENDING',
        'PROVISIONING',
        'STARTING',
        'ACTIVE',
        'STOPPED',
        'RESTARTING',
        'ERROR',
        'SUSPENDED',
        'DELETING',
        'DELETED',
      ],
    ],
    [
      'Node',
      'NodeStatus',
      ['PROVISIONING', 'ONLINE', 'DEGRADED', 'OFFLINE', 'DRAINING', 'MAINTENANCE'],
    ],
    [
      'ProvisioningJob',
      'ProvisioningJobStatus',
      ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'],
    ],
  ];

  it('keeps every state machine in its own enum and column', () => {
    for (const [entity, enumName, values] of STATES) {
      expect(fields(entity).get('status')).toContain(enumName);
      expect(enumValues(enumName)).toEqual([...values]);
    }
  });

  it('models provisioning operations explicitly', () => {
    expect(enumValues('ProvisioningOperation')).toEqual([
      'CREATE',
      'DELETE',
      'START',
      'STOP',
      'RESTART',
      'UPDATE_RESOURCES',
      'UPDATE_CONFIGURATION',
    ]);
    expect(fields('ProvisioningJob').get('operation')).toContain('ProvisioningOperation');
  });

  it('tracks attempts and recoverable failures on provisioning jobs', () => {
    expect(fields('ProvisioningJob').get('attemptCount')).toContain('@default(0)');
    expect(fields('ProvisioningJob').get('errorCategory')).toMatch(/^String\?/);
    expect(fields('ProvisioningJob').get('lastError')).toMatch(/^String\?/);
  });
});

describe('resource profile enforceability', () => {
  it('describes CPU, memory, swap, disk, PID and network policy', () => {
    const profile = fields('ResourceProfile');

    expect(profile.get('cpuLimit')).toMatch(/^Int$/);
    expect(profile.get('memoryLimitBytes')).toMatch(/^BigInt(?!\?)/);
    expect(profile.get('memorySwapBytes')).toMatch(/^BigInt\?/);
    expect(profile.get('memorySwapPolicy')).toContain('MemorySwapPolicy');
    expect(profile.get('diskLimitBytes')).toMatch(/^BigInt(?!\?)/);
    expect(profile.get('diskPolicy')).toContain('DiskPolicy');
    expect(profile.get('pidsLimit')).toMatch(/^Int$/);
    expect(profile.get('networkPolicy')).toMatch(/^String\?/);
  });

  it('keeps the swap policy explicit instead of implying unlimited swap', () => {
    expect(enumValues('MemorySwapPolicy')).toEqual(['DISABLED', 'EQUAL_TO_MEMORY', 'BOUNDED']);
  });

  it('distinguishes enforced, allocated and monitored disk', () => {
    expect(enumValues('DiskPolicy')).toEqual(['ENFORCED_QUOTA', 'ALLOCATED', 'MONITORED']);
  });

  it('profiles are deactivatable, never silently deleted', () => {
    expect(fields('ResourceProfile').get('active')).toContain('@default(true)');
  });

  it('reserves host overhead on every node', () => {
    const node = fields('Node');

    for (const field of ['reservedCpuMillicores', 'reservedMemoryBytes', 'reservedStorageBytes']) {
      expect(node.get(field)).toContain('@default(0)');
    }

    expect(node.get('allocatedMemoryBytes')).toContain('@default(0)');
  });
});

describe('credentials', () => {
  it('stores an encrypted envelope instead of a plaintext secret', () => {
    const credential = fields('Credential');

    expect(credential.get('encryptedSecret')).toMatch(/^String$/);
    expect(credential.get('encryptionAlgorithm')).toContain('@default("aes-256-gcm")');
    expect(credential.get('encryptionKeyVersion')).toContain('@default(1)');
    expect(credential.get('encryptionIv')).toMatch(/^String$/);
    expect(credential.get('encryptionAuthTag')).toMatch(/^String$/);
  });

  it('never exposes a plaintext secret column', () => {
    for (const entity of ENTITIES) {
      for (const [field, declaration] of fields(entity)) {
        const looksLikePlaintextSecret =
          /^(secret|plaintext|plaintextSecret|apiKey|password|token)$/i.test(field) &&
          !declaration.startsWith('String?');
        const isKnownHashOrEnvelope =
          /(Hash|TokenHash|Iv|AuthTag|encryptedSecret|verificationToken)/.test(field);

        expect(looksLikePlaintextSecret && !isKnownHashOrEnvelope).toBe(false);
      }
    }
  });

  it('keeps node agent credentials hashed', () => {
    expect(fields('Node').get('agentTokenHash')).toMatch(/^String\?/);
  });
});

describe('authentication tables', () => {
  it('defines Session and PasswordResetToken with UUIDv7 primary keys', () => {
    for (const model of ['Session', 'PasswordResetToken']) {
      expect(fields(model).get('id')).toMatch(/^String\s+@id\s+@default\(uuid\(7\)\)\s+@db\.Uuid$/);
      expect(fields(model).get('createdAt')).toContain('@default(now())');
    }
  });

  it('stores only a hash of each bearer secret', () => {
    for (const model of ['Session', 'PasswordResetToken']) {
      expect(fields(model).get('tokenHash')).toMatch(/^String\s+@unique$/);

      for (const name of fields(model).keys()) {
        // No column may hold the plaintext token or a raw password.
        expect(/^(token|secret|password|sessionToken|resetToken)$/i.test(name)).toBe(false);
      }
    }
  });

  it('makes sessions revocable and expiring', () => {
    const session = fields('Session');

    expect(session.get('expiresAt')).toMatch(/^DateTime\s/);
    expect(session.get('lastUsedAt')).toMatch(/^DateTime\s/);
    expect(session.get('revokedAt')).toMatch(/^DateTime\?/);
    expect(session.get('revokedReason')).toContain('SessionRevocationReason');
    expect(block('model', 'Session')).toContain('@@index([userId, expiresAt])');
    expect(block('model', 'Session')).toContain('@@index([expiresAt])');
  });

  it('makes password reset tokens single-use and expiring', () => {
    const reset = fields('PasswordResetToken');

    expect(reset.get('expiresAt')).toMatch(/^DateTime\s/);
    expect(reset.get('usedAt')).toMatch(/^DateTime\?/);
    expect(block('model', 'PasswordResetToken')).toContain('@@index([userId, expiresAt])');
  });

  it('removes sessions and reset tokens when their user is deleted', () => {
    expect(block('model', 'Session')).toContain('onDelete: Cascade');
    expect(block('model', 'PasswordResetToken')).toContain('onDelete: Cascade');
  });

  it('keeps session revocation reasons explicit', () => {
    expect(enumValues('SessionRevocationReason')).toEqual([
      'LOGOUT',
      'LOGOUT_ALL',
      'PASSWORD_RESET',
      'ADMIN_REVOKED',
    ]);
  });

  it('links both tables to the owning user', () => {
    for (const model of ['Session', 'PasswordResetToken']) {
      expect(fields(model).get('userId')).toMatch(/^String\s+@db\.Uuid$/);
      expect(block('model', model)).toContain('references: [id]');
    }
  });
});
