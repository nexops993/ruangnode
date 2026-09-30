import { describe, expect, it } from 'vitest';

import { databaseUrlFromEnv } from './config.js';

describe('databaseUrlFromEnv', () => {
  it('returns the configured connection string', () => {
    const url = databaseUrlFromEnv({ DATABASE_URL: 'postgresql://user:secret@localhost:5432/db' });

    expect(url).toBe('postgresql://user:secret@localhost:5432/db');
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => databaseUrlFromEnv({})).toThrow(/DATABASE_URL is not configured/);
  });

  it('treats a blank value as missing', () => {
    expect(() => databaseUrlFromEnv({ DATABASE_URL: '   ' })).toThrow(/DATABASE_URL/);
  });

  it('never includes a connection string in the error message', () => {
    expect(() => databaseUrlFromEnv({ DATABASE_URL: '' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('secret') }),
    );
  });
});
