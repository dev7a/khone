# Project scope

Khone is a Lambda gateway for stateful request batching. It sits in front of Lambda target functions, keeps short-lived batching state in memory, and forwards grouped requests to handlers that understand the Khone batch protocol.

Khone uses the Lambda Managed Instances (LMI) deployment model. The gateway is deployed as a Rust Lambda function behind a Lambda Function URL, and the CloudFormation macro publishes the gateway config/spec artifact to S3.

## What this project is

- A Rust router that accepts HTTP requests through a Lambda Function URL.
- A batching gateway that can reduce target Lambda invocations when traffic can be grouped,
  especially for I/O-bound handlers that spend much of their time waiting on downstream responses.
- A protocol and adapter set for Lambda handlers that receive batched requests and return per-request responses.
- A CloudFormation macro package that publishes inline gateway configuration to S3.
- A benchmark harness for comparing direct API Gateway invocation with steady, adaptive, and target-aware batching.

## What this project is not

- It is not an API Gateway replacement for every route pattern.
- It does not create LMI capacity providers. Templates accept a user-provided capacity provider ARN.
- It does not manage public DNS, authentication, WAF, tenant authorization, or edge caching.
- It is not a durable workflow engine. Gateway state is in-memory per Lambda execution environment.
- It is not a CPU parallelism layer. CPU-bound handlers may see little benefit because batching does
  not add compute capacity inside a target invocation.

## Operating model

The gateway Lambda initializes the router and batcher once per execution environment. On LMI, execution environments are more stable than standard Lambda environments, so the gateway can keep useful in-memory state for longer periods. The state remains opportunistic: deployments, scaling changes, failures, or Lambda lifecycle decisions can still replace an execution environment.

The practical consequence is that benchmark results should be read as scenario measurements rather
than global guarantees. Workloads with different traffic distribution, target duration, payload size,
or scale-out behavior can produce different batch sizes and latency tradeoffs. The fit is best when
the target handler has I/O wait that batching can amortize or overlap; it is weaker when every item
is primarily CPU work.
