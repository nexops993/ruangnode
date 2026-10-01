import { infrastructureError } from './errors.js';

export function instanceStorageKey(instanceId: string): string {
  if (!/^[0-9a-f-]{20,}$/i.test(instanceId) || instanceId.includes('..') || instanceId.includes('/') || instanceId.includes('\\')) {
    throw infrastructureError('VALIDATION_FAILED', 'The instance identifier is invalid.');
  }
  return `instances/${instanceId}`;
}