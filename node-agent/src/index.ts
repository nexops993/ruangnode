/**
 * @ruangnode/node-agent
 *
 * Boundary: the trusted service installed on each infrastructure node. It is
 * the only component allowed to talk to the Docker runtime.
 *
 * Phase 0 scope: the package boundary and its build configuration exist. The
 * agent itself is implemented in a later phase — see docs/NODE_AGENT.md and
 * docs/DECISIONS.md.
 *
 * Rules that apply once the agent lands:
 *   - all control-plane -> agent communication is authenticated
 *   - the agent connects outbound where practical, so the control plane never
 *     needs an openly exposed privileged Docker API
 *   - the agent applies and verifies real container limits (CPU, memory,
 *     memory-swap, PIDs, storage) and reports runtime-confirmed values
 *   - no arbitrary host shell access is ever exposed to customers
 */
export {};
