# LMI Runtime Model

Lambda Managed Instances lets a Lambda execution environment process multiple concurrent invokes.
The gateway relies on this to hold in-memory batch state while many Function URL requests are active.

## Execution Environments

Each execution environment has its own router, batchers, queues, timers, and probe state. There is
no cross-environment coordination.

Minimum execution environments provide baseline warm capacity. Maximum execution environments bound
scale-out and cost exposure.

## Per-Environment Concurrency

`CapacityProviderConfig.PerExecutionEnvironmentMaxConcurrency` controls how many invokes can be
active in one environment. The gateway should set its own queue and inflight limits below the point
where target latency or memory pressure becomes unstable.

## In-Memory State

State survives while the environment stays alive, but it is not durable. The gateway must tolerate a
new environment starting with no historical request-rate or duration-probe data.

## Scale-Out Effects

When Lambda adds environments, traffic is split across independent batchers. Effective batch size may
temporarily drop until each environment has enough traffic and probe data.

429 responses can come from gateway request limits, pending invocation limits, target Lambda
throttling, or Function URL/Lambda capacity. Use logs and metrics to distinguish them.
