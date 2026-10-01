-- Add the intermediate provider-processing state required by the payment state machine.
ALTER TYPE "PaymentStatus" ADD VALUE 'PROCESSING';