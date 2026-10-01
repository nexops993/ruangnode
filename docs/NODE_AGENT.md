# RuangNode Node Agent

## Purpose

The Node Agent is the trusted runtime controller installed on each
RuangNode infrastructure node.

It bridges the Control Plane and local container runtime.

``` text
Control Plane
      |
 authenticated channel
      |
      v
 Node Agent
      |
      v
 Docker
```

## Security boundary

The Node Agent is trusted with local infrastructure operations.

Customers are not.

Never expose a generic command execution endpoint such as:

``` text
POST /exec
{ "command": "..." }
```

There must be no arbitrary host shell API.

## Agent responsibilities

- Register node
- Authenticate
- Heartbeat
- Report capacity
- Report health
- Create instance
- Delete instance
- Start instance
- Stop instance
- Restart instance
- Update resource limits
- Collect metrics
- Retrieve logs
- Perform controlled file operations
- Create controlled console sessions

## Agent registration

Registration should require a bootstrap credential.

After registration: - issue a long-lived node identity/credential -
rotate credentials when supported - revoke compromised nodes - record
node ID and agent version

Never store bootstrap secrets in source code.

## Heartbeat

Agent heartbeat should include:

- node ID
- agent version
- uptime
- CPU capacity
- memory capacity
- storage capacity
- allocated resources
- Docker health
- timestamp

The control plane should mark a node degraded/offline if heartbeats
stop.

## Instance identity

Every instance must have a stable internal ID.

Map:

``` text
RuangNode Instance ID
        |
        +-- Docker container ID
        +-- storage path/volume
        +-- network identity
```

Do not use customer-controlled names as authoritative IDs.

## Docker operations

The agent may use the local Docker API/socket.

The Docker socket must not be mounted into customer containers.

For every instance creation:

1.  Validate product/service type.
2.  Validate resource profile.
3.  Validate requested configuration.
4.  Create storage.
5.  Create network configuration if needed.
6.  Create container.
7.  Apply CPU limit.
8.  Apply memory limit.
9.  Apply swap policy.
10. Apply PID limit.
11. Apply storage policy.
12. Apply environment/secrets securely.
13. Start container.
14. Verify health.
15. Report runtime ID.

The HTTP transport exposes `GET /health` without authentication. All runtime
routes require `Authorization: Bearer <shared-secret>`. Docker integration
tests are opt-in and are not part of the unit test command; run them only on a
host with a reachable Docker Engine.

## Resource enforcement

The agent must apply actual runtime limits.

Examples for Docker: - `--cpus` - `--memory` - `--memory-swap` -
`--pids-limit`

Disk limits require a runtime/storage strategy appropriate to the node
filesystem. Do not claim a hard disk quota if the underlying storage
cannot enforce it.

## Metrics

Collect: - CPU usage - memory usage - memory limit - disk usage -
network RX - network TX - container status - uptime

Metrics should be sampled at a reasonable interval.

Do not generate excessive telemetry on small nodes.

## Logs

The agent can retrieve logs for an instance.

Log output must: - be bounded - support pagination/tail - avoid
unlimited memory buffering - not expose host logs

## File operations

All file operations must be relative to an instance-controlled root.

Protect against: - path traversal - symlink escape - absolute paths -
host filesystem access

Allowed operations should be explicitly enumerated.

## Console

If console functionality is implemented, it should attach to the
instance runtime only.

Do not provide a host shell.

Console sessions should: - be authenticated - be short-lived - be
logged/audited where appropriate - have rate/connection limits

## Node draining

When a node is DRAINING: - no new instances should be scheduled there -
existing instances remain online - migrations can be performed later

## Failure handling

Agent operations must be idempotent where possible.

If a create command times out: - reconcile actual Docker state - do not
blindly create a second container

## Agent updates

The agent must report its version.

Updates should be controlled and auditable.

A future system may use signed agent releases.

## Minimum privileges

Run the agent with the minimum practical host privileges.

If Docker access requires elevated privileges, isolate the agent
carefully and do not expose that privilege to customer-controlled input.
