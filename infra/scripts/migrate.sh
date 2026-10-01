#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

corepack pnpm --filter @ruangnode/database run prisma:validate
corepack pnpm --filter @ruangnode/database run migrate:deploy
