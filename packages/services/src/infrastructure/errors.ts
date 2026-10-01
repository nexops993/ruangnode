import { AppError } from '@ruangnode/shared';

export const INFRASTRUCTURE_MESSAGES = {
  nodeNotFound: 'The requested node was not found.',
  nodeUnavailable: 'No suitable infrastructure node is available.',
  insufficientCapacity: 'There is not enough capacity for this instance.',
  instanceNotFound: 'The requested instance was not found.',
  invalidTransition: 'The instance cannot perform that operation in its current state.',
  provisioningNotEligible: 'This order is not eligible for provisioning.',
  provisioningFailed: 'The instance could not be provisioned.',
} as const;

export function infrastructureError(code: 'NOT_FOUND' | 'CONFLICT' | 'SERVICE_UNAVAILABLE' | 'VALIDATION_FAILED', message: string): AppError {
  return new AppError({ code, message });
}