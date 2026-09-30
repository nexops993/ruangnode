# RuangNode Resource Isolation

## Goal

A customer must receive exactly the resource class purchased, subject to
the documented behavior of the underlying runtime.

Resource limits must be enforced by infrastructure.

The UI is never the enforcement layer.

## Resource profile

A profile defines:

``` text
cpuLimit
memoryLimit
memorySwap
diskLimit
pidsLimit
networkPolicy
```

Example:

``` text
STARTER
CPU: 1
RAM: 1 GiB
Swap: 1 GiB or policy-defined
Disk: 5 GiB
PIDs: 256

PRO
CPU: 2
RAM: 2 GiB
Swap: policy-defined
Disk: 10 GiB
PIDs: 512

POWER
CPU: 4
RAM: 8 GiB
Swap: policy-defined
Disk: 30 GiB
PIDs: 1024
```

These are configurable product examples.

## CPU

Docker/cgroups can enforce CPU limits.

A product should define a normalized value such as: - millicores - or a
decimal CPU limit

The API should convert this into the runtime-specific representation.

Example:

``` text
2000 millicores = 2 CPU
```

Do not let customers submit arbitrary Docker flags.

## Memory

Memory must be a hard container limit where the runtime supports it.

Example:

``` text
2 GiB
```

The UI may display:

``` text
2 GB RAM
```

but the backend must store an unambiguous byte value.

## Swap

Swap policy must be explicit.

Do not accidentally allow a container with a 2 GiB RAM product to
consume unlimited host swap.

Possible policies: - swap disabled - swap equal to memory - custom
bounded swap

The selected policy must be applied by the runtime.

## PIDs

PID limits prevent a container from creating an uncontrolled number of
processes.

This is an important defense against accidental process explosions.

## Disk

Disk is more complicated than CPU/RAM.

Do not claim a hard quota merely because a UI says “10 GB”.

A hard quota requires an appropriate storage mechanism such as: -
filesystem quota - storage driver quota - dedicated volume - other
enforceable backend

The architecture must identify whether the current node supports the
chosen mechanism.

If hard quota is unavailable, the product must clearly distinguish: -
allocated storage - enforced quota - monitoring-only quota

## Network

Network bandwidth limits are provider/runtime dependent.

If the platform cannot reliably enforce a bandwidth cap, do not present
a fake hard limit.

Traffic accounting can still be monitored.

## Node capacity

A node should reserve host overhead.

Example:

``` text
Node RAM: 8 GiB
Reserved host/system: 1 GiB
Schedulable: 7 GiB
```

Do not allocate 100% of physical RAM to customer instances.

CPU may have a configurable overcommit policy, but RAM should generally
be treated conservatively for managed AI workloads.

## Scheduling

Before deployment:

``` text
required CPU <= available schedulable CPU
required RAM <= available schedulable RAM
required storage <= available schedulable storage
```

If not, do not schedule the instance.

## Reconciliation

Node Agent periodically reports actual state.

Control Plane compares: - expected allocations - actual containers -
actual resource limits - node capacity

Differences create reconciliation tasks or admin alerts.

## Upgrades

When upgrading a service:

1.  Verify new resource profile.
2.  Find capacity.
3.  Update subscription/order.
4.  Apply new runtime limits.
5.  Verify limits.
6.  Update instance state.
7.  Record audit event.

If capacity is unavailable, do not partially apply the upgrade.

## Downgrades

Downgrades must verify that: - storage fits - memory fits - application
remains valid - the new profile is supported

If not, require migration/reconfiguration.

## Isolation requirements

Customer A must never be able to: - read customer B’s files - read host
files - access Docker socket - access another container’s console -
modify another instance - bypass resource limits

## Testing

Tests should verify actual enforcement.

Example: - create 128 MiB container - verify runtime reports 128 MiB
limit - create CPU-limited container - verify runtime reports CPU
limit - verify PID limit - attempt unauthorized instance access -
attempt path traversal - verify denial
