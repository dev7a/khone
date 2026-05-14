# LMI runtime model

Lambda Managed Instances lets a Lambda execution environment process multiple concurrent invokes.
The gateway relies on this to hold in-memory batch state while many Function URL requests are active.

## Execution environments

Each execution environment has its own router, batchers, queues, timers, and probe state. There is
no cross-environment coordination. Requests can be batched together only when Lambda routes them to
the same execution environment.

Minimum execution environments provide baseline warm capacity. Maximum execution environments bound
scale-out and cost exposure.

## Per-environment concurrency

`CapacityProviderConfig.PerExecutionEnvironmentMaxConcurrency` controls how many invokes can be
active in one environment. The gateway should set its own queue and inflight limits below the point
where target latency or memory pressure becomes unstable.

## In-memory state

The gateway keeps request-rate and duration-probe data in memory while an execution environment is
alive. A new environment starts without that history, so batching policy can take a brief ramp-up
period before it reaches the same behavior as a warm environment.

## Scale-out effects

When Lambda adds environments, traffic is split across independent batchers. Effective batch size may
temporarily drop until each environment has enough traffic and probe data.

429 responses can come from gateway request limits, pending invocation limits, target Lambda
throttling, or Function URL/Lambda capacity. Use logs and metrics to distinguish them.
