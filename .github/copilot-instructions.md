# RuangNode — Copilot Instructions

RuangNode is a commercial digital-product marketplace and managed application hosting platform.

## Architecture

- `apps/api`: Fastify API.
- `apps/web`: Next.js frontend.
- `packages/database`: Prisma and PostgreSQL.
- `packages/auth`: authentication and authorization.
- `packages/services`: business logic.
- `packages/shared`: shared contracts.
- `node-agent`: infrastructure execution layer.

Preserve the existing architecture, interfaces and implemented features.

## Working rules

- Inspect the existing implementation before writing code.
- Read only documentation relevant to the current task.
- Treat `docs/DECISIONS.md` as the record of established architectural decisions.
- Do not load `MASTER_CLINE_PROMPT.md` into the operational context.
- Never restart a completed phase or rewrite functioning subsystems without a demonstrated reason.
- Keep changes within the requested scope.
- Do not weaken, skip or delete tests to make validation pass.
- Do not add unrelated dependencies or features.
- Do not commit automatically.

## Validation

After implementing changes, run TypeScript typecheck, ESLint and the relevant tests. Run the full suite when the task is complete.

Report the files changed, validation results, unresolved problems and remaining work.

If the task is ambiguous, inspect the existing contracts and relevant documentation before making assumptions.